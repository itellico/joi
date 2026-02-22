import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DB_PATH =
  "/Users/mm2/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-6J5JX/Things Database.thingsdatabase/main.sqlite";

const MOJIBAKE_TOKENS = ["Ã¤", "Ã¶", "Ã¼", "Ã„", "Ã–", "Ãœ", "ÃŸ", "Â ", "â€™", "â€œ", "â€“", "â€”", "â€"] as const;

function unixSecondsToDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function maybeRepairMojibake(input: string): string {
  if (!MOJIBAKE_TOKENS.some((token) => input.includes(token))) return input;
  try {
    const repaired = Buffer.from(input, "latin1").toString("utf8");
    const inputHits = MOJIBAKE_TOKENS.reduce((sum, token) => sum + (input.includes(token) ? 1 : 0), 0);
    const repairedHits = MOJIBAKE_TOKENS.reduce((sum, token) => sum + (repaired.includes(token) ? 1 : 0), 0);
    return repairedHits < inputHits ? repaired : input;
  } catch {
    return input;
  }
}

function normalizeThingsText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return maybeRepairMojibake(value).normalize("NFC");
  if (Buffer.isBuffer(value)) return maybeRepairMojibake(value.toString("utf8")).normalize("NFC");
  return maybeRepairMojibake(String(value)).normalize("NFC");
}

// Things3 stores startDate/deadline as bit-packed integers:
// (year << 16) | (month << 12) | ((day-1) << 7)
function thingsPackedDateToString(packed: number): string | null {
  try {
    const year = (packed >> 16) & 0xffff;
    const month = (packed >> 12) & 0xf;
    const day = ((packed >> 7) & 0x1f) + 1;
    if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  } catch {
    return null;
  }
}

export type ThingsList = "inbox" | "today" | "upcoming" | "anytime" | "someday";

export interface ChecklistItem {
  uuid: string;
  title: string;
  completed: boolean;
  index: number;
}

export interface CompletedTask {
  uuid: string;
  title: string;
  projectTitle: string | null;
  areaTitle: string | null;
  completedAt: string;
}

export interface ThingsTask {
  uuid: string;
  title: string;
  notes: string | null;
  list: ThingsList;
  projectUuid: string | null;
  projectTitle: string | null;
  headingTitle: string | null;
  areaUuid: string | null;
  areaTitle: string | null;
  tags: string[];
  checklist: ChecklistItem[];
  startDate: string | null;
  deadline: string | null;
  createdAt: string;
  checklistTotal: number;
  checklistDone: number;
  todayIndex: number;
  index: number;
}

export interface ThingsProject {
  uuid: string;
  title: string;
  notes: string | null;
  areaUuid: string | null;
  areaTitle: string | null;
  taskCount: number;
}

export interface ThingsArea {
  uuid: string;
  title: string;
}

function openDb(): Database.Database {
  return new Database(DB_PATH, { readonly: true, fileMustExist: true });
}

function openDbWritable(): Database.Database {
  return new Database(DB_PATH, { readonly: false, fileMustExist: true });
}

function todayPacked(): number {
  const now = new Date();
  return (now.getFullYear() << 16) | ((now.getMonth() + 1) << 12) | ((now.getDate() - 1) << 7);
}

function classifyList(start: number, startBucket: number, startDate: number | null): ThingsList {
  if (start === 0) return "inbox";
  if (start === 2) return "someday";
  // start === 1
  if (startBucket === 1) return "today";
  if (startDate && startDate > 0) {
    // URL scheme sets startDate to today's packed date instead of startBucket=1
    if (startDate <= todayPacked()) return "today";
    return "upcoming";
  }
  return "anytime";
}

export function getActiveTasks(): ThingsTask[] {
  const db = openDb();
  try {
    // type=0 -> regular task, status=0 -> open, trashed=0
    // Tasks link to projects either via t.project OR through their heading (h.project)
    const rows = db.prepare(`
      SELECT
        t.uuid, t.title, t.notes,
        t.start, t.startBucket, t.startDate, t.deadline,
        t.creationDate, t.todayIndex, t."index",
        COALESCE(t.project, h.project) AS projectUuid,
        t.area AS areaUuid,
        t.checklistItemsCount, t.openChecklistItemsCount,
        COALESCE(p.title, hp.title) AS projectTitle,
        h.title AS headingTitle,
        COALESCE(a.title, pa.title, hpa.title) AS areaTitle,
        COALESCE(t.area, p.area, hp.area) AS resolvedAreaUuid
      FROM TMTask t
      LEFT JOIN TMTask h ON h.uuid = t.heading AND h.type = 2
      LEFT JOIN TMTask p ON p.uuid = t.project AND p.type = 1
      LEFT JOIN TMTask hp ON hp.uuid = h.project AND hp.type = 1
      LEFT JOIN TMArea a ON a.uuid = t.area
      LEFT JOIN TMArea pa ON pa.uuid = p.area
      LEFT JOIN TMArea hpa ON hpa.uuid = hp.area
      WHERE t.type = 0
        AND t.status = 0
        AND t.trashed = 0
        AND t.rt1_repeatingTemplate IS NULL
      ORDER BY t."index" ASC
    `).all() as any[];

    // Fetch all task-tag mappings in one query
    const tagRows = db.prepare(`
      SELECT tt.tasks AS taskUuid, tg.title AS tagTitle
      FROM TMTaskTag tt
      JOIN TMTag tg ON tg.uuid = tt.tags
    `).all() as { taskUuid: string; tagTitle: string }[];

    const tagMap = new Map<string, string[]>();
    for (const row of tagRows) {
      const tagTitle = normalizeThingsText(row.tagTitle);
      const arr = tagMap.get(row.taskUuid);
      if (arr) arr.push(tagTitle);
      else tagMap.set(row.taskUuid, [tagTitle]);
    }

    const taskUuids = rows.map((r) => r.uuid as string);
    const checklistMap = fetchChecklistItems(db, taskUuids);

    return rows.map((r) => ({
      uuid: r.uuid,
      title: normalizeThingsText(r.title),
      notes: r.notes == null ? null : normalizeThingsText(r.notes),
      list: classifyList(r.start, r.startBucket, r.startDate),
      projectUuid: r.projectUuid || null,
      projectTitle: r.projectTitle == null ? null : normalizeThingsText(r.projectTitle),
      headingTitle: r.headingTitle == null ? null : normalizeThingsText(r.headingTitle),
      areaUuid: r.resolvedAreaUuid || null,
      areaTitle: r.areaTitle == null ? null : normalizeThingsText(r.areaTitle),
      tags: tagMap.get(r.uuid) || [],
      checklist: checklistMap.get(r.uuid) || [],
      startDate: r.startDate ? thingsPackedDateToString(r.startDate) : null,
      deadline: r.deadline ? thingsPackedDateToString(r.deadline) : null,
      createdAt: r.creationDate ? unixSecondsToDate(r.creationDate) : new Date().toISOString(),
      checklistTotal: r.checklistItemsCount || 0,
      checklistDone: (r.checklistItemsCount || 0) - (r.openChecklistItemsCount || 0),
      todayIndex: r.todayIndex ?? 0,
      index: r.index ?? 0,
    }));
  } finally {
    db.close();
  }
}

export function getProjects(): ThingsProject[] {
  const db = openDb();
  try {
    const rows = db.prepare(`
      SELECT
        p.uuid, p.title, p.notes, p.area AS areaUuid, a.title AS areaTitle,
        (
          SELECT count(*) FROM TMTask c
          WHERE c.type = 0 AND c.status = 0 AND c.trashed = 0
            AND (c.project = p.uuid
              OR c.heading IN (SELECT h.uuid FROM TMTask h WHERE h.project = p.uuid AND h.type = 2))
        ) AS taskCount
      FROM TMTask p
      LEFT JOIN TMArea a ON a.uuid = p.area
      WHERE p.type = 1
        AND p.status = 0
        AND p.trashed = 0
      ORDER BY p."index" ASC
    `).all() as Array<Omit<ThingsProject, "title" | "notes" | "areaTitle"> & { title: unknown; notes: unknown; areaTitle: unknown }>;
    return rows.map((r) => ({
      ...r,
      title: normalizeThingsText(r.title),
      notes: r.notes == null ? null : normalizeThingsText(r.notes),
      areaTitle: r.areaTitle == null ? null : normalizeThingsText(r.areaTitle),
    }));
  } finally {
    db.close();
  }
}

export function getTags(): string[] {
  const db = openDb();
  try {
    const rows = db.prepare(`SELECT title FROM TMTag ORDER BY title`).all() as { title: unknown }[];
    return rows.map((r) => normalizeThingsText(r.title));
  } finally {
    db.close();
  }
}

export function getAreas(): ThingsArea[] {
  const db = openDb();
  try {
    const rows = db.prepare(`SELECT uuid, title FROM TMArea ORDER BY "index" ASC`).all() as Array<{ uuid: string; title: unknown }>;
    return rows.map((r) => ({ uuid: r.uuid, title: normalizeThingsText(r.title) }));
  } finally {
    db.close();
  }
}

export function getCompletedTasks(limit = 50): CompletedTask[] {
  const db = openDb();
  try {
    return db.prepare(`
      SELECT
        t.uuid, t.title, t.stopDate,
        COALESCE(p.title, hp.title) AS projectTitle,
        COALESCE(a.title, pa.title, hpa.title) AS areaTitle
      FROM TMTask t
      LEFT JOIN TMTask h ON h.uuid = t.heading AND h.type = 2
      LEFT JOIN TMTask p ON p.uuid = t.project AND p.type = 1
      LEFT JOIN TMTask hp ON hp.uuid = h.project AND hp.type = 1
      LEFT JOIN TMArea a ON a.uuid = t.area
      LEFT JOIN TMArea pa ON pa.uuid = p.area
      LEFT JOIN TMArea hpa ON hpa.uuid = hp.area
      WHERE t.type = 0
        AND t.status = 3
        AND t.trashed = 0
      ORDER BY t.stopDate DESC
      LIMIT ?
    `).all(limit).map((r: any) => ({
      uuid: r.uuid,
      title: normalizeThingsText(r.title),
      projectTitle: r.projectTitle == null ? null : normalizeThingsText(r.projectTitle),
      areaTitle: r.areaTitle == null ? null : normalizeThingsText(r.areaTitle),
      completedAt: r.stopDate ? unixSecondsToDate(r.stopDate) : new Date().toISOString(),
    }));
  } finally {
    db.close();
  }
}

export function getCompletedTasksByProject(projectUuid: string, limit = 100): CompletedTask[] {
  const db = openDb();
  try {
    return db.prepare(`
      SELECT
        t.uuid, t.title, t.stopDate,
        COALESCE(p.title, hp.title) AS projectTitle,
        COALESCE(a.title, pa.title, hpa.title) AS areaTitle
      FROM TMTask t
      LEFT JOIN TMTask h ON h.uuid = t.heading AND h.type = 2
      LEFT JOIN TMTask p ON p.uuid = t.project AND p.type = 1
      LEFT JOIN TMTask hp ON hp.uuid = h.project AND hp.type = 1
      LEFT JOIN TMArea a ON a.uuid = t.area
      LEFT JOIN TMArea pa ON pa.uuid = p.area
      LEFT JOIN TMArea hpa ON hpa.uuid = hp.area
      WHERE t.type = 0
        AND t.status = 3
        AND t.trashed = 0
        AND (t.project = ? OR h.project = ?)
      ORDER BY t.stopDate DESC
      LIMIT ?
    `).all(projectUuid, projectUuid, limit).map((r: any) => ({
      uuid: r.uuid,
      title: normalizeThingsText(r.title),
      projectTitle: r.projectTitle == null ? null : normalizeThingsText(r.projectTitle),
      areaTitle: r.areaTitle == null ? null : normalizeThingsText(r.areaTitle),
      completedAt: r.stopDate ? unixSecondsToDate(r.stopDate) : new Date().toISOString(),
    }));
  } finally {
    db.close();
  }
}

function fetchChecklistItems(db: Database.Database, taskUuids: string[]): Map<string, ChecklistItem[]> {
  const map = new Map<string, ChecklistItem[]>();
  if (taskUuids.length === 0) return map;

  const placeholders = taskUuids.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT uuid, title, status, "index", task FROM TMChecklistItem WHERE task IN (${placeholders}) ORDER BY "index" ASC`,
  ).all(...taskUuids) as { uuid: string; title: string; status: number; index: number; task: string }[];

  for (const row of rows) {
    const item: ChecklistItem = {
      uuid: row.uuid,
      title: normalizeThingsText(row.title),
      completed: row.status !== 0,
      index: row.index,
    };
    const arr = map.get(row.task);
    if (arr) arr.push(item);
    else map.set(row.task, [item]);
  }

  return map;
}

export function getChecklistItems(taskUuids: string[]): Map<string, ChecklistItem[]> {
  const db = openDb();
  try {
    return fetchChecklistItems(db, taskUuids);
  } finally {
    db.close();
  }
}

// ─── Write operations via Things3 URL scheme ───

let cachedAuthToken: string | null = null;

function getAuthToken(): string {
  if (cachedAuthToken) return cachedAuthToken;
  const db = openDb();
  try {
    const row = db.prepare("SELECT uriSchemeAuthenticationToken FROM TMSettings LIMIT 1").get() as
      { uriSchemeAuthenticationToken: string | null } | undefined;
    const token = row?.uriSchemeAuthenticationToken;
    if (!token) {
      throw new Error(
        "Things3 URL scheme auth token not configured. Enable it in Things → Settings → General → Enable Things URLs.",
      );
    }
    cachedAuthToken = token;
    return token;
  } finally {
    db.close();
  }
}

function thingsUrl(command: string, params: Record<string, string>): string {
  const allParams = { "auth-token": getAuthToken(), ...params };
  const qs = Object.entries(allParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `things:///` + command + (qs ? `?${qs}` : "");
}

async function openThingsUrl(url: string): Promise<void> {
  // -g = don't bring Things3 to foreground
  await execFileAsync("open", ["-g", url]);
}

export async function createTask(
  title: string,
  opts?: { when?: string; list?: string; tags?: string[]; notes?: string; listId?: string; heading?: string; headingId?: string; checklistItems?: string[] },
): Promise<void> {
  const params: Record<string, string> = { title };
  if (opts?.when) params.when = opts.when;
  else if (opts?.list) {
    const listToWhen: Record<string, string> = {
      inbox: "",
      today: "today",
      upcoming: "tomorrow",
      anytime: "anytime",
      someday: "someday",
    };
    if (listToWhen[opts.list] !== undefined) params.when = listToWhen[opts.list];
  }
  if (opts?.tags?.length) params.tags = opts.tags.join(",");
  if (opts?.notes) params.notes = opts.notes;
  if (opts?.listId) params["list-id"] = opts.listId;
  if (opts?.heading) params.heading = opts.heading;
  if (opts?.headingId) params["heading-id"] = opts.headingId;
  if (opts?.checklistItems?.length) params["checklist-items"] = opts.checklistItems.join("\n");
  await openThingsUrl(thingsUrl("add", params));
}

export async function completeTask(uuid: string): Promise<void> {
  await openThingsUrl(thingsUrl("update", { id: uuid, completed: "true" }));
}

export async function uncompleteTask(uuid: string): Promise<void> {
  await openThingsUrl(thingsUrl("update", { id: uuid, completed: "false" }));
}

export async function updateTask(
  uuid: string,
  opts: { title?: string; notes?: string; appendNotes?: string; deadline?: string; when?: string; tags?: string[]; addTags?: string[]; listId?: string; headingId?: string },
): Promise<void> {
  const params: Record<string, string> = { id: uuid };
  if (opts.title) params.title = opts.title;
  if (opts.notes !== undefined) params.notes = opts.notes;
  if (opts.appendNotes !== undefined) params["prepend-notes"] = opts.appendNotes;
  if (opts.deadline !== undefined) params.deadline = opts.deadline;
  if (opts.when !== undefined) params.when = opts.when;
  if (opts.tags) params.tags = opts.tags.join(",");
  if (opts.addTags?.length) params["add-tags"] = opts.addTags.join(",");
  if (opts.listId) params["list-id"] = opts.listId;
  if (opts.headingId) params["heading-id"] = opts.headingId;
  await openThingsUrl(thingsUrl("update", params));
}

export async function moveTask(uuid: string, list: ThingsList): Promise<void> {
  const listToWhen: Record<ThingsList, string> = {
    inbox: "",
    today: "today",
    upcoming: "tomorrow",
    anytime: "anytime",
    someday: "someday",
  };
  await openThingsUrl(thingsUrl("update", { id: uuid, when: listToWhen[list] }));
}

export async function duplicateTask(uuid: string): Promise<void> {
  await openThingsUrl(thingsUrl("update", { id: uuid, duplicate: "true" }));
}

export function deleteProject(uuid: string): void {
  const db = openDbWritable();
  try {
    db.prepare("UPDATE TMTask SET trashed = 1 WHERE uuid = ?").run(uuid);
  } finally {
    db.close();
  }
}

export async function createArea(title: string): Promise<void> {
  const script = `tell application "Things3" to make new area with properties {name:"${title.replace(/"/g, '\\"')}"}`;
  await execFileAsync("osascript", ["-e", script]);
}

export async function createProject(
  title: string,
  opts?: { notes?: string; areaId?: string; deadline?: string; tags?: string[] },
): Promise<void> {
  const params: Record<string, string> = { title };
  if (opts?.notes) params.notes = opts.notes;
  if (opts?.areaId) params["area-id"] = opts.areaId;
  if (opts?.deadline) params.deadline = opts.deadline;
  if (opts?.tags?.length) params.tags = opts.tags.join(",");
  await openThingsUrl(thingsUrl("add-project", params));
}

export async function appendChecklistItems(uuid: string, items: string[]): Promise<void> {
  if (items.length === 0) return;
  await openThingsUrl(thingsUrl("update", { id: uuid, "append-checklist-items": items.join("\n") }));
}

export interface ProjectHeading {
  uuid: string;
  title: string;
  projectUuid: string;
}

export function getProjectHeadings(projectUuid: string): ProjectHeading[] {
  const db = openDb();
  try {
    const rows = db.prepare(`
      SELECT uuid, title, project AS projectUuid
      FROM TMTask
      WHERE type = 2 AND project = ? AND trashed = 0
      ORDER BY "index" ASC
    `).all(projectUuid) as Array<{ uuid: string; title: unknown; projectUuid: string }>;
    return rows.map((r) => ({
      uuid: r.uuid,
      title: normalizeThingsText(r.title),
      projectUuid: r.projectUuid,
    }));
  } finally {
    db.close();
  }
}

export async function showInThings(uuid: string): Promise<void> {
  await openThingsUrl(thingsUrl("show", { id: uuid }));
}

export function toggleChecklistItem(uuid: string, completed: boolean): void {
  const db = openDbWritable();
  try {
    db.prepare("UPDATE TMChecklistItem SET status = ? WHERE uuid = ?").run(completed ? 3 : 0, uuid);
    // Update parent task's openChecklistItemsCount
    const row = db.prepare("SELECT task FROM TMChecklistItem WHERE uuid = ?").get(uuid) as { task: string } | undefined;
    if (row) {
      const openCount = db.prepare(
        "SELECT count(*) AS c FROM TMChecklistItem WHERE task = ? AND status = 0",
      ).get(row.task) as { c: number };
      db.prepare("UPDATE TMTask SET openChecklistItemsCount = ? WHERE uuid = ?").run(openCount.c, row.task);
    }
  } finally {
    db.close();
  }
}

export function deleteChecklistItem(uuid: string): void {
  const db = openDbWritable();
  try {
    const row = db.prepare("SELECT task, status FROM TMChecklistItem WHERE uuid = ?").get(uuid) as { task: string; status: number } | undefined;
    if (!row) return;
    db.prepare("DELETE FROM TMChecklistItem WHERE uuid = ?").run(uuid);
    // Update parent task counts
    const total = db.prepare("SELECT count(*) AS c FROM TMChecklistItem WHERE task = ?").get(row.task) as { c: number };
    const open = db.prepare("SELECT count(*) AS c FROM TMChecklistItem WHERE task = ? AND status = 0").get(row.task) as { c: number };
    db.prepare("UPDATE TMTask SET checklistItemsCount = ?, openChecklistItemsCount = ? WHERE uuid = ?").run(total.c, open.c, row.task);
  } finally {
    db.close();
  }
}

export function deleteTask(uuid: string): void {
  const db = openDbWritable();
  try {
    db.prepare("UPDATE TMTask SET trashed = 1 WHERE uuid = ?").run(uuid);
  } finally {
    db.close();
  }
}

export function getAllHeadingsForProjects(): Map<string, ProjectHeading[]> {
  const db = openDb();
  try {
    const rows = db.prepare(`
      SELECT uuid, title, project AS projectUuid
      FROM TMTask
      WHERE type = 2 AND trashed = 0 AND status = 0
      ORDER BY "index" ASC
    `).all() as Array<{ uuid: string; title: unknown; projectUuid: string }>;
    const normalizedRows: ProjectHeading[] = rows.map((r) => ({
      uuid: r.uuid,
      title: normalizeThingsText(r.title),
      projectUuid: r.projectUuid,
    }));

    const map = new Map<string, ProjectHeading[]>();
    for (const h of normalizedRows) {
      const arr = map.get(h.projectUuid);
      if (arr) arr.push(h);
      else map.set(h.projectUuid, [h]);
    }
    return map;
  } finally {
    db.close();
  }
}
