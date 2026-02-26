// Bookmarks Sync — bidirectional sync between Chrome Bookmarks JSON and JOI DB
// Supports deduplication, URL cleaning, agent suggestions, and read-later queue

import { readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { query } from "../db/client.js";

// ─── Types ───

export interface Bookmark {
  id: string;
  chrome_id: string | null;
  title: string;
  url: string;
  folder_path: string;
  description: string | null;
  tags: string[];
  status: string;
  source: string;
  suggested_by: string | null;
  suggestion_action: string | null;
  suggestion_reason: string | null;
  read_at: string | null;
  domain: string | null;
  url_clean: string | null;
  content_hash: string | null;
  chrome_date_added: string | null;
  last_synced_at: string | null;
  sync_dirty: boolean;
  created_at: string;
  updated_at: string;
}

interface ChromeBookmarkNode {
  id: string;
  name: string;
  type: "url" | "folder";
  url?: string;
  date_added?: string;
  date_modified?: string;
  children?: ChromeBookmarkNode[];
}

interface ChromeBookmarksFile {
  checksum: string;
  roots: Record<string, ChromeBookmarkNode>;
  version: number;
}

interface SyncResult {
  imported: number;
  updated: number;
  archived: number;
  conflicts: number;
  duplicates_removed: number;
  exported_to_chrome: number;
  errors: string[];
}

// Snapshot entry — what Chrome looked like at last sync
interface SnapshotEntry {
  chrome_id: string;
  title: string;
  url: string;
  folder_path: string;
  content_hash: string;
}
type ChromeSnapshot = Record<string, SnapshotEntry>; // keyed by content_hash

// ─── URL cleaning ───

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "gclsrc", "dclid", "msclkid",
  "mc_cid", "mc_eid", "ref", "referrer", "source",
  "_ga", "_gl", "yclid", "wickedid", "twclid",
  "igshid", "s", "si", "feature", "app",
]);

export function cleanUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    // Remove tracking params
    for (const param of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(param.toLowerCase())) {
        url.searchParams.delete(param);
      }
    }
    // Remove trailing hash if empty
    let clean = url.toString();
    if (clean.endsWith("#")) clean = clean.slice(0, -1);
    return clean;
  } catch {
    return rawUrl;
  }
}

export function urlHash(url: string): string {
  return createHash("md5").update(cleanUrl(url)).digest("hex");
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// ─── Chrome file operations ───

async function readChromeBookmarks(profilePath: string): Promise<ChromeBookmarksFile> {
  const content = await readFile(profilePath, "utf-8");
  return JSON.parse(content);
}

function flattenChromeBookmarks(
  node: ChromeBookmarkNode,
  path: string,
  out: Array<{ chrome_id: string; title: string; url: string; folder_path: string; date_added: string | null }>,
): void {
  if (node.type === "url" && node.url) {
    out.push({
      chrome_id: node.id,
      title: node.name || "",
      url: node.url,
      folder_path: path,
      date_added: node.date_added || null,
    });
    return;
  }
  if (node.children) {
    const folderPath = path ? `${path}/${node.name || ""}` : (node.name || "");
    for (const child of node.children) {
      flattenChromeBookmarks(child, folderPath, out);
    }
  }
}

// ─── DB operations ───

export async function listBookmarks(opts?: {
  folder?: string;
  status?: string;
  search?: string;
  domain?: string;
  source?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}): Promise<{ bookmarks: Bookmark[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts?.folder) { conditions.push(`folder_path = $${idx++}`); params.push(opts.folder); }
  if (opts?.status) { conditions.push(`status = $${idx++}`); params.push(opts.status); }
  if (opts?.domain) { conditions.push(`domain = $${idx++}`); params.push(opts.domain); }
  if (opts?.source) { conditions.push(`source = $${idx++}`); params.push(opts.source); }
  if (opts?.tag) { conditions.push(`$${idx++} = ANY(tags)`); params.push(opts.tag); }
  if (opts?.search) {
    conditions.push(`(title ILIKE $${idx} OR url ILIKE $${idx} OR description ILIKE $${idx})`);
    params.push(`%${opts.search}%`);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(opts?.limit || 100, 500);
  const offset = opts?.offset || 0;

  const [data, count] = await Promise.all([
    query<Bookmark>(
      `SELECT * FROM bookmarks ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM bookmarks ${where}`,
      params,
    ),
  ]);

  return { bookmarks: data.rows, total: parseInt(count.rows[0].count, 10) };
}

export async function getBookmark(id: string): Promise<Bookmark | null> {
  const result = await query<Bookmark>("SELECT * FROM bookmarks WHERE id = $1", [id]);
  return result.rows[0] || null;
}

export async function updateBookmark(
  id: string,
  data: Partial<{ title: string; folder_path: string; tags: string[]; status: string; description: string }>,
): Promise<Bookmark> {
  const updates: string[] = ["updated_at = NOW()", "sync_dirty = TRUE"];
  const params: unknown[] = [];
  let idx = 1;

  if (data.title !== undefined) { updates.push(`title = $${idx++}`); params.push(data.title); }
  if (data.folder_path !== undefined) { updates.push(`folder_path = $${idx++}`); params.push(data.folder_path); }
  if (data.tags !== undefined) { updates.push(`tags = $${idx++}`); params.push(data.tags); }
  if (data.status !== undefined) { updates.push(`status = $${idx++}`); params.push(data.status); }
  if (data.description !== undefined) { updates.push(`description = $${idx++}`); params.push(data.description); }

  params.push(id);
  const result = await query<Bookmark>(
    `UPDATE bookmarks SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
    params,
  );
  return result.rows[0];
}

export async function deleteBookmark(id: string): Promise<void> {
  await query("DELETE FROM bookmarks WHERE id = $1", [id]);
}

export async function createBookmark(data: {
  title: string;
  url: string;
  folder_path?: string;
  tags?: string[];
  status?: string;
  source?: string;
  suggested_by?: string;
  suggestion_action?: string;
  suggestion_reason?: string;
  description?: string;
}): Promise<Bookmark> {
  const clean = cleanUrl(data.url);
  const hash = urlHash(data.url);
  const domain = extractDomain(data.url);

  const result = await query<Bookmark>(
    `INSERT INTO bookmarks (title, url, folder_path, tags, status, source, suggested_by,
       suggestion_action, suggestion_reason, description, domain, url_clean, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      data.title, data.url, data.folder_path || "/",
      data.tags || [], data.status || "active", data.source || "manual",
      data.suggested_by || null, data.suggestion_action || null,
      data.suggestion_reason || null, data.description || null,
      domain, clean, hash,
    ],
  );
  return result.rows[0];
}

// ─── Folder operations ───

export async function listFolders(): Promise<Array<{ folder_path: string; count: number }>> {
  const result = await query<{ folder_path: string; count: string }>(
    `SELECT folder_path, COUNT(*) AS count FROM bookmarks
     WHERE status != 'suggested'
     GROUP BY folder_path ORDER BY folder_path`,
  );
  return result.rows.map((r) => ({ folder_path: r.folder_path, count: parseInt(r.count, 10) }));
}

export async function moveBookmarks(ids: string[], targetFolder: string): Promise<number> {
  const result = await query(
    `UPDATE bookmarks SET folder_path = $1, updated_at = NOW(), sync_dirty = TRUE WHERE id = ANY($2)`,
    [targetFolder, ids],
  );
  return result.rowCount || 0;
}

export async function bulkDelete(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await query("DELETE FROM bookmarks WHERE id = ANY($1)", [ids]);
  return result.rowCount || 0;
}

export async function bulkSetStatus(ids: string[], status: string): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await query(
    "UPDATE bookmarks SET status = $1, updated_at = NOW() WHERE id = ANY($2)",
    [status, ids],
  );
  return result.rowCount || 0;
}

export async function deleteFolder(folderPath: string): Promise<number> {
  // Delete all bookmarks in this folder and subfolders
  const result = await query(
    "DELETE FROM bookmarks WHERE folder_path = $1 OR folder_path LIKE $2",
    [folderPath, folderPath + "/%"],
  );
  return result.rowCount || 0;
}

export async function moveFolder(source: string, target: string): Promise<number> {
  // Rename folder_path for all bookmarks in source folder and subfolders
  const exact = await query(
    "UPDATE bookmarks SET folder_path = $2 WHERE folder_path = $1",
    [source, target],
  );
  const nested = await query(
    "UPDATE bookmarks SET folder_path = $2 || substr(folder_path, length($1) + 1) WHERE folder_path LIKE $1 || '/%'",
    [source, target],
  );
  return (exact.rowCount || 0) + (nested.rowCount || 0);
}

// ─── LLM-powered optimization ───

export async function findSemanticDuplicates(): Promise<Array<{
  group: Array<{ id: string; title: string; url: string; domain: string | null; folder_path: string }>;
  reason: string;
}>> {
  const { loadConfig } = await import("../config/loader.js");
  const config = loadConfig();
  const apiKey = config.auth.openrouterApiKey;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  // Get all active bookmarks (compact format for LLM)
  const all = await query<{ id: string; title: string; url: string; domain: string | null; folder_path: string }>(
    "SELECT id, title, url, domain, folder_path FROM bookmarks WHERE status = 'active' ORDER BY domain, title",
  );

  if (all.rows.length === 0) return [];

  // Batch into chunks of ~200 for token efficiency
  const BATCH_SIZE = 200;
  const allGroups: Array<{ group: Array<{ id: string; title: string; url: string; domain: string | null; folder_path: string }>; reason: string }> = [];

  for (let i = 0; i < all.rows.length; i += BATCH_SIZE) {
    const batch = all.rows.slice(i, i + BATCH_SIZE);
    const compact = batch.map((b, idx) => `${idx}|${b.title}|${b.url}|${b.domain || ""}|${b.folder_path}`).join("\n");

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [
          {
            role: "system",
            content: `You are a bookmark deduplication expert. Analyze bookmarks and find groups that are semantically duplicate (same page, different URLs/params, or very similar content). Also find bookmarks that could be better organized.
Return ONLY valid JSON array of groups: [{"indices":[0,3,5],"reason":"Same GitHub repo page"},...]. No other text.`,
          },
          {
            role: "user",
            content: `Find semantic duplicates in these bookmarks (format: index|title|url|domain|folder):\n${compact}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 2000,
      }),
    });

    const data = await res.json() as any;
    const text = data.choices?.[0]?.message?.content || "[]";

    try {
      // Extract JSON from response (might have markdown wrapping)
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) continue;
      const groups = JSON.parse(jsonMatch[0]) as Array<{ indices: number[]; reason: string }>;

      for (const g of groups) {
        if (g.indices && g.indices.length >= 2) {
          const groupBookmarks = g.indices
            .filter((idx: number) => idx >= 0 && idx < batch.length)
            .map((idx: number) => batch[idx]);
          if (groupBookmarks.length >= 2) {
            allGroups.push({ group: groupBookmarks, reason: g.reason || "Similar bookmarks" });
          }
        }
      }
    } catch {
      // Skip unparseable LLM response
    }
  }

  return allGroups;
}

// ─── Stats ───

export async function getBookmarkStats(): Promise<{
  total: number;
  active: number;
  read_later: number;
  suggested: number;
  archived: number;
  domains: number;
  folders: number;
  duplicates: number;
}> {
  const result = await query<Record<string, string>>(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'active') AS active,
      COUNT(*) FILTER (WHERE status = 'read_later') AS read_later,
      COUNT(*) FILTER (WHERE status = 'suggested') AS suggested,
      COUNT(*) FILTER (WHERE status = 'archived') AS archived,
      COUNT(DISTINCT domain) AS domains,
      COUNT(DISTINCT folder_path) AS folders,
      (SELECT COUNT(*) FROM (
        SELECT content_hash FROM bookmarks WHERE content_hash IS NOT NULL
        GROUP BY content_hash HAVING COUNT(*) > 1
      ) d) AS duplicates
    FROM bookmarks
  `);
  const r = result.rows[0];
  return {
    total: parseInt(r.total, 10),
    active: parseInt(r.active, 10),
    read_later: parseInt(r.read_later, 10),
    suggested: parseInt(r.suggested, 10),
    archived: parseInt(r.archived, 10),
    domains: parseInt(r.domains, 10),
    folders: parseInt(r.folders, 10),
    duplicates: parseInt(r.duplicates, 10),
  };
}

// ─── Sync engine (three-way merge) ───
//
// How it works:
// 1. Snapshot = what Chrome looked like at last sync (stored as JSONB)
// 2. Chrome now = current Chrome Bookmarks file
// 3. JOI DB = current bookmarks in our database
//
// Diff snapshot vs Chrome now → Chrome-side changes (added/deleted/moved/renamed)
// Diff snapshot vs JOI DB (sync_dirty flag) → JOI-side changes
// Merge with JOI-wins conflict resolution.

function buildSnapshot(
  flat: Array<{ chrome_id: string; title: string; url: string; folder_path: string; date_added: string | null }>,
): ChromeSnapshot {
  const snap: ChromeSnapshot = {};
  for (const b of flat) {
    const hash = urlHash(b.url);
    snap[hash] = { chrome_id: b.chrome_id, title: b.title, url: b.url, folder_path: b.folder_path, content_hash: hash };
  }
  return snap;
}

export async function syncFromChrome(): Promise<SyncResult> {
  const stateResult = await query<{ profile_path: string; last_checksum: string | null; chrome_snapshot: ChromeSnapshot | null }>(
    "SELECT profile_path, last_checksum, chrome_snapshot FROM bookmark_sync_state WHERE id = 'chrome'",
  );
  if (stateResult.rows.length === 0) throw new Error("No Chrome sync state configured");

  const { profile_path, chrome_snapshot } = stateResult.rows[0];
  const snapshot: ChromeSnapshot = chrome_snapshot && Object.keys(chrome_snapshot).length > 0 ? chrome_snapshot : {};
  const isFirstSync = Object.keys(snapshot).length === 0;

  const result: SyncResult = { imported: 0, updated: 0, archived: 0, conflicts: 0, duplicates_removed: 0, exported_to_chrome: 0, errors: [] };

  // 1. Read current Chrome bookmarks
  let chromeData: ChromeBookmarksFile;
  try {
    chromeData = await readChromeBookmarks(profile_path);
  } catch (err) {
    throw new Error(`Failed to read Chrome bookmarks: ${err}`);
  }

  // Flatten Chrome bookmarks
  const chromeFlat: Array<{ chrome_id: string; title: string; url: string; folder_path: string; date_added: string | null }> = [];
  for (const [rootKey, rootNode] of Object.entries(chromeData.roots)) {
    if (rootNode && rootNode.children) {
      flattenChromeBookmarks(rootNode, rootKey, chromeFlat);
    }
  }
  const chromeNow = buildSnapshot(chromeFlat);

  // 2. Load JOI bookmarks (with chrome source)
  const joiAll = await query<Bookmark & { sync_dirty: boolean }>(
    "SELECT *, sync_dirty FROM bookmarks WHERE source = 'chrome'",
  );
  const joiByHash = new Map(joiAll.rows.filter((r) => r.content_hash).map((r) => [r.content_hash!, r]));

  // 3. Diff: what changed in Chrome since snapshot?
  if (isFirstSync) {
    // First sync: just import everything new, build snapshot
    console.log("[Bookmarks] First sync — importing new bookmarks, building snapshot");
    for (const [hash, entry] of Object.entries(chromeNow)) {
      if (joiByHash.has(hash)) continue; // Already in DB
      try {
        const clean = cleanUrl(entry.url);
        const domain = extractDomain(entry.url);
        await query(
          `INSERT INTO bookmarks (chrome_id, title, url, folder_path, domain, url_clean, content_hash,
             source, status, last_synced_at, sync_dirty)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'chrome', 'active', NOW(), FALSE)
           ON CONFLICT DO NOTHING`,
          [entry.chrome_id, entry.title, entry.url, entry.folder_path, domain, clean, hash],
        );
        result.imported++;
      } catch (err) {
        result.errors.push(`Import: ${entry.url} — ${err}`);
      }
    }
  } else {
    // Three-way merge

    // Chrome additions: in chromeNow but not in snapshot
    for (const [hash, entry] of Object.entries(chromeNow)) {
      if (snapshot[hash]) continue; // Was already known
      if (joiByHash.has(hash)) continue; // Already in JOI
      try {
        const clean = cleanUrl(entry.url);
        const domain = extractDomain(entry.url);
        await query(
          `INSERT INTO bookmarks (chrome_id, title, url, folder_path, domain, url_clean, content_hash,
             source, status, last_synced_at, sync_dirty)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'chrome', 'active', NOW(), FALSE)
           ON CONFLICT DO NOTHING`,
          [entry.chrome_id, entry.title, entry.url, entry.folder_path, domain, clean, hash],
        );
        result.imported++;
      } catch (err) {
        result.errors.push(`Import: ${entry.url} — ${err}`);
      }
    }

    // Chrome deletions: in snapshot but not in chromeNow
    for (const [hash, snapEntry] of Object.entries(snapshot)) {
      if (chromeNow[hash]) continue; // Still in Chrome
      const joi = joiByHash.get(hash);
      if (!joi) continue; // Already gone from JOI too

      if (joi.sync_dirty) {
        // Conflict: JOI modified it but Chrome deleted it → JOI wins, keep it
        result.conflicts++;
      } else {
        // Chrome deleted, JOI didn't touch it → archive in JOI
        await query(
          "UPDATE bookmarks SET status = 'archived', updated_at = NOW(), sync_dirty = FALSE WHERE id = $1",
          [joi.id],
        );
        result.archived++;
      }
    }

    // Chrome moves/renames: in both snapshot and chromeNow but folder or title changed
    for (const [hash, entry] of Object.entries(chromeNow)) {
      const snapEntry = snapshot[hash];
      if (!snapEntry) continue; // New in Chrome, already handled above
      const joi = joiByHash.get(hash);
      if (!joi) continue;

      const chromeMoved = entry.folder_path !== snapEntry.folder_path;
      const chromeRenamed = entry.title !== snapEntry.title;
      if (!chromeMoved && !chromeRenamed) continue;

      if (joi.sync_dirty) {
        // Conflict: both sides changed → JOI wins
        result.conflicts++;
      } else {
        // Apply Chrome's changes to JOI
        const updates: string[] = ["updated_at = NOW()", "sync_dirty = FALSE", "last_synced_at = NOW()"];
        const params: unknown[] = [];
        let idx = 1;
        if (chromeMoved) { updates.push(`folder_path = $${idx++}`); params.push(entry.folder_path); }
        if (chromeRenamed) { updates.push(`title = $${idx++}`); params.push(entry.title); }
        params.push(joi.id);
        await query(`UPDATE bookmarks SET ${updates.join(", ")} WHERE id = $${idx}`, params);
        result.updated++;
      }
    }
  }

  // 4. Clear sync_dirty on all chrome-source bookmarks that weren't conflicted
  await query(
    "UPDATE bookmarks SET sync_dirty = FALSE, last_synced_at = NOW() WHERE source = 'chrome' AND sync_dirty = TRUE AND status != 'archived'",
  );

  // 5. Save new snapshot
  const newSnapshot = buildSnapshot(chromeFlat);
  const fileHash = createHash("md5").update(JSON.stringify(chromeData)).digest("hex");
  await query(
    `UPDATE bookmark_sync_state SET last_sync_at = NOW(), last_checksum = $1,
       bookmarks_count = $2, chrome_snapshot = $3, updated_at = NOW() WHERE id = 'chrome'`,
    [fileHash, chromeFlat.length, JSON.stringify(newSnapshot)],
  );

  return result;
}

export async function exportToChrome(): Promise<SyncResult> {
  const stateResult = await query<{ profile_path: string }>(
    "SELECT profile_path FROM bookmark_sync_state WHERE id = 'chrome'",
  );
  if (stateResult.rows.length === 0) throw new Error("No Chrome sync state configured");

  const { profile_path } = stateResult.rows[0];
  const result: SyncResult = { imported: 0, updated: 0, archived: 0, conflicts: 0, duplicates_removed: 0, exported_to_chrome: 0, errors: [] };

  // Backup current Chrome bookmarks
  await copyFile(profile_path, profile_path + ".bak");

  // Read current Chrome bookmarks
  const chromeData = await readChromeBookmarks(profile_path);

  // Get bookmarks that were added via JOI (source != 'chrome') and are active
  const joiBookmarks = await query<Bookmark>(
    "SELECT * FROM bookmarks WHERE source != 'chrome' AND status = 'active'",
  );

  // Collect existing Chrome URLs for dedup
  const chromeUrls = new Set<string>();
  for (const rootNode of Object.values(chromeData.roots)) {
    if (rootNode && rootNode.children) {
      const flat: Array<{ url: string }> = [];
      flattenChromeBookmarks(rootNode, "", flat as any);
      flat.forEach((b) => { if ((b as any).url) chromeUrls.add((b as any).url); });
    }
  }

  // Find or create "JOI" folder in bookmark_bar
  const bar = chromeData.roots.bookmark_bar;
  if (bar && bar.children) {
    let joiFolder = bar.children.find((c) => c.name === "JOI" && c.type === "folder");
    if (!joiFolder) {
      joiFolder = {
        id: String(Date.now()),
        name: "JOI",
        type: "folder",
        children: [],
        date_added: String(Date.now() * 1000),
      };
      bar.children.unshift(joiFolder);
    }

    for (const bm of joiBookmarks.rows) {
      if (chromeUrls.has(bm.url)) continue;

      // Find or create subfolder within JOI
      let targetFolder = joiFolder;
      if (bm.folder_path && bm.folder_path !== "/") {
        const parts = bm.folder_path.split("/").filter(Boolean);
        for (const part of parts) {
          let sub = targetFolder.children?.find((c) => c.name === part && c.type === "folder");
          if (!sub) {
            sub = {
              id: String(Date.now() + Math.random() * 1000),
              name: part,
              type: "folder",
              children: [],
              date_added: String(Date.now() * 1000),
            };
            targetFolder.children = targetFolder.children || [];
            targetFolder.children.push(sub);
          }
          targetFolder = sub;
        }
      }

      targetFolder.children = targetFolder.children || [];
      targetFolder.children.push({
        id: String(Date.now() + Math.random() * 10000),
        name: bm.title,
        type: "url",
        url: bm.url,
        date_added: String(Date.now() * 1000),
      });
      result.exported_to_chrome++;
    }
  }

  // Remove checksum so Chrome recalculates it
  delete (chromeData as any).checksum;

  // Write back
  await writeFile(profile_path, JSON.stringify(chromeData, null, 3));

  return result;
}

// ─── Deduplication ───

export async function findDuplicates(): Promise<Array<{ content_hash: string; count: number; bookmarks: Bookmark[] }>> {
  const dupes = await query<{ content_hash: string; count: string }>(
    `SELECT content_hash, COUNT(*) AS count FROM bookmarks
     WHERE content_hash IS NOT NULL
     GROUP BY content_hash HAVING COUNT(*) > 1
     ORDER BY count DESC LIMIT 50`,
  );

  const results = [];
  for (const d of dupes.rows) {
    const bms = await query<Bookmark>(
      "SELECT * FROM bookmarks WHERE content_hash = $1 ORDER BY created_at",
      [d.content_hash],
    );
    results.push({
      content_hash: d.content_hash,
      count: parseInt(d.count, 10),
      bookmarks: bms.rows,
    });
  }
  return results;
}

export async function removeDuplicates(): Promise<number> {
  // Keep the oldest bookmark for each content_hash, delete newer duplicates
  const result = await query(
    `DELETE FROM bookmarks WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (PARTITION BY content_hash ORDER BY created_at) AS rn
         FROM bookmarks WHERE content_hash IS NOT NULL
       ) ranked WHERE rn > 1
     )`,
  );
  return result.rowCount || 0;
}

// ─── Agent suggestions ───

export async function suggestBookmark(data: {
  title: string;
  url: string;
  folder_path?: string;
  agent_id: string;
  action: string;
  reason: string;
}): Promise<Bookmark> {
  return createBookmark({
    title: data.title,
    url: data.url,
    folder_path: data.folder_path || "/Agent Suggestions",
    status: "suggested",
    source: "agent",
    suggested_by: data.agent_id,
    suggestion_action: data.action,
    suggestion_reason: data.reason,
  });
}

export async function approveSuggestion(id: string): Promise<Bookmark> {
  return updateBookmark(id, { status: "active" });
}

export async function rejectSuggestion(id: string): Promise<void> {
  await deleteBookmark(id);
}

export async function listSuggestions(): Promise<Bookmark[]> {
  const result = await query<Bookmark>(
    "SELECT * FROM bookmarks WHERE status = 'suggested' ORDER BY created_at DESC",
  );
  return result.rows;
}

// ─── Read Later ───

export async function markReadLater(id: string): Promise<Bookmark> {
  return updateBookmark(id, { status: "read_later" });
}

export async function markRead(id: string): Promise<Bookmark> {
  await query("UPDATE bookmarks SET read_at = NOW(), status = 'active', updated_at = NOW() WHERE id = $1", [id]);
  const result = await query<Bookmark>("SELECT * FROM bookmarks WHERE id = $1", [id]);
  return result.rows[0];
}

export async function getReadLaterQueue(): Promise<Bookmark[]> {
  const result = await query<Bookmark>(
    "SELECT * FROM bookmarks WHERE status = 'read_later' ORDER BY created_at DESC",
  );
  return result.rows;
}

// ─── Sync state ───

export async function getSyncState(): Promise<{
  profile_path: string;
  last_sync_at: string | null;
  last_checksum: string | null;
  bookmarks_count: number;
}> {
  const result = await query<any>(
    "SELECT * FROM bookmark_sync_state WHERE id = 'chrome'",
  );
  return result.rows[0] || { profile_path: "", last_sync_at: null, last_checksum: null, bookmarks_count: 0 };
}
