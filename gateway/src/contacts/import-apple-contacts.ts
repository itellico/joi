import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { query } from "../db/client.js";

interface AppleContact {
  id: string;
  contactType: string;
  firstName: string;
  lastName: string;
  middleName: string;
  nickname: string;
  organization: string;
  jobTitle: string;
  department: string;
  emails: Array<{ label: string; value: string }>;
  phones: Array<{ label: string; value: string }>;
  addresses?: Array<{
    label: string;
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  }>;
  birthday?: { day: number; month: number; year: number };
  socialProfiles?: Array<{ service: string; username: string; url: string }>;
  urls?: Array<{ label: string; value: string }>;
  hasImage: boolean;
  namePrefix: string;
  nameSuffix: string;
}

interface NotesMap {
  [appleId: string]: string;
}

function loadNotesFromSQLite(): NotesMap {
  const notesMap: NotesMap = {};
  const sourcesDir = path.join(
    os.homedir(),
    "Library/Application Support/AddressBook/Sources",
  );

  // Walk through all source databases looking for notes
  let sourcesDirEntries: string[] = [];
  try {
    sourcesDirEntries = fs.readdirSync(sourcesDir);
  } catch {
    console.log("[Import] Could not read AddressBook Sources directory");
    return notesMap;
  }

  for (const source of sourcesDirEntries) {
    const dbPath = path.join(sourcesDir, source, "AddressBook-v22.abcddb");
    try {
      const db = new Database(dbPath, { readonly: true });
      const rows = db
        .prepare(
          `SELECT n.ZTEXT, r.ZUNIQUEID
           FROM ZABCDNOTE n
           JOIN ZABCDRECORD r ON r.Z_PK = n.ZCONTACT
           WHERE n.ZTEXT IS NOT NULL AND n.ZTEXT != ''`,
        )
        .all() as Array<{ ZTEXT: string; ZUNIQUEID: string }>;

      for (const row of rows) {
        notesMap[row.ZUNIQUEID] = row.ZTEXT;
      }
      db.close();
    } catch {
      // Skip databases that can't be opened
    }
  }

  console.log(`[Import] Found ${Object.keys(notesMap).length} contact notes from SQLite`);
  return notesMap;
}

export async function importAppleContacts(): Promise<{
  imported: number;
  companies: number;
  notes: number;
}> {
  // 1. Run the Swift binary to get contacts JSON
  const binPath = path.resolve(
    import.meta.dirname ?? process.cwd(),
    "../../bin/contacts-export",
  );
  console.log(`[Import] Running ${binPath}...`);

  const stdout = execFileSync(binPath, { maxBuffer: 50 * 1024 * 1024, encoding: "utf-8" });

  // The binary prints "Fetched N contacts in Xs" on the first line, then JSON
  const jsonStart = stdout.indexOf("[");
  if (jsonStart === -1) throw new Error("No JSON output from contacts-export binary");
  const contacts: AppleContact[] = JSON.parse(stdout.slice(jsonStart));
  console.log(`[Import] Parsed ${contacts.length} contacts from binary`);

  // 2. Load notes from SQLite
  const notesMap = loadNotesFromSQLite();

  // 3. Extract unique organizations → upsert companies
  const orgNames = new Set<string>();
  for (const c of contacts) {
    if (c.organization?.trim()) {
      orgNames.add(c.organization.trim());
    }
  }

  const companyIdMap = new Map<string, string>();
  let companiesCreated = 0;

  for (const orgName of orgNames) {
    const result = await query<{ id: string }>(
      `INSERT INTO companies (name)
       VALUES ($1)
       ON CONFLICT ((LOWER(name))) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [orgName],
    );
    companyIdMap.set(orgName.toLowerCase(), result.rows[0].id);
    companiesCreated++;
  }
  console.log(`[Import] Upserted ${companiesCreated} companies`);

  // 4. Upsert contacts
  let imported = 0;
  let notesAttached = 0;

  for (const c of contacts) {
    const emails = c.emails
      ?.map((e) => e.value)
      .filter(Boolean) ?? [];
    const phones = c.phones
      ?.map((p) => p.value)
      .filter(Boolean) ?? [];

    const companyId = c.organization?.trim()
      ? companyIdMap.get(c.organization.trim().toLowerCase()) ?? null
      : null;

    let birthday: string | null = null;
    if (c.birthday && c.birthday.year && c.birthday.month && c.birthday.day) {
      birthday = `${c.birthday.year}-${String(c.birthday.month).padStart(2, "0")}-${String(c.birthday.day).padStart(2, "0")}`;
    }

    const address = c.addresses?.[0]
      ? {
          street: c.addresses[0].street || null,
          city: c.addresses[0].city || null,
          state: c.addresses[0].state || null,
          zip: c.addresses[0].postalCode || null,
          country: c.addresses[0].country || null,
        }
      : null;

    const socialProfiles = c.socialProfiles?.length
      ? c.socialProfiles
          .filter((sp) => sp.service !== "WIDGETS")
          .map((sp) => ({
            service: sp.service,
            username: sp.username,
            url: sp.url,
          }))
      : null;

    const notes = notesMap[c.id] || null;
    if (notes) notesAttached++;

    await query(
      `INSERT INTO contacts (
        apple_id, first_name, last_name, nickname, emails, phones,
        company_id, job_title, birthday, address, social_profiles,
        notes, source
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13
      )
      ON CONFLICT (apple_id) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        nickname = EXCLUDED.nickname,
        emails = EXCLUDED.emails,
        phones = EXCLUDED.phones,
        company_id = EXCLUDED.company_id,
        job_title = EXCLUDED.job_title,
        birthday = EXCLUDED.birthday,
        address = EXCLUDED.address,
        social_profiles = EXCLUDED.social_profiles,
        notes = COALESCE(EXCLUDED.notes, contacts.notes),
        updated_at = NOW()`,
      [
        c.id,
        c.firstName || null,
        c.lastName || null,
        c.nickname || null,
        emails,
        phones,
        companyId,
        c.jobTitle || null,
        birthday,
        address ? JSON.stringify(address) : null,
        socialProfiles ? JSON.stringify(socialProfiles) : null,
        notes,
        "apple-contacts",
      ],
    );
    imported++;
  }

  console.log(`[Import] Imported ${imported} contacts, ${notesAttached} with notes`);

  return { imported, companies: companiesCreated, notes: notesAttached };
}
