/**
 * OKR → Things3 sync
 *
 * Maps OKR structure to Things3:
 *   Objective  →  Project (in "OKRs" area)
 *   Key Result →  Heading within the project
 *
 * Uses the things:///json URL scheme for batch creation
 * and reads progress back from the Things3 SQLite DB.
 */

import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { query } from "../db/client.js";

const execFileAsync = promisify(execFile);

const DB_PATH =
  "/Users/mm2/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-6J5JX/Things Database.thingsdatabase/main.sqlite";

function openDb(): Database.Database {
  return new Database(DB_PATH, { readonly: true, fileMustExist: true });
}

let cachedAuthToken: string | null = null;

function getAuthToken(): string {
  if (cachedAuthToken) return cachedAuthToken;
  const db = openDb();
  try {
    const row = db.prepare("SELECT uriSchemeAuthenticationToken FROM TMSettings LIMIT 1").get() as
      { uriSchemeAuthenticationToken: string | null } | undefined;
    const token = row?.uriSchemeAuthenticationToken;
    if (!token) throw new Error("Things3 URL scheme auth token not found");
    cachedAuthToken = token;
    return token;
  } finally {
    db.close();
  }
}

async function openThingsUrl(url: string): Promise<void> {
  await execFileAsync("open", ["-g", url]);
}

// ─── Interfaces ───

interface OKRObjective {
  id: string;
  title: string;
  data: Record<string, unknown>;
  keyResults: {
    id: string;
    title: string;
    data: Record<string, unknown>;
  }[];
}

interface Things3ProjectInfo {
  uuid: string;
  title: string;
  headings: { uuid: string; title: string }[];
  taskCount: number;
  completedTaskCount: number;
}

// ─── Sync TO Things3 ───

/**
 * Find or identify the "OKRs" area in Things3.
 * Returns the area UUID, or null if not found.
 */
function findOKRsArea(): string | null {
  const db = openDb();
  try {
    const row = db.prepare("SELECT uuid FROM TMArea WHERE title = 'OKRs' LIMIT 1").get() as { uuid: string } | undefined;
    return row?.uuid || null;
  } finally {
    db.close();
  }
}

/**
 * Find existing Things3 projects that match OKR objectives.
 * Matches by title prefix (e.g., "O1: Ship JOI v1.0").
 */
function findExistingOKRProjects(): Map<string, Things3ProjectInfo> {
  const db = openDb();
  try {
    const areaUuid = findOKRsArea();
    if (!areaUuid) return new Map();

    const projects = db.prepare(`
      SELECT p.uuid, p.title, p.notes
      FROM TMTask p
      WHERE p.type = 1 AND p.status = 0 AND p.trashed = 0 AND p.area = ?
      ORDER BY p."index" ASC
    `).all(areaUuid) as { uuid: string; title: string; notes: string | null }[];

    const result = new Map<string, Things3ProjectInfo>();

    for (const proj of projects) {
      // Extract store object ID from notes if present (stored as "store:UUID")
      const storeIdMatch = proj.notes?.match(/store:([0-9a-f-]+)/);
      const storeId = storeIdMatch?.[1];

      const headings = db.prepare(`
        SELECT uuid, title FROM TMTask
        WHERE type = 2 AND project = ? AND trashed = 0
        ORDER BY "index" ASC
      `).all(proj.uuid) as { uuid: string; title: string }[];

      const taskCount = db.prepare(`
        SELECT count(*) AS c FROM TMTask
        WHERE type = 0 AND status = 0 AND trashed = 0
          AND (project = ? OR heading IN (SELECT uuid FROM TMTask WHERE project = ? AND type = 2))
      `).get(proj.uuid, proj.uuid) as { c: number };

      const completedCount = db.prepare(`
        SELECT count(*) AS c FROM TMTask
        WHERE type = 0 AND status = 3 AND trashed = 0
          AND (project = ? OR heading IN (SELECT uuid FROM TMTask WHERE project = ? AND type = 2))
      `).get(proj.uuid, proj.uuid) as { c: number };

      const key = storeId || proj.title;
      result.set(key, {
        uuid: proj.uuid,
        title: proj.title,
        headings,
        taskCount: taskCount.c,
        completedTaskCount: completedCount.c,
      });
    }

    return result;
  } finally {
    db.close();
  }
}

/**
 * Push OKR objectives & key results to Things3.
 * Creates projects for new objectives, updates headings for KRs.
 */
export async function syncToThings3(): Promise<{
  created: string[];
  updated: string[];
  errors: string[];
}> {
  const result = { created: [] as string[], updated: [] as string[], errors: [] as string[] };

  try {
    // 1. Get all active OKR objectives from store
    const collectionsRes = await query(
      "SELECT id, name FROM store_collections WHERE name IN ('OKR Objectives', 'OKR Key Results')"
    );
    const objCollId = collectionsRes.rows.find((r: any) => r.name === "OKR Objectives")?.id;
    const krCollId = collectionsRes.rows.find((r: any) => r.name === "OKR Key Results")?.id;

    if (!objCollId || !krCollId) {
      result.errors.push("OKR collections not found in store");
      return result;
    }

    // Fetch active objectives
    const objRes = await query(
      "SELECT * FROM store_objects WHERE collection_id = $1 AND status = 'active' ORDER BY created_at ASC",
      [objCollId]
    );
    const objectives: OKRObjective[] = [];

    for (const obj of objRes.rows) {
      // Fetch linked KRs via relations
      const relRes = await query(
        `SELECT t.* FROM store_objects t
         JOIN store_relations r ON r.target_id = t.id
         WHERE r.source_id = $1 AND r.relation = 'has_key_result' AND t.status = 'active'
         ORDER BY t.created_at ASC`,
        [obj.id]
      );

      objectives.push({
        id: obj.id,
        title: obj.title,
        data: typeof obj.data === "string" ? JSON.parse(obj.data) : obj.data,
        keyResults: relRes.rows.map((kr: any) => ({
          id: kr.id,
          title: kr.title,
          data: typeof kr.data === "string" ? JSON.parse(kr.data) : kr.data,
        })),
      });
    }

    if (objectives.length === 0) {
      result.errors.push("No active objectives to sync");
      return result;
    }

    // 2. Find existing Things3 projects
    const existingProjects = findExistingOKRProjects();
    const areaUuid = findOKRsArea();

    // 3. For each objective, create or update
    for (let i = 0; i < objectives.length; i++) {
      const obj = objectives[i];
      const existing = existingProjects.get(obj.id);
      const projectTitle = `O${i + 1}: ${obj.title}`;
      const quarter = (obj.data.quarter as string) || "";
      const type = (obj.data.type as string) || "";
      const score = Number(obj.data.score) || 0;

      // Build heading titles with progress
      const headingTitles = obj.keyResults.map((kr, j) => {
        const current = Number(kr.data.current) || 0;
        const target = Number(kr.data.target) || 0;
        const unit = (kr.data.unit as string) || "";
        const metricType = (kr.data.metric_type as string) || "number";
        const progressStr = metricType === "binary"
          ? ((kr.data.status as string) === "achieved" ? "Done" : "Not done")
          : `${current}/${target}${unit ? " " + unit : ""}`;
        return `KR${j + 1}: ${kr.title} (${progressStr})`;
      });

      if (existing) {
        // Update existing project headings with progress
        try {
          // Update project title and notes
          const notes = `${quarter} | ${type} | Score: ${score.toFixed(1)}\nstore:${obj.id}`;
          const updateUrl = `things:///update?auth-token=${encodeURIComponent(getAuthToken())}&id=${encodeURIComponent(existing.uuid)}&title=${encodeURIComponent(projectTitle)}&notes=${encodeURIComponent(notes)}`;
          await openThingsUrl(updateUrl);

          // Update heading titles with current progress
          for (let h = 0; h < existing.headings.length && h < headingTitles.length; h++) {
            if (existing.headings[h].title !== headingTitles[h]) {
              const headingUrl = `things:///update?auth-token=${encodeURIComponent(getAuthToken())}&id=${encodeURIComponent(existing.headings[h].uuid)}&title=${encodeURIComponent(headingTitles[h])}`;
              await openThingsUrl(headingUrl);
            }
          }

          // Add new headings if there are more KRs than existing headings
          for (let h = existing.headings.length; h < headingTitles.length; h++) {
            const addHeadingUrl = `things:///update?auth-token=${encodeURIComponent(getAuthToken())}&id=${encodeURIComponent(existing.uuid)}&add-heading=${encodeURIComponent(headingTitles[h])}`;
            await openThingsUrl(addHeadingUrl);
          }

          result.updated.push(projectTitle);
        } catch (err) {
          result.errors.push(`Failed to update ${projectTitle}: ${err}`);
        }
      } else {
        // Create new project via JSON URL scheme
        try {
          const notes = `${quarter} | ${type} | Score: ${score.toFixed(1)}\nstore:${obj.id}`;

          const jsonPayload = [{
            type: "project" as const,
            attributes: {
              title: projectTitle,
              notes,
              ...(areaUuid ? { "area-id": areaUuid } : {}),
              items: headingTitles.map((ht) => ({
                type: "heading" as const,
                attributes: { title: ht },
              })),
            },
          }];

          const jsonUrl = `things:///json?auth-token=${encodeURIComponent(getAuthToken())}&data=${encodeURIComponent(JSON.stringify(jsonPayload))}`;
          await openThingsUrl(jsonUrl);

          result.created.push(projectTitle);
        } catch (err) {
          result.errors.push(`Failed to create ${projectTitle}: ${err}`);
        }

        // Small delay between URL scheme calls to let Things3 process
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    return result;
  } catch (err) {
    result.errors.push(`Sync failed: ${err}`);
    return result;
  }
}

// ─── Read Progress FROM Things3 ───

/**
 * Read OKR project progress from Things3 SQLite DB.
 * Returns task completion stats per project/heading.
 */
export function readThings3Progress(): {
  projects: {
    title: string;
    storeId: string | null;
    totalTasks: number;
    completedTasks: number;
    headings: {
      title: string;
      totalTasks: number;
      completedTasks: number;
    }[];
  }[];
} {
  const db = openDb();
  try {
    const areaRow = db.prepare("SELECT uuid FROM TMArea WHERE title = 'OKRs' LIMIT 1").get() as { uuid: string } | undefined;
    if (!areaRow) return { projects: [] };

    const projects = db.prepare(`
      SELECT uuid, title, notes FROM TMTask
      WHERE type = 1 AND trashed = 0 AND area = ?
      ORDER BY "index" ASC
    `).all(areaRow.uuid) as { uuid: string; title: string; notes: string | null }[];

    return {
      projects: projects.map((proj) => {
        const storeIdMatch = proj.notes?.match(/store:([0-9a-f-]+)/);

        const headings = db.prepare(`
          SELECT uuid, title FROM TMTask
          WHERE type = 2 AND project = ? AND trashed = 0
          ORDER BY "index" ASC
        `).all(proj.uuid) as { uuid: string; title: string }[];

        // Count tasks per heading
        const headingData = headings.map((h) => {
          const total = db.prepare(
            "SELECT count(*) AS c FROM TMTask WHERE type = 0 AND trashed = 0 AND heading = ?"
          ).get(h.uuid) as { c: number };
          const completed = db.prepare(
            "SELECT count(*) AS c FROM TMTask WHERE type = 0 AND status = 3 AND trashed = 0 AND heading = ?"
          ).get(h.uuid) as { c: number };
          return {
            title: h.title,
            totalTasks: total.c,
            completedTasks: completed.c,
          };
        });

        // Count tasks directly in project (no heading)
        const directTotal = db.prepare(
          "SELECT count(*) AS c FROM TMTask WHERE type = 0 AND trashed = 0 AND project = ? AND heading IS NULL"
        ).get(proj.uuid) as { c: number };
        const directCompleted = db.prepare(
          "SELECT count(*) AS c FROM TMTask WHERE type = 0 AND status = 3 AND trashed = 0 AND project = ? AND heading IS NULL"
        ).get(proj.uuid) as { c: number };

        const totalTasks = headingData.reduce((s, h) => s + h.totalTasks, 0) + directTotal.c;
        const completedTasks = headingData.reduce((s, h) => s + h.completedTasks, 0) + directCompleted.c;

        return {
          title: proj.title,
          storeId: storeIdMatch?.[1] || null,
          totalTasks,
          completedTasks,
          headings: headingData,
        };
      }),
    };
  } finally {
    db.close();
  }
}
