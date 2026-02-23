// Quality Center — Prompt Optimizer (Phase 4)
// Analyzes failure clusters, generates revised prompts, A/B tests, and submits to review_queue

import { query } from "../db/client.js";
import { utilityCall } from "../agent/model-router.js";
import { runTestSuite } from "./runner.js";
import type { JoiConfig } from "../config/schema.js";
import type { QAPromptVersion, QATestRun } from "./types.js";

const OPTIMIZER_SYSTEM_PROMPT = `You are a prompt optimization expert. Analyze test failures and produce an improved system prompt.

Given:
1. The current system prompt
2. A list of test failures with judge reasoning
3. The failure patterns

Your job:
- Identify common failure themes (wrong tools, poor formatting, missing context, hallucination)
- Generate a REVISED system prompt that addresses these failures
- Keep changes minimal and targeted — don't rewrite everything
- Explain what you changed and why

Return JSON (no markdown fences):
{
  "revised_prompt": "the full revised system prompt",
  "change_summary": "brief description of what changed",
  "targeted_failures": ["list of failure patterns addressed"]
}`;

/** Analyze failures from a test run and generate a prompt improvement candidate */
export async function generatePromptCandidate(
  config: JoiConfig,
  runId: string,
): Promise<QAPromptVersion | null> {
  // Get the run and its suite's agent
  const runResult = await query<QATestRun & { agent_id: string; system_prompt: string }>(
    `SELECT tr.*, s.agent_id, a.system_prompt
     FROM qa_test_runs tr
     JOIN qa_test_suites s ON tr.suite_id = s.id
     JOIN agents a ON a.id = s.agent_id
     WHERE tr.id = $1`,
    [runId],
  );

  if (runResult.rows.length === 0) return null;
  const { agent_id, system_prompt } = runResult.rows[0];

  // Get failed results with judge reasoning
  const failures = await query<{
    case_name: string;
    input_message: string;
    failure_reasons: string[];
    judge_scores: unknown;
    actual_content: string;
  }>(
    `SELECT c.name AS case_name, c.input_message, r.failure_reasons,
            r.judge_scores, r.actual_content
     FROM qa_test_results r
     JOIN qa_test_cases c ON r.case_id = c.id
     WHERE r.run_id = $1 AND r.status = 'failed'
     ORDER BY r.created_at`,
    [runId],
  );

  if (failures.rows.length === 0) return null;

  // Build failure analysis prompt
  const failureSummary = failures.rows.map((f) => {
    const scores = f.judge_scores as Record<string, unknown> | null;
    return [
      `Case: "${f.case_name}" (input: "${f.input_message}")`,
      `Failures: ${(f.failure_reasons || []).join("; ")}`,
      scores ? `Judge reasoning: ${(scores as Record<string, string>).reasoning || "N/A"}` : "",
      `Response preview: ${(f.actual_content || "").slice(0, 300)}`,
    ].join("\n");
  }).join("\n---\n");

  const userPrompt = `## Current System Prompt
${system_prompt.slice(0, 4000)}

## Test Failures (${failures.rows.length} cases failed)
${failureSummary}

Generate an improved system prompt addressing these failures.`;

  try {
    const raw = await utilityCall(config, OPTIMIZER_SYSTEM_PROMPT, userPrompt, {
      maxTokens: 4000,
      temperature: 0.3,
      task: "utility",
    });

    const jsonStr = raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(jsonStr);

    if (!parsed.revised_prompt) return null;

    // Get next version number
    const versionResult = await query<{ max_version: number }>(
      "SELECT COALESCE(MAX(version), 0) AS max_version FROM qa_prompt_versions WHERE agent_id = $1",
      [agent_id],
    );
    const nextVersion = (versionResult.rows[0].max_version || 0) + 1;

    // Save candidate
    const insertResult = await query<QAPromptVersion>(
      `INSERT INTO qa_prompt_versions (agent_id, version, system_prompt, status, baseline_run_id, change_summary)
       VALUES ($1, $2, $3, 'draft', $4, $5)
       RETURNING *`,
      [agent_id, nextVersion, parsed.revised_prompt, runId, parsed.change_summary],
    );

    return insertResult.rows[0];
  } catch (err) {
    console.error("[QA] Prompt optimization failed:", err);
    return null;
  }
}

/** A/B test: run the same suite with baseline vs candidate prompt, compare scores */
export async function abTestPrompt(
  config: JoiConfig,
  versionId: string,
  suiteId: string,
  broadcast?: (type: string, data: unknown) => void,
): Promise<{ baseline: QATestRun; candidate: QATestRun; winner: "baseline" | "candidate" | "tie" }> {
  const version = await query<QAPromptVersion>(
    "SELECT * FROM qa_prompt_versions WHERE id = $1",
    [versionId],
  );
  if (version.rows.length === 0) throw new Error("Version not found");

  // Mark as testing
  await query(
    "UPDATE qa_prompt_versions SET status = 'testing', updated_at = NOW() WHERE id = $1",
    [versionId],
  );

  // Run baseline (current prompt)
  const baseline = await runTestSuite(suiteId, config, {
    triggeredBy: "ab-test-baseline",
    broadcast,
  });

  // Temporarily swap agent prompt for candidate run
  const agent = await query<{ system_prompt: string }>(
    "SELECT system_prompt FROM agents WHERE id = $1",
    [version.rows[0].agent_id],
  );
  const originalPrompt = agent.rows[0].system_prompt;

  try {
    await query(
      "UPDATE agents SET system_prompt = $1 WHERE id = $2",
      [version.rows[0].system_prompt, version.rows[0].agent_id],
    );

    const candidate = await runTestSuite(suiteId, config, {
      triggeredBy: "ab-test-candidate",
      broadcast,
    });

    // Compare
    const baselineScore = avgOf(baseline.avg_correctness, baseline.avg_tool_accuracy, baseline.avg_response_quality);
    const candidateScore = avgOf(candidate.avg_correctness, candidate.avg_tool_accuracy, candidate.avg_response_quality);

    const winner = candidateScore > baselineScore + 0.05 ? "candidate"
      : baselineScore > candidateScore + 0.05 ? "baseline"
      : "tie";

    // Update version with test results
    await query(
      `UPDATE qa_prompt_versions SET
         test_run_id = $1, scores = $2, status = $3, updated_at = NOW()
       WHERE id = $4`,
      [
        candidate.id,
        JSON.stringify({
          correctness: candidate.avg_correctness,
          tool_accuracy: candidate.avg_tool_accuracy,
          response_quality: candidate.avg_response_quality,
          reasoning: `A/B test: ${winner} (baseline=${baselineScore.toFixed(3)}, candidate=${candidateScore.toFixed(3)})`,
        }),
        winner === "candidate" ? "testing" : "retired",
        versionId,
      ],
    );

    return { baseline, candidate, winner };
  } finally {
    // Restore original prompt
    await query(
      "UPDATE agents SET system_prompt = $1 WHERE id = $2",
      [originalPrompt, version.rows[0].agent_id],
    );
  }
}

/** Submit a winning candidate to the review queue for human approval */
export async function submitForReview(
  versionId: string,
): Promise<string> {
  const version = await query<QAPromptVersion>(
    "SELECT * FROM qa_prompt_versions WHERE id = $1",
    [versionId],
  );
  if (version.rows.length === 0) throw new Error("Version not found");

  const v = version.rows[0];

  const reviewResult = await query<{ id: string }>(
    `INSERT INTO review_queue (agent_id, type, title, description, content, proposed_action, priority, tags)
     VALUES ($1, 'approve', $2, $3, $4, $5, 5, ARRAY['qa', 'prompt-optimization'])
     RETURNING id`,
    [
      v.agent_id,
      `Prompt Improvement v${v.version} for ${v.agent_id}`,
      v.change_summary,
      JSON.stringify([
        { type: "text", label: "Change Summary", content: v.change_summary },
        { type: "diff", label: "Prompt Changes", left: { label: "Current", content: "" }, right: { label: "Proposed", content: v.system_prompt.slice(0, 3000) } },
        { type: "json", label: "Test Scores", data: v.scores },
      ]),
      JSON.stringify({ action: "activate_prompt_version", versionId: v.id, agentId: v.agent_id }),
    ],
  );

  await query(
    "UPDATE qa_prompt_versions SET review_queue_id = $1, updated_at = NOW() WHERE id = $2",
    [reviewResult.rows[0].id, versionId],
  );

  return reviewResult.rows[0].id;
}

/** Activate a prompt version (called after review approval) */
export async function activatePromptVersion(versionId: string): Promise<void> {
  const version = await query<QAPromptVersion>(
    "SELECT * FROM qa_prompt_versions WHERE id = $1",
    [versionId],
  );
  if (version.rows.length === 0) throw new Error("Version not found");

  const v = version.rows[0];

  // Retire all other active versions for this agent
  await query(
    "UPDATE qa_prompt_versions SET status = 'retired', updated_at = NOW() WHERE agent_id = $1 AND status = 'active'",
    [v.agent_id],
  );

  // Activate this version
  await query(
    "UPDATE qa_prompt_versions SET status = 'active', updated_at = NOW() WHERE id = $1",
    [versionId],
  );

  // Update the agent's system prompt
  await query(
    "UPDATE agents SET system_prompt = $1 WHERE id = $2",
    [v.system_prompt, v.agent_id],
  );
}

function avgOf(...values: (number | null)[]): number {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}
