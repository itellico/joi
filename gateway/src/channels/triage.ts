// Inbox triage: classifies inbound channel messages using a cheap LLM,
// creates review items for human approval, and syncs to Things3.

import { query } from "../db/client.js";
import { utilityCall } from "../agent/model-router.js";
import { matchContact } from "../contacts/match.js";
import {
  createTask,
  getProjects,
  getProjectHeadings,
  type ProjectHeading,
} from "../things/client.js";
import type { ChannelMessage } from "./types.js";
import type { JoiConfig } from "../config/schema.js";
import {
  loadMatchingRules,
  formatRulesForPrompt,
  recordRuleHit,
  shouldAutoApprove,
  type InboxRule,
} from "./rules-engine.js";
import { executeTriageActions } from "./triage-actions.js";
import { evaluateTriage, type JudgeVerdict } from "../knowledge/judge.js";

// ─── Types ───

export interface RelationshipInsights {
  nicknames?: string[];
  communication_style?: string;
  relationship_tone?: string;
  personal_facts?: string[];
  topics_mentioned?: string[];
  inside_jokes?: string[];
}

export interface TriageResult {
  intent: "question" | "request" | "fyi" | "urgent" | "social" | "spam";
  urgency: "low" | "medium" | "high";
  summary: string;
  actions: TriageAction[];
  relationship_insights?: RelationshipInsights;
  matched_rules?: string[];
  auto_approve?: boolean;
}

export interface TriageAction {
  type: "reply" | "create_task" | "no_action" | "extract" | "label" | "archive";
  draft?: string;
  title?: string;
  notes?: string;
  when?: string;
  reason?: string;
  extract_fields?: string[];
  extract_collection?: string;
  labels?: string[];
}

type BroadcastFn = (type: string, data: unknown) => void;

function isNoActionPlan(actions: TriageAction[]): boolean {
  return actions.length === 0 || actions.every((a) =>
    a.type === "no_action" || a.type === "label" || a.type === "archive",
  );
}

function looksBulkPromotionalEmail(msg: ChannelMessage): boolean {
  if (msg.channelType !== "email") return false;
  const meta = msg.metadata as Record<string, unknown> | undefined;
  const subject = typeof meta?.subject === "string" ? meta.subject : "";
  const text = `${subject}\n${msg.content}`.toLowerCase();
  const markers = [
    "unsubscribe",
    "manage preferences",
    "view in browser",
    "newsletter",
    "promotional",
    "special offer",
    "limited time",
    "new candidate notification",
  ];
  return markers.some((m) => text.includes(m));
}

// ─── Things3 Reviews project heading cache ───

interface ReviewsHeadings {
  projectId: string;
  inbox: string;
  approved: string;
  rejected: string;
  processed: string;
}

let cachedHeadings: ReviewsHeadings | null = null;

export function getReviewsProjectHeadings(): ReviewsHeadings | null {
  if (cachedHeadings) return cachedHeadings;

  const projects = getProjects();
  const reviewsProject = projects.find(
    (p) => p.title === "Reviews" && p.areaTitle === "JOI",
  );
  if (!reviewsProject) {
    console.warn("[Triage] Things3 project 'Reviews' not found in JOI area");
    return null;
  }

  const headings = getProjectHeadings(reviewsProject.uuid);
  const find = (name: string): string => {
    const h = headings.find((h) => h.title.toLowerCase() === name.toLowerCase());
    if (!h) console.warn(`[Triage] Things3 heading '${name}' not found in Reviews project`);
    return h?.uuid ?? "";
  };

  cachedHeadings = {
    projectId: reviewsProject.uuid,
    inbox: find("Inbox"),
    approved: find("Approved"),
    rejected: find("Rejected"),
    processed: find("Processed"),
  };
  return cachedHeadings;
}

/** Clear cached headings (call if Things3 project structure changes). */
export function resetHeadingsCache(): void {
  cachedHeadings = null;
}

// ─── Classification prompt ───

const TRIAGE_SYSTEM_PROMPT = `You are a message triage assistant. Classify the incoming message and suggest actions.

Respond with ONLY valid JSON matching this schema:
{
  "intent": "question" | "request" | "fyi" | "urgent" | "social" | "spam",
  "urgency": "low" | "medium" | "high",
  "summary": "one-line summary of the message",
  "actions": [
    {
      "type": "reply" | "create_task" | "no_action",
      "draft": "reply text if type=reply",
      "title": "task title if type=create_task",
      "notes": "task notes if type=create_task",
      "when": "today | tomorrow | anytime",
      "reason": "reason if type=no_action"
    }
  ],
  "relationship_insights": {
    "nicknames": ["any nicknames used in the message"],
    "communication_style": "brief description of how they communicate",
    "relationship_tone": "nature of the relationship",
    "personal_facts": ["facts revealed about the sender or shared activities"],
    "topics_mentioned": ["specific topics discussed"],
    "inside_jokes": ["any references to shared humor or history"]
  }
}

Classification guidelines:
- "question": sender is asking something that needs an answer
- "request": sender wants something done (meeting, favor, action item)
- "fyi": informational, no response needed
- "urgent": time-sensitive, needs immediate attention
- "social": casual greeting, small talk
- "spam": unsolicited, promotional, irrelevant

Urgency guidelines:
- "high": needs response within hours (urgent requests, time-sensitive)
- "medium": needs response within a day (questions, normal requests)
- "low": no rush (FYI, social, can wait)

Action guidelines:
- For questions/requests: suggest a reply draft AND/OR a task
- For urgent: always suggest a reply draft with high urgency
- For FYI/social: usually "no_action" or a brief acknowledgment reply
- For spam: always "no_action"
- Keep reply drafts concise and natural
- Task titles should be actionable (start with a verb)

Relationship insight guidelines:
- Extract ONLY insights clearly present in the message — do not infer or hallucinate
- Nicknames: any non-standard names used for sender or recipient
- Communication style: language mix, formality level, emoji usage
- Personal facts: activities, preferences, life events mentioned
- Omit the field entirely if no insights are present (e.g., spam, generic messages)

If ACTIVE RULES are provided below, check each against the message:
- If a rule's conditions match, apply its overrides (intent/urgency) and include its actions
- Report which rules matched in the "matched_rules" array (by exact title)
- Rule actions supplement your own suggestions (don't remove your own)
- If a rule says auto_approve, include "auto_approve": true in your response
- Additional action types from rules: "extract", "label", "archive"`;

// ─── Relationship insights persistence ───

async function applyRelationshipInsights(
  contactId: string,
  insights: RelationshipInsights,
): Promise<void> {
  const result = await query<{ extra: Record<string, unknown> | null }>(
    "SELECT extra FROM contacts WHERE id = $1",
    [contactId],
  );
  const extra = result.rows[0]?.extra ?? {};
  const existing: RelationshipInsights =
    (extra.insights as RelationshipInsights) ?? {};

  // Smart merge: union arrays (deduplicate, cap at 20), overwrite scalars
  const merged: RelationshipInsights = { ...existing };
  for (const key of [
    "nicknames",
    "personal_facts",
    "topics_mentioned",
    "inside_jokes",
  ] as const) {
    if (insights[key]?.length) {
      const union = [
        ...new Set([...(existing[key] ?? []), ...insights[key]!]),
      ];
      merged[key] = union.slice(0, 20);
    }
  }
  if (insights.communication_style)
    merged.communication_style = insights.communication_style;
  if (insights.relationship_tone)
    merged.relationship_tone = insights.relationship_tone;

  await query(
    `UPDATE contacts SET extra = jsonb_set(COALESCE(extra, '{}'), '{insights}', $1::jsonb), updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(merged), contactId],
  );
}

// ─── Core triage function ───

export async function triageInboundMessage(
  conversationId: string,
  msg: ChannelMessage,
  config: JoiConfig,
  broadcast?: BroadcastFn,
  scope?: string,
  language?: string,
): Promise<void> {
  // 1. Look up matched contact for context
  const contactId = await matchContact(msg);
  let contactContext = "";
  if (contactId) {
    const contactResult = await query<{ first_name: string | null; last_name: string | null; company_name: string | null }>(
      `SELECT c.first_name, c.last_name, co.name AS company_name
       FROM contacts c LEFT JOIN companies co ON c.company_id = co.id
       WHERE c.id = $1`,
      [contactId],
    );
    if (contactResult.rows[0]) {
      const c = contactResult.rows[0];
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
      contactContext = `\nSender: ${name || "Unknown"}${c.company_name ? ` (${c.company_name})` : ""}`;
    }
    // Store contact_id on conversation
    await query(
      "UPDATE conversations SET contact_id = $1 WHERE id = $2 AND contact_id IS NULL",
      [contactId, conversationId],
    );
  }

  // 1b. Load matching rules
  let matchingRules: InboxRule[] = [];
  try {
    matchingRules = await loadMatchingRules(msg, config);
  } catch (err) {
    console.error("[Triage] Rules engine failed (continuing without rules):", err);
  }
  const rulesContext = matchingRules.length > 0
    ? `\n\n${formatRulesForPrompt(matchingRules)}`
    : "";

  // 2. Call cheap LLM for classification
  const scopeContext = scope ? `\nScope: This message is from the "${scope}" workspace/context.` : "";
  const langContext = language && language !== "en"
    ? `\nLanguage: The message is in ${language === "de" ? "German" : language === "fr" ? "French" : language === "es" ? "Spanish" : language === "it" ? "Italian" : language === "pt" ? "Portuguese" : language}. Classify in English but understand the message in its original language.`
    : "";
  const userMessage = `Channel: ${msg.channelType}
From: ${msg.senderName || msg.senderId}${contactContext}${scopeContext}${langContext}
Message: ${msg.content}${msg.attachments?.length ? `\nAttachments: ${msg.attachments.map((a) => a.type).join(", ")}` : ""}${rulesContext}`;

  let raw: string;
  try {
    raw = await utilityCall(config, TRIAGE_SYSTEM_PROMPT, userMessage, {
      maxTokens: 768,
      temperature: 0.2,
      task: "triage",
    });
  } catch (err) {
    console.error("[Triage] LLM call failed:", err);
    return;
  }

  // 3. Parse classification
  let triage: TriageResult;
  try {
    // Extract JSON from potential markdown code blocks
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
    triage = JSON.parse(jsonMatch[1]!.trim());
  } catch (err) {
    console.error("[Triage] Failed to parse LLM response:", raw);
    return;
  }

  // Validate required fields
  if (!triage.intent || !triage.urgency || !triage.summary) {
    console.error("[Triage] Incomplete classification:", triage);
    return;
  }

  // Default actions to empty array
  if (!Array.isArray(triage.actions)) triage.actions = [];

  // 3b. Apply relationship insights to contact (fire-and-forget)
  if (
    contactId &&
    triage.relationship_insights &&
    Object.keys(triage.relationship_insights).length > 0
  ) {
    applyRelationshipInsights(contactId, triage.relationship_insights).catch(
      (err) => console.error("[Triage] Insight extraction failed:", err),
    );
  }

  // 3c. Record rule hits
  if (triage.matched_rules?.length && matchingRules.length > 0) {
    for (const rule of matchingRules) {
      if (triage.matched_rules.includes(rule.title)) {
        recordRuleHit(rule.id).catch((err) =>
          console.error("[Triage] Rule hit tracking failed:", err),
        );
      }
    }
  }

  // 3d. Judge evaluation: quality-check the triage before review/auto-approve
  let judgeVerdict: JudgeVerdict | null = null;
  try {
    judgeVerdict = await evaluateTriage(
      triage,
      msg.content,
      msg.senderName || msg.senderId,
      config,
    );
    if (!judgeVerdict.overallPass) {
      console.log(`[Triage] Judge vetoed auto-approve: Tier1=${judgeVerdict.tier1Passed}, Tier2=${judgeVerdict.tier2Verdict}`);
      // Veto auto-approve if judge fails
      triage.auto_approve = false;
    }
  } catch (err) {
    console.warn("[Triage] Judge evaluation failed (continuing without):", err);
  }

  // 3e. Auto-approve check: skip review queue if a matched rule allows it
  if (triage.auto_approve && shouldAutoApprove(matchingRules)) {
    console.log(`[Triage] Auto-approving via rules: ${triage.matched_rules?.join(", ")}`);
    if (triage.actions.length > 0) {
      await executeTriageActions("auto", conversationId, triage.actions, broadcast);
    }
    await query(
      "UPDATE conversations SET inbox_status = 'handled', updated_at = NOW() WHERE id = $1",
      [conversationId],
    );
    await query(
      `INSERT INTO messages (conversation_id, role, content)
       VALUES ($1, 'system', $2)`,
      [conversationId, `[Triage] Auto-approved via rules: ${triage.matched_rules?.join(", ")} — ${triage.intent} (${triage.urgency}): ${triage.summary}`],
    );
    broadcast?.("triage.auto_approved", {
      conversationId,
      rules: triage.matched_rules,
      intent: triage.intent,
      urgency: triage.urgency,
    });
    return;
  }

  // 3f. Auto-handle low-risk noise to prevent review backlog explosion.
  // Only applies when the classifier/judge agreed and there is no actionable plan.
  const judgePassed = judgeVerdict?.overallPass ?? true;
  const noActionOnly = isNoActionPlan(triage.actions);
  const lowRiskNoise = (
    triage.intent === "spam"
    || (triage.intent === "fyi" && triage.urgency === "low" && looksBulkPromotionalEmail(msg))
  );

  if (judgePassed && noActionOnly && lowRiskNoise) {
    if (triage.actions.length > 0) {
      await executeTriageActions("auto", conversationId, triage.actions, broadcast);
    }

    await query(
      "UPDATE conversations SET inbox_status = 'handled', updated_at = NOW() WHERE id = $1",
      [conversationId],
    );
    await query(
      `INSERT INTO messages (conversation_id, role, content)
       VALUES ($1, 'system', $2)`,
      [conversationId, `[Triage] Auto-handled low-risk ${triage.intent}: ${triage.summary}`],
    );
    broadcast?.("triage.auto_handled", {
      conversationId,
      intent: triage.intent,
      urgency: triage.urgency,
      summary: triage.summary,
    });
    return;
  }

  // 4. Create review item
  const priority = triage.urgency === "high" ? 2 : triage.urgency === "medium" ? 1 : 0;
  const tags = ["inbox", msg.channelType, triage.intent];

  const contentBlocks: Array<{ type: string; label: string; content?: string; data?: unknown }> = [
    {
      type: "text",
      label: "Original Message",
      content: `**From:** ${msg.senderName || msg.senderId} (${msg.channelType})\n**Message:** ${msg.content}`,
    },
    {
      type: "json",
      label: "Classification",
      data: { intent: triage.intent, urgency: triage.urgency, summary: triage.summary },
    },
  ];

  if (triage.actions.length > 0) {
    contentBlocks.push({
      type: "json",
      label: "Proposed Actions",
      data: triage.actions,
    });
  }

  if (
    triage.relationship_insights &&
    Object.keys(triage.relationship_insights).length > 0
  ) {
    contentBlocks.push({
      type: "json",
      label: "Relationship Insights",
      data: triage.relationship_insights,
    });
  }

  if (triage.matched_rules?.length) {
    contentBlocks.push({
      type: "json",
      label: "Matched Rules",
      data: triage.matched_rules,
    });
  }

  if (judgeVerdict && !judgeVerdict.overallPass) {
    const failedChecks = judgeVerdict.tier1Checks.filter((c) => !c.passed);
    contentBlocks.push({
      type: "json",
      label: "Quality Check (Judge)",
      data: {
        tier1Passed: judgeVerdict.tier1Passed,
        tier2Verdict: judgeVerdict.tier2Verdict,
        tier2Reason: judgeVerdict.tier2Reason,
        failedChecks: failedChecks.map((c) => ({ name: c.name, reason: c.reason })),
      },
    });
  }

  const reviewResult = await query<{ id: string }>(
    `INSERT INTO review_queue (agent_id, conversation_id, type, title, description,
       content, proposed_action, priority, tags)
     VALUES ($1, $2, 'triage', $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      "personal",
      conversationId,
      `[${triage.intent}] ${triage.summary}`,
      `${triage.urgency} urgency — ${msg.senderName || msg.senderId} via ${msg.channelType}`,
      JSON.stringify(contentBlocks),
      triage.actions.length > 0 ? JSON.stringify(triage.actions) : null,
      priority,
      tags,
    ],
  );

  const reviewId = reviewResult.rows[0].id;

  // 5. Create Things3 task in Reviews > Inbox
  const headings = getReviewsProjectHeadings();
  let things3TaskId: string | null = null;

  if (headings && headings.inbox) {
    try {
      // Generate a deterministic-ish ID for tracking
      // Things3 URL scheme doesn't return the UUID, so we create a unique identifier
      // and search for it later. We embed the review ID in the notes for correlation.
      const urgencyEmoji = triage.urgency === "high" ? "🔴" : triage.urgency === "medium" ? "🟡" : "🟢";
      const taskTitle = `${urgencyEmoji} [${triage.intent}] ${triage.summary}`;
      const taskNotes = `Review: ${reviewId}\nFrom: ${msg.senderName || msg.senderId} (${msg.channelType})\n\n${msg.content}`;

      await createTask(taskTitle, {
        listId: headings.projectId,
        headingId: headings.inbox,
        when: triage.urgency === "high" ? "today" : "anytime",
        tags: [triage.intent, msg.channelType],
        notes: taskNotes,
      });

      // Note: Things3 URL scheme doesn't return the UUID of the created task.
      // We store a marker and will try to find it by title match if needed.
      // For now, we store the review ID as a correlator.
      things3TaskId = `pending:${reviewId}`;
    } catch (err) {
      console.error("[Triage] Things3 task creation failed:", err);
    }
  }

  // 6. Store Things3 reference on review
  if (things3TaskId) {
    await query(
      "UPDATE review_queue SET things3_task_id = $1 WHERE id = $2",
      [things3TaskId, reviewId],
    );
  }

  // 7. Store system message in conversation
  await query(
    `INSERT INTO messages (conversation_id, role, content)
     VALUES ($1, 'system', $2)`,
    [conversationId, `[Triage] ${triage.intent} (${triage.urgency}): ${triage.summary}`],
  );

  // 8. Update conversation status
  await query(
    "UPDATE conversations SET inbox_status = 'triaged', updated_at = NOW() WHERE id = $1",
    [conversationId],
  );

  // 9. Broadcast
  broadcast?.("review.created", {
    id: reviewId,
    agentId: "personal",
    type: "triage",
    title: `[${triage.intent}] ${triage.summary}`,
    priority,
    tags,
  });
}
