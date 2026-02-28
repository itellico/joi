import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type pg from "pg";
import { close, transaction } from "../db/client.js";

dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), "../../../../.env") });

const CONTACT_NAME_KEY_SQL = `
  COALESCE(
    NULLIF(
      lower(
        regexp_replace(
          trim(
            concat_ws(
              ' ',
              regexp_replace(coalesce(c.first_name, ''), '\\s+\\d+$', '', 'g'),
              regexp_replace(coalesce(c.last_name, ''), '\\s+\\d+$', '', 'g')
            )
          ),
          '\\s+',
          ' ',
          'g'
        )
      ),
      ''
    ),
    NULLIF(
      lower(
        regexp_replace(
          trim(regexp_replace(coalesce(c.nickname, ''), '\\s+\\d+$', '', 'g')),
          '\\s+',
          ' ',
          'g'
        )
      ),
      ''
    ),
    ''
  )
`;

const CONTACT_DEDUPE_KEY_SQL = `
  COALESCE(
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM unnest(c.emails) AS email
        WHERE NULLIF(lower(trim(email)), '') IS NOT NULL
      ) THEN 'email:' || array_to_string(
        ARRAY(
          SELECT DISTINCT lower(trim(email))
          FROM unnest(c.emails) AS email
          WHERE NULLIF(lower(trim(email)), '') IS NOT NULL
          ORDER BY lower(trim(email))
        ),
        '|'
      )
      || '|name:' || (${CONTACT_NAME_KEY_SQL})
      WHEN EXISTS (
        SELECT 1
        FROM unnest(c.phones) AS phone
        WHERE NULLIF(regexp_replace(phone, '\\D', '', 'g'), '') IS NOT NULL
      ) THEN 'phone:' || array_to_string(
        ARRAY(
          SELECT DISTINCT regexp_replace(phone, '\\D', '', 'g')
          FROM unnest(c.phones) AS phone
          WHERE NULLIF(regexp_replace(phone, '\\D', '', 'g'), '') IS NOT NULL
          ORDER BY regexp_replace(phone, '\\D', '', 'g')
        ),
        '|'
      )
      || '|name:' || (${CONTACT_NAME_KEY_SQL})
      ELSE NULL
    END,
    'id:' || c.id::text
  )
`;

const CONTACT_COMPLETENESS_SQL = `
  COALESCE(cardinality(c.emails), 0)
  + COALESCE(cardinality(c.phones), 0)
  + CASE WHEN c.notes IS NOT NULL AND btrim(c.notes) <> '' THEN 1 ELSE 0 END
  + CASE WHEN c.company_id IS NOT NULL THEN 1 ELSE 0 END
  + CASE WHEN c.job_title IS NOT NULL AND btrim(c.job_title) <> '' THEN 1 ELSE 0 END
`;

type RefColumn = {
  schema_name: string;
  table_name: string;
  column_name: string;
};

type Preview = {
  dedupe_key: string;
  count: number;
  names: string[];
};

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function relationSql(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

function columnSql(column: string): string {
  return quoteIdent(column);
}

async function buildDedupeMap(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TEMP TABLE contact_dedupe_map ON COMMIT DROP AS
    WITH ranked AS (
      SELECT
        c.id,
        ${CONTACT_DEDUPE_KEY_SQL} AS dedupe_key,
        row_number() OVER (
          PARTITION BY ${CONTACT_DEDUPE_KEY_SQL}
          ORDER BY ${CONTACT_COMPLETENESS_SQL} DESC, c.updated_at DESC NULLS LAST, c.created_at DESC NULLS LAST, c.id DESC
        ) AS rn,
        first_value(c.id) OVER (
          PARTITION BY ${CONTACT_DEDUPE_KEY_SQL}
          ORDER BY ${CONTACT_COMPLETENESS_SQL} DESC, c.updated_at DESC NULLS LAST, c.created_at DESC NULLS LAST, c.id DESC
        ) AS canonical_id
      FROM contacts c
    )
    SELECT
      id AS duplicate_id,
      canonical_id,
      dedupe_key
    FROM ranked
    WHERE rn > 1
  `);

  await client.query("CREATE INDEX ON contact_dedupe_map (duplicate_id)");
  await client.query("CREATE INDEX ON contact_dedupe_map (canonical_id)");
}

async function getRefColumns(client: pg.PoolClient): Promise<RefColumn[]> {
  const [fkColumns, contactIdColumns] = await Promise.all([
    client.query<RefColumn>(`
      SELECT DISTINCT
        nsp.nspname AS schema_name,
        rel.relname AS table_name,
        att.attname AS column_name
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      JOIN pg_class confrel ON confrel.oid = con.confrelid
      JOIN unnest(con.conkey) AS cols(attnum) ON true
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = cols.attnum
      WHERE con.contype = 'f'
        AND nsp.nspname = 'public'
        AND confrel.relname = 'contacts'
    `),
    client.query<RefColumn>(`
      SELECT table_schema AS schema_name, table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'contact_id'
        AND table_name <> 'contacts'
    `),
  ]);

  const key = (r: RefColumn) => `${r.schema_name}.${r.table_name}.${r.column_name}`;
  const merged = new Map<string, RefColumn>();
  for (const row of [...fkColumns.rows, ...contactIdColumns.rows]) {
    merged.set(key(row), row);
  }
  return [...merged.values()].sort((a, b) => {
    const t = a.table_name.localeCompare(b.table_name);
    return t !== 0 ? t : a.column_name.localeCompare(b.column_name);
  });
}

async function getCounts(client: pg.PoolClient): Promise<{ total: number; duplicates: number; groups: number }> {
  const [totalRes, dupRes] = await Promise.all([
    client.query<{ count: number }>("SELECT count(*)::int AS count FROM contacts"),
    client.query<{ duplicates: number; groups: number }>(`
      SELECT
        count(*)::int AS duplicates,
        count(DISTINCT canonical_id)::int AS groups
      FROM contact_dedupe_map
    `),
  ]);
  return {
    total: totalRes.rows[0]?.count ?? 0,
    duplicates: dupRes.rows[0]?.duplicates ?? 0,
    groups: dupRes.rows[0]?.groups ?? 0,
  };
}

async function getPreview(client: pg.PoolClient): Promise<Preview[]> {
  const result = await client.query<Preview>(`
    WITH groups AS (
      SELECT canonical_id, dedupe_key, count(*)::int + 1 AS count
      FROM contact_dedupe_map
      GROUP BY canonical_id, dedupe_key
      ORDER BY count(*) DESC, dedupe_key
      LIMIT 12
    )
    SELECT
      g.dedupe_key,
      g.count,
      ARRAY(
        SELECT DISTINCT NULLIF(trim(concat_ws(' ', c2.first_name, c2.last_name)), '')
        FROM contacts c2
        WHERE c2.id = g.canonical_id
           OR c2.id IN (
             SELECT duplicate_id
             FROM contact_dedupe_map dm
             WHERE dm.canonical_id = g.canonical_id
           )
      ) AS names
    FROM groups g
  `);
  return result.rows.map((row) => ({
    dedupe_key: row.dedupe_key,
    count: row.count,
    names: (row.names || []).filter(Boolean).slice(0, 6),
  }));
}

async function mergeCanonicalContacts(client: pg.PoolClient): Promise<number> {
  const result = await client.query(`
    WITH canonical_ids AS (
      SELECT DISTINCT canonical_id
      FROM contact_dedupe_map
    ),
    members AS (
      SELECT canonical_id, canonical_id AS member_id
      FROM canonical_ids
      UNION ALL
      SELECT canonical_id, duplicate_id AS member_id
      FROM contact_dedupe_map
    ),
    aggregated AS (
      SELECT
        ci.canonical_id,
        COALESCE((
          SELECT ARRAY_AGG(DISTINCT lower(trim(email)) ORDER BY lower(trim(email)))
          FROM members m
          JOIN contacts cx ON cx.id = m.member_id
          CROSS JOIN LATERAL unnest(cx.emails) AS email
          WHERE m.canonical_id = ci.canonical_id
            AND NULLIF(lower(trim(email)), '') IS NOT NULL
        ), '{}'::text[]) AS merged_emails,
        COALESCE((
          SELECT ARRAY_AGG(DISTINCT regexp_replace(phone, '\\D', '', 'g') ORDER BY regexp_replace(phone, '\\D', '', 'g'))
          FROM members m
          JOIN contacts cx ON cx.id = m.member_id
          CROSS JOIN LATERAL unnest(cx.phones) AS phone
          WHERE m.canonical_id = ci.canonical_id
            AND NULLIF(regexp_replace(phone, '\\D', '', 'g'), '') IS NOT NULL
        ), '{}'::text[]) AS merged_phones,
        COALESCE((
          SELECT ARRAY_AGG(DISTINCT tag ORDER BY tag)
          FROM members m
          JOIN contacts cx ON cx.id = m.member_id
          CROSS JOIN LATERAL unnest(cx.tags) AS tag
          WHERE m.canonical_id = ci.canonical_id
            AND NULLIF(btrim(tag), '') IS NOT NULL
        ), '{}'::text[]) AS merged_tags,
        (
          SELECT MAX(cx.last_contacted_at)
          FROM members m
          JOIN contacts cx ON cx.id = m.member_id
          WHERE m.canonical_id = ci.canonical_id
        ) AS max_last_contacted_at,
        (
          SELECT (ARRAY_AGG(NULLIF(btrim(cx.notes), '') ORDER BY length(NULLIF(btrim(cx.notes), '')) DESC))[1]
          FROM members m
          JOIN contacts cx ON cx.id = m.member_id
          WHERE m.canonical_id = ci.canonical_id
            AND NULLIF(btrim(cx.notes), '') IS NOT NULL
        ) AS best_notes,
        (
          SELECT (ARRAY_AGG(cx.company_id ORDER BY cx.company_id::text))[1]
          FROM members m
          JOIN contacts cx ON cx.id = m.member_id
          WHERE m.canonical_id = ci.canonical_id
            AND cx.company_id IS NOT NULL
        ) AS any_company_id,
        (
          SELECT (ARRAY_AGG(NULLIF(btrim(cx.job_title), '') ORDER BY length(NULLIF(btrim(cx.job_title), '')) DESC))[1]
          FROM members m
          JOIN contacts cx ON cx.id = m.member_id
          WHERE m.canonical_id = ci.canonical_id
            AND NULLIF(btrim(cx.job_title), '') IS NOT NULL
        ) AS best_job_title,
        (
          SELECT (ARRAY_AGG(cx.birthday ORDER BY cx.birthday DESC))[1]
          FROM members m
          JOIN contacts cx ON cx.id = m.member_id
          WHERE m.canonical_id = ci.canonical_id
            AND cx.birthday IS NOT NULL
        ) AS any_birthday,
        COALESCE((
          SELECT ARRAY_AGG(DISTINCT cx.apple_id ORDER BY cx.apple_id)
          FROM members m
          JOIN contacts cx ON cx.id = m.member_id
          WHERE m.canonical_id = ci.canonical_id
            AND cx.apple_id IS NOT NULL
            AND btrim(cx.apple_id) <> ''
        ), '{}'::text[]) AS merged_apple_ids
      FROM canonical_ids ci
    )
    UPDATE contacts c
    SET
      emails = a.merged_emails,
      phones = a.merged_phones,
      tags = a.merged_tags,
      notes = CASE
        WHEN NULLIF(btrim(c.notes), '') IS NULL THEN a.best_notes
        WHEN a.best_notes IS NULL THEN c.notes
        WHEN c.notes = a.best_notes THEN c.notes
        ELSE c.notes || E'\\n\\n--- merged duplicate note ---\\n' || a.best_notes
      END,
      company_id = COALESCE(c.company_id, a.any_company_id),
      job_title = COALESCE(NULLIF(btrim(c.job_title), ''), a.best_job_title),
      birthday = COALESCE(c.birthday, a.any_birthday),
      last_contacted_at = CASE
        WHEN c.last_contacted_at IS NULL THEN a.max_last_contacted_at
        WHEN a.max_last_contacted_at IS NULL THEN c.last_contacted_at
        ELSE GREATEST(c.last_contacted_at, a.max_last_contacted_at)
      END,
      extra = jsonb_set(
        COALESCE(c.extra, '{}'::jsonb),
        '{merged_apple_ids}',
        to_jsonb(a.merged_apple_ids),
        true
      ),
      updated_at = NOW()
    FROM aggregated a
    WHERE c.id = a.canonical_id
  `);
  return result.rowCount ?? 0;
}

async function rewriteReferences(client: pg.PoolClient, refs: RefColumn[]): Promise<Record<string, number>> {
  const stats: Record<string, number> = {};

  for (const ref of refs) {
    const key = `${ref.table_name}.${ref.column_name}`;
    const tableRef = relationSql(ref.schema_name, ref.table_name);
    const colRef = columnSql(ref.column_name);

    if (ref.table_name === "contact_task_links" && ref.column_name === "contact_id") {
      await client.query(`
        INSERT INTO ${tableRef} (contact_id, things_task_uuid, linked_at)
        SELECT DISTINCT m.canonical_id, t.things_task_uuid, t.linked_at
        FROM ${tableRef} t
        JOIN contact_dedupe_map m ON t.contact_id = m.duplicate_id
        ON CONFLICT (contact_id, things_task_uuid) DO NOTHING
      `);
      const deleted = await client.query(`
        DELETE FROM ${tableRef} t
        USING contact_dedupe_map m
        WHERE t.contact_id = m.duplicate_id
      `);
      stats[key] = deleted.rowCount ?? 0;
      continue;
    }

    const updated = await client.query(`
      UPDATE ${tableRef} t
      SET ${colRef} = m.canonical_id
      FROM contact_dedupe_map m
      WHERE t.${colRef} = m.duplicate_id
    `);
    stats[key] = updated.rowCount ?? 0;
  }

  return stats;
}

async function run(apply: boolean): Promise<void> {
  const result = await transaction(async (client) => {
    await buildDedupeMap(client);
    const counts = await getCounts(client);
    const preview = await getPreview(client);

    if (!apply || counts.duplicates === 0) {
      return {
        mode: apply ? "apply-noop" : "dry-run",
        ...counts,
        dedupedTotal: counts.total - counts.duplicates,
        preview,
      };
    }

    const refs = await getRefColumns(client);
    const merged = await mergeCanonicalContacts(client);
    const rewired = await rewriteReferences(client, refs);
    const deleted = await client.query(`
      DELETE FROM contacts c
      USING contact_dedupe_map m
      WHERE c.id = m.duplicate_id
    `);

    const finalCount = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM contacts");
    return {
      mode: "apply",
      ...counts,
      dedupedTotal: finalCount.rows[0]?.count ?? 0,
      canonicalMerged: merged,
      deletedContacts: deleted.rowCount ?? 0,
      rewired,
      preview,
    };
  });

  console.log(JSON.stringify(result, null, 2));
}

const apply = process.argv.includes("--apply");

run(apply)
  .catch((err) => {
    console.error("[contacts:dedupe] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close();
  });
