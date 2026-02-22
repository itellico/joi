import { query } from "../db/client.js";
import { markConflictingFactsOutdated, type FactCategory } from "./facts.js";

type ReviewDecision = "approved" | "rejected" | "modified";

interface FactReviewInput {
  status: ReviewDecision;
  resolution: unknown;
  proposedAction: unknown;
  resolvedBy: string;
}

interface ParsedFactPatch {
  factId: string;
  subject?: string;
  predicate?: string;
  object?: string;
  category?: FactCategory;
  notes?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function clean(input: string | null | undefined): string {
  return (input || "").replace(/\s+/g, " ").trim();
}

function normalizeSubject(subject: string): string {
  const normalized = subject.toLowerCase();
  if (["user", "the user", "me", "myself", "i"].includes(normalized)) return "user";
  return subject;
}

function normalizePredicate(predicate: string, category: FactCategory): string {
  const normalized = predicate.toLowerCase().replace(/\s+/g, "_");
  if (category === "preference") return "prefers";
  if (["is", "am", "name_is", "is_called", "named", "called"].includes(normalized) || normalized.startsWith("is_")) {
    return "is";
  }
  return predicate.toLowerCase();
}

function normalizeObject(object: string): string {
  return clean(object).replace(/^(?:the\s+)?user\s+(?:is|prefers)\s+/i, "").trim();
}

function parseCategory(value: unknown): FactCategory | null {
  const text = readString(value);
  if (!text) return null;
  const lower = text.toLowerCase();
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
  return (allowed as string[]).includes(lower) ? (lower as FactCategory) : null;
}

function parseFactPatch(resolution: unknown, proposedAction: unknown): ParsedFactPatch | null {
  const resolved = asRecord(resolution);
  const resolvedFact = asRecord(resolved?.fact);
  const proposed = asRecord(proposedAction);
  const proposedFact = asRecord(proposed?.fact);

  const factId = clean(
    readString(resolved?.fact_id)
      || readString(resolved?.factId)
      || readString(resolvedFact?.id)
      || readString(proposed?.fact_id)
      || readString(proposed?.factId)
      || readString(proposedFact?.id),
  );
  if (!factId) return null;

  const subject = clean(
    readString(resolved?.subject)
      || readString(resolvedFact?.subject)
      || readString(proposedFact?.subject),
  );
  const predicate = clean(
    readString(resolved?.predicate)
      || readString(resolvedFact?.predicate)
      || readString(proposedFact?.predicate),
  );
  const object = clean(
    readString(resolved?.object)
      || readString(resolvedFact?.object)
      || readString(proposedFact?.object),
  );
  const category = parseCategory(
    resolved?.category
      ?? resolvedFact?.category
      ?? proposedFact?.category,
  );
  const notes = clean(
    readString(resolved?.notes)
      || readString(resolvedFact?.notes)
      || readString(proposedFact?.notes),
  );

  return {
    factId,
    subject: subject || undefined,
    predicate: predicate || undefined,
    object: object || undefined,
    category: category || undefined,
    notes: notes || undefined,
  };
}

function buildTitle(subject: string, predicate: string, object: string): string {
  return `${subject} ${predicate} ${object}`.slice(0, 200);
}

function toFactData(value: unknown): Record<string, unknown> {
  return asRecord(value) || {};
}

function shouldArchiveConflicts(subject: string, predicate: string, category: FactCategory): boolean {
  return normalizeSubject(subject) === "user" && category === "identity" && predicate === "is";
}

export async function applyFactReviewResolution(input: FactReviewInput): Promise<{ applied: boolean; factId?: string }> {
  const patch = parseFactPatch(input.resolution, input.proposedAction);
  if (!patch?.factId) return { applied: false };

  const row = await query<{ id: string; data: unknown }>(
    `SELECT id, data
     FROM store_objects
     WHERE id = $1
       AND collection_id = (SELECT id FROM store_collections WHERE name = 'Facts' LIMIT 1)
     LIMIT 1`,
    [patch.factId],
  );
  const fact = row.rows[0];
  if (!fact) return { applied: false, factId: patch.factId };

  const current = toFactData(fact.data);
  const nowIso = new Date().toISOString();

  if (input.status === "rejected") {
    const subject = clean(readString(current.subject));
    const predicate = clean(readString(current.predicate));
    const object = clean(readString(current.object));
    const nextData = {
      ...current,
      status: "outdated",
      verified_at: nowIso,
      verified_by: input.resolvedBy,
    };

    await query(
      `UPDATE store_objects
       SET title = $2,
           data = $3::jsonb,
           status = 'archived',
           updated_at = NOW()
       WHERE id = $1`,
      [
        patch.factId,
        buildTitle(subject || "fact", predicate || "is", object || "outdated"),
        JSON.stringify(nextData),
      ],
    );
    return { applied: true, factId: patch.factId };
  }

  const currentSubject = clean(readString(current.subject));
  const currentPredicate = clean(readString(current.predicate));
  const currentObject = clean(readString(current.object));
  const currentCategory = parseCategory(current.category) || "other";
  const subject = normalizeSubject(clean(patch.subject || currentSubject));
  const category = patch.category || currentCategory;
  const predicate = normalizePredicate(clean(patch.predicate || currentPredicate), category);
  const object = normalizeObject(clean(patch.object || currentObject));
  if (!subject || !predicate || !object) return { applied: false, factId: patch.factId };

  const source = clean(readString(current.source)) || "feedback";
  const confidenceRaw = Number(current.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0.1, Math.min(0.95, confidenceRaw)) : 0.8;
  const notes = clean(patch.notes || readString(current.notes) || "");

  const nextData = {
    ...current,
    subject,
    predicate,
    object,
    category,
    status: "verified",
    confidence,
    source,
    notes,
    verified_at: nowIso,
    verified_by: input.resolvedBy,
  };

  await query(
    `UPDATE store_objects
     SET title = $2,
         data = $3::jsonb,
         status = 'active',
         updated_at = NOW()
     WHERE id = $1`,
    [patch.factId, buildTitle(subject, predicate, object), JSON.stringify(nextData)],
  );

  if (shouldArchiveConflicts(subject, predicate, category)) {
    await markConflictingFactsOutdated(subject, predicate, object);
  }

  return { applied: true, factId: patch.factId };
}
