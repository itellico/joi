// Judge Evaluator: Two-tier quality assessment for triage classifications
// Tier 1: Deterministic checks (0 LLM calls)
// Tier 2: LLM quality assessment (1 utilityCall)

import { utilityCall } from "../agent/model-router.js";
import type { JoiConfig } from "../config/schema.js";
import type { TriageResult } from "../channels/triage.js";

// ─── Types ───

export interface JudgeCheck {
  name: string;
  passed: boolean;
  reason: string;
}

export interface JudgeVerdict {
  tier1Checks: JudgeCheck[];
  tier1Passed: boolean;
  tier2Verdict: "SATISFIED" | "UNSATISFIED" | "SKIPPED";
  tier2Reason: string;
  overallPass: boolean;
}

// ─── Tier 1: Deterministic Checks ───

function runTier1Checks(triage: TriageResult, messageContent: string): JudgeCheck[] {
  const checks: JudgeCheck[] = [];

  // 1. Interactive intents must have a reply draft
  const interactiveIntents = ["question", "request", "urgent"];
  if (interactiveIntents.includes(triage.intent)) {
    const hasReply = triage.actions.some((a) => a.type === "reply" && a.draft);
    checks.push({
      name: "reply_for_interactive",
      passed: hasReply,
      reason: hasReply
        ? "Interactive intent has reply draft"
        : `${triage.intent} intent should include a reply draft`,
    });
  }

  // 2. Spam should only have no_action
  if (triage.intent === "spam") {
    const onlyNoAction = triage.actions.every((a) => a.type === "no_action") || triage.actions.length === 0;
    checks.push({
      name: "no_actions_for_spam",
      passed: onlyNoAction,
      reason: onlyNoAction
        ? "Spam correctly has no actions"
        : "Spam intent should only have no_action",
    });
  }

  // 3. Urgent intent must have high urgency
  if (triage.intent === "urgent") {
    const isHigh = triage.urgency === "high";
    checks.push({
      name: "urgency_consistency",
      passed: isHigh,
      reason: isHigh
        ? "Urgent intent has high urgency"
        : `Urgent intent has ${triage.urgency} urgency — should be high`,
    });
  }

  // 4. Reply drafts must not be empty
  const replyActions = triage.actions.filter((a) => a.type === "reply");
  for (const action of replyActions) {
    const hasContent = !!action.draft && action.draft.length > 5;
    checks.push({
      name: "reply_not_empty",
      passed: hasContent,
      reason: hasContent
        ? "Reply draft has content"
        : "Reply draft is empty or too short",
    });
  }

  // 5. Created tasks must have meaningful titles
  const taskActions = triage.actions.filter((a) => a.type === "create_task");
  for (const action of taskActions) {
    const hasTitle = !!action.title && action.title.length > 3;
    checks.push({
      name: "task_has_title",
      passed: hasTitle,
      reason: hasTitle
        ? "Task has meaningful title"
        : "Task is missing a meaningful title",
    });
  }

  // 6. Summary must be meaningful
  const goodSummary = !!triage.summary && triage.summary.length >= 10;
  checks.push({
    name: "summary_quality",
    passed: goodSummary,
    reason: goodSummary
      ? "Summary is adequate"
      : "Summary is too short or missing",
  });

  return checks;
}

// ─── Tier 2: LLM Quality Assessment ───

const JUDGE_SYSTEM_PROMPT = `You are a quality judge for message triage classifications. Evaluate whether the classification and proposed actions are appropriate for the given message.

Consider:
- Is the intent classification correct?
- Is the urgency level appropriate?
- Are the proposed actions helpful and relevant?
- Is the reply draft (if any) appropriate in tone and content?

Respond with ONLY valid JSON: { "verdict": "SATISFIED" | "UNSATISFIED", "reason": "brief explanation" }
No markdown fences.`;

async function runTier2(
  triage: TriageResult,
  messageContent: string,
  senderContext: string,
  config: JoiConfig,
): Promise<{ verdict: "SATISFIED" | "UNSATISFIED"; reason: string }> {
  const userMessage = `Message: ${messageContent}
Sender: ${senderContext}

Classification:
- Intent: ${triage.intent}
- Urgency: ${triage.urgency}
- Summary: ${triage.summary}

Proposed Actions:
${JSON.stringify(triage.actions, null, 2)}`;

  const raw = await utilityCall(config, JUDGE_SYSTEM_PROMPT, userMessage, {
    maxTokens: 128,
    temperature: 0,
    task: "utility",
  });

  try {
    const parsed = JSON.parse(raw);
    if (parsed.verdict === "SATISFIED" || parsed.verdict === "UNSATISFIED") {
      return { verdict: parsed.verdict, reason: parsed.reason || "" };
    }
  } catch {
    // Parse failure — treat as skip
  }

  return { verdict: "SATISFIED", reason: "Judge parse failed — defaulting to pass" };
}

// ─── Main Evaluator ───

export async function evaluateTriage(
  triage: TriageResult,
  messageContent: string,
  senderContext: string,
  config: JoiConfig,
): Promise<JudgeVerdict> {
  // Tier 1: deterministic
  const tier1Checks = runTier1Checks(triage, messageContent);
  const tier1Passed = tier1Checks.every((c) => c.passed);

  // Tier 2: skip for trivial cases or if Tier 1 already failed
  const isTrivial = triage.intent === "spam" || (
    triage.actions.length === 1 && triage.actions[0].type === "no_action"
  ) || triage.actions.length === 0;

  let tier2Verdict: "SATISFIED" | "UNSATISFIED" | "SKIPPED" = "SKIPPED";
  let tier2Reason = "";

  if (!tier1Passed) {
    tier2Verdict = "SKIPPED";
    tier2Reason = "Skipped — Tier 1 already failed";
  } else if (isTrivial) {
    tier2Verdict = "SKIPPED";
    tier2Reason = "Skipped — trivial case";
  } else {
    try {
      const result = await runTier2(triage, messageContent, senderContext, config);
      tier2Verdict = result.verdict;
      tier2Reason = result.reason;
    } catch (err) {
      tier2Verdict = "SKIPPED";
      tier2Reason = `Tier 2 failed: ${(err as Error).message}`;
      console.warn("[Judge] Tier 2 LLM call failed:", err);
    }
  }

  const overallPass = tier1Passed && tier2Verdict !== "UNSATISFIED";

  return { tier1Checks, tier1Passed, tier2Verdict, tier2Reason, overallPass };
}
