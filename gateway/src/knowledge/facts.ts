import { query } from "../db/client.js";

export type FactCategory =
  | "identity"
  | "relationship"
  | "preference"
  | "work"
  | "health"
  | "location"
  | "financial"
  | "other";

export interface FactProposal {
  subject: string;
  predicate: string;
  object: string;
  category: FactCategory;
  confidence: number;
  source: string;
  notes?: string;
  createdBy?: string;
  tags?: string[];
}

const FACTS_COLLECTION = "Facts";

const FACTS_SCHEMA = [
  { name: "subject", type: "text", required: true },
  { name: "predicate", type: "text", required: true },
  { name: "object", type: "text", required: true },
  {
    name: "category",
    type: "select",
    required: true,
    options: ["identity", "relationship", "preference", "work", "health", "location", "financial", "other"],
  },
  {
    name: "status",
    type: "select",
    required: true,
    options: ["unverified", "verified", "disputed", "outdated"],
  },
  { name: "confidence", type: "number" },
  { name: "source", type: "text" },
  { name: "verified_at", type: "date" },
  { name: "verified_by", type: "text" },
  { name: "notes", type: "text" },
];

function clean(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalize(input: string): string {
  return clean(input).toLowerCase();
}

const USER_SUBJECT_ALIASES = new Set(["user", "the user", "me", "myself", "i"]);
const IDENTITY_PREDICATE_ALIASES = new Set(["is", "am", "name_is", "is_called", "named", "called"]);

function normalizeSubjectValue(subject: string): string {
  const value = clean(subject);
  if (!value) return value;
  if (USER_SUBJECT_ALIASES.has(normalize(value))) return "user";
  return value;
}

function normalizePredicateValue(predicate: string, category: FactCategory): string {
  const value = clean(predicate);
  if (!value) return value;
  const normalized = value.toLowerCase().replace(/\s+/g, "_");

  if (category === "preference") return "prefers";
  if (IDENTITY_PREDICATE_ALIASES.has(normalized) || normalized.startsWith("is_")) return "is";

  return value.toLowerCase();
}

function normalizeObjectValue(object: string): string {
  let value = clean(object);
  if (!value) return value;
  value = value.replace(/^(?:the\s+)?user\s+(?:is|prefers)\s+/i, "");
  return clean(value);
}

function isNoisyFact(subject: string, predicate: string, object: string): boolean {
  const objectNorm = normalize(object);
  if (!objectNorm || ["user", "assistant", "unknown", "true", "false", "yes", "no"].includes(objectNorm)) return true;
  if (object.includes("?")) return true;
  if (subject === "user" && object.length > 260) return true;
  if (
    subject === "user"
    && predicate === "is"
    && /^(check|send|create|reply|review|update|fix|tasks?\b|task\s+to\s+do\b)/i.test(object)
  ) {
    return true;
  }
  return false;
}

function buildTitle(subject: string, predicate: string, object: string): string {
  return `${subject} ${predicate} ${object}`.slice(0, 200);
}

interface FactData {
  subject: string;
  predicate: string;
  object: string;
  category: FactCategory;
  status: "unverified" | "verified" | "disputed" | "outdated";
  confidence: number;
  source: string;
  notes: string;
}

interface VerifyFactAction {
  kind: "verify_fact";
  fact_id: string;
  fact: {
    subject: string;
    predicate: string;
    object: string;
    category: FactCategory;
    status: "unverified" | "verified" | "disputed" | "outdated";
    confidence: number;
    source: string;
    notes?: string;
  };
}

function buildVerifyFactAction(factId: string, data: FactData): VerifyFactAction {
  return {
    kind: "verify_fact",
    fact_id: factId,
    fact: {
      subject: data.subject,
      predicate: data.predicate,
      object: data.object,
      category: data.category,
      status: data.status,
      confidence: data.confidence,
      source: data.source,
      notes: data.notes || undefined,
    },
  };
}

async function queueFactVerificationReview(
  factId: string,
  data: FactData,
  extraTags: string[] = [],
): Promise<void> {
  if (data.status !== "unverified") return;

  const proposedAction = buildVerifyFactAction(factId, data);
  const title = `Verify fact: ${buildTitle(data.subject, data.predicate, data.object)}`;
  const description = "Confirm this learned fact before it influences future decisions.";
  const content = JSON.stringify([
    { type: "text", content: `Fact learned from ${data.source || "unknown source"}.` },
    {
      type: "json",
      label: "Candidate Fact",
      content: JSON.stringify({ id: factId, ...proposedAction.fact }, null, 2),
    },
  ]);
  const tags = Array.from(new Set(["facts", "verification", data.category, ...extraTags]));
  const priority = data.confidence >= 0.85 ? 2 : 1;

  const existing = await query<{ id: string }>(
    `SELECT id
     FROM review_queue
     WHERE type = 'verify'
       AND status = 'pending'
       AND COALESCE(proposed_action->>'kind', '') = 'verify_fact'
       AND COALESCE(proposed_action->>'fact_id', '') = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [factId],
  );

  if (existing.rows[0]?.id) {
    await query(
      `UPDATE review_queue
       SET title = $2,
           description = $3,
           content = $4::jsonb,
           proposed_action = $5::jsonb,
           tags = $6,
           priority = $7
       WHERE id = $1`,
      [
        existing.rows[0].id,
        title,
        description,
        content,
        JSON.stringify(proposedAction),
        tags,
        priority,
      ],
    );
    return;
  }

  await query(
    `INSERT INTO review_queue
      (agent_id, conversation_id, type, title, description, content, proposed_action, tags, priority)
     VALUES ($1, NULL, 'verify', $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
    [
      "knowledge-system",
      title,
      description,
      content,
      JSON.stringify(proposedAction),
      tags,
      priority,
    ],
  );
}

export async function ensureFactsCollection(): Promise<string> {
  const existing = await query<{ id: string }>(
    "SELECT id FROM store_collections WHERE name = $1 LIMIT 1",
    [FACTS_COLLECTION],
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;

  const inserted = await query<{ id: string }>(
    `INSERT INTO store_collections (name, description, icon, schema, config)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     RETURNING id`,
    [
      FACTS_COLLECTION,
      "Verified and unverified facts about people, relationships, and the world.",
      "📌",
      JSON.stringify(FACTS_SCHEMA),
      JSON.stringify({ view_mode: "table", default_sort: "updated_at" }),
    ],
  );
  return inserted.rows[0].id;
}

async function findExactFact(
  collectionId: string,
  subject: string,
  predicate: string,
  object: string,
): Promise<{ id: string; data: Record<string, unknown>; tags: string[]; status: string } | null> {
  const result = await query<{ id: string; data: Record<string, unknown>; tags: string[]; status: string }>(
    `SELECT id, data, tags, status
     FROM store_objects
     WHERE collection_id = $1
       AND status IN ('active', 'archived')
       AND LOWER(BTRIM(data->>'subject')) = LOWER(BTRIM($2))
       AND LOWER(BTRIM(data->>'predicate')) = LOWER(BTRIM($3))
       AND LOWER(BTRIM(data->>'object')) = LOWER(BTRIM($4))
     ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, updated_at DESC
     LIMIT 1`,
    [collectionId, subject, predicate, object],
  );
  return result.rows[0] ?? null;
}

export async function markConflictingFactsOutdated(
  subject: string,
  predicate: string,
  object: string,
): Promise<number> {
  const collectionId = await ensureFactsCollection();
  const result = await query(
    `UPDATE store_objects
     SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{status}', '"outdated"'::jsonb, true),
         status = 'archived',
         updated_at = NOW()
     WHERE collection_id = $1
       AND status = 'active'
       AND LOWER(BTRIM(data->>'subject')) = LOWER(BTRIM($2))
       AND LOWER(BTRIM(data->>'predicate')) = LOWER(BTRIM($3))
       AND LOWER(BTRIM(data->>'object')) <> LOWER(BTRIM($4))
       AND COALESCE(data->>'status', 'unverified') IN ('unverified', 'verified')`,
    [collectionId, subject, predicate, object],
  );
  return result.rowCount ?? 0;
}

export async function proposeFact(input: FactProposal): Promise<{ id: string; created: boolean }> {
  const collectionId = await ensureFactsCollection();
  const subject = normalizeSubjectValue(input.subject);
  const predicate = normalizePredicateValue(input.predicate, input.category);
  const object = normalizeObjectValue(input.object);
  if (!subject || !predicate || !object) {
    throw new Error("subject, predicate, and object are required");
  }
  if (isNoisyFact(subject, predicate, object)) {
    throw new Error("fact proposal is low-signal");
  }

  const confidence = Math.max(0.1, Math.min(0.95, input.confidence));
  const existing = await findExactFact(collectionId, subject, predicate, object);
  if (existing) {
    const currentStatus = typeof existing.data.status === "string" ? existing.data.status : "unverified";
    const nextData: FactData = {
      ...existing.data,
      subject,
      predicate,
      object,
      category: input.category,
      status: currentStatus === "verified" ? "verified" : "unverified",
      confidence: Math.max(Number(existing.data.confidence || 0), confidence),
      source: input.source,
      notes: input.notes || (typeof existing.data.notes === "string" ? existing.data.notes : ""),
    };
    const mergedTags = Array.from(new Set([...(existing.tags || []), ...(input.tags || [])]));
    await query(
      `UPDATE store_objects
       SET title = $2, data = $3::jsonb, tags = $4, status = 'active', updated_at = NOW()
       WHERE id = $1`,
      [existing.id, buildTitle(subject, predicate, object), JSON.stringify(nextData), mergedTags],
    );

    await queueFactVerificationReview(existing.id, nextData, mergedTags);
    return { id: existing.id, created: false };
  }

  const data: FactData = {
    subject,
    predicate,
    object,
    category: input.category,
    status: "unverified",
    confidence,
    source: input.source,
    notes: input.notes || "",
  };
  const created = await query<{ id: string }>(
    `INSERT INTO store_objects (collection_id, title, data, tags, created_by)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     RETURNING id`,
    [
      collectionId,
      buildTitle(subject, predicate, object),
      JSON.stringify(data),
      input.tags || [],
      input.createdBy || "system:fact-learner",
    ],
  );
  await queueFactVerificationReview(created.rows[0].id, data, input.tags || []);
  return { id: created.rows[0].id, created: true };
}

function parseFactCategory(value: unknown): FactCategory {
  const text = typeof value === "string" ? value.toLowerCase().trim() : "";
  const allowed: FactCategory[] = [
    "identity",
    "relationship",
    "preference",
    "work",
    "health",
    "location",
    "financial",
    "other",
  ];
  return (allowed as string[]).includes(text) ? (text as FactCategory) : "other";
}

export async function enqueueMissingFactVerificationReviews(limit = 50): Promise<number> {
  const collectionId = await ensureFactsCollection();
  const max = Math.max(1, Math.min(500, Math.floor(limit)));
  const candidates = await query<{
    id: string;
    data: Record<string, unknown>;
    tags: string[];
  }>(
    `SELECT o.id, o.data, o.tags
     FROM store_objects o
     WHERE o.collection_id = $1
       AND o.status = 'active'
       AND COALESCE(o.data->>'status', 'unverified') = 'unverified'
       AND NOT EXISTS (
         SELECT 1
         FROM review_queue r
         WHERE r.type = 'verify'
           AND r.status = 'pending'
           AND COALESCE(r.proposed_action->>'kind', '') = 'verify_fact'
           AND COALESCE(r.proposed_action->>'fact_id', '') = o.id::text
       )
     ORDER BY o.updated_at DESC
     LIMIT $2`,
    [collectionId, max],
  );

  let queued = 0;
  for (const row of candidates.rows) {
    const subject = normalizeSubjectValue(typeof row.data.subject === "string" ? row.data.subject : "");
    const category = parseFactCategory(row.data.category);
    const predicate = normalizePredicateValue(typeof row.data.predicate === "string" ? row.data.predicate : "", category);
    const object = normalizeObjectValue(typeof row.data.object === "string" ? row.data.object : "");
    const source = typeof row.data.source === "string" ? row.data.source : "backfill";
    const confidenceRaw = Number(row.data.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? Math.max(0.1, Math.min(0.95, confidenceRaw)) : 0.7;
    const notes = typeof row.data.notes === "string" ? row.data.notes : "";
    if (!subject || !predicate || !object) continue;
    if (isNoisyFact(subject, predicate, object)) continue;

    await queueFactVerificationReview(
      row.id,
      {
        subject,
        predicate,
        object,
        category,
        status: "unverified",
        confidence,
        source,
        notes,
      },
      row.tags || [],
    );
    queued++;
  }

  return queued;
}

export async function loadVerifiedFactsContext(): Promise<{
  identity: string[];
  preferences: string[];
}> {
  const collectionId = await ensureFactsCollection();
  const result = await query<{
    subject: string | null;
    predicate: string | null;
    object: string | null;
    category: string | null;
  }>(
    `SELECT
       data->>'subject' AS subject,
       data->>'predicate' AS predicate,
       data->>'object' AS object,
       data->>'category' AS category
     FROM store_objects
     WHERE collection_id = $1
       AND status = 'active'
       AND COALESCE(data->>'status', 'unverified') = 'verified'
     ORDER BY updated_at DESC
     LIMIT 200`,
    [collectionId],
  );

  const identity: string[] = [];
  const preferences: string[] = [];
  const seenIdentity = new Set<string>();
  const seenPrefs = new Set<string>();

  for (const row of result.rows) {
    const subject = clean(row.subject || "");
    const predicate = clean(row.predicate || "");
    const object = clean(row.object || "");
    if (!subject || !predicate || !object) continue;
    const line = `${subject} ${predicate} ${object}`;
    const cat = normalize(row.category || "other");
    if (cat === "preference") {
      const key = normalize(line);
      if (!seenPrefs.has(key)) {
        seenPrefs.add(key);
        preferences.push(line);
      }
    } else {
      const key = normalize(line);
      if (!seenIdentity.has(key)) {
        seenIdentity.add(key);
        identity.push(line);
      }
    }
  }

  return {
    identity: identity.slice(0, 25),
    preferences: preferences.slice(0, 25),
  };
}
