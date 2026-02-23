// Quality Center — Issue Manager
// Auto-creates issues from failed test cases, tracks severity, detects regressions, pushes to AutoDev

import { query } from "../db/client.js";
import { createTask } from "../things/client.js";
import type { QAIssue, QATestRun, QATestResult, JudgeScores } from "./types.js";

/** Create issues for all failed results in a test run */
export async function createIssuesFromRun(run: QATestRun): Promise<QAIssue[]> {
  // Get failed/errored results with case info
  const results = await query<QATestResult & { case_name: string; input_message: string; suite_name: string }>(
    `SELECT r.*, c.name AS case_name, c.input_message, s.name AS suite_name
     FROM qa_test_results r
     JOIN qa_test_cases c ON r.case_id = c.id
     JOIN qa_test_suites s ON s.id = $2
     WHERE r.run_id = $1 AND r.status IN ('failed', 'errored')`,
    [run.id, run.suite_id],
  );

  const created: QAIssue[] = [];

  for (const result of results.rows) {
    // Dedup: check if open issue already exists for this test case
    const existing = await query<{ id: string }>(
      `SELECT id FROM qa_issues
       WHERE test_case_id = $1 AND status NOT IN ('closed', 'verified')
       LIMIT 1`,
      [result.case_id],
    );

    if (existing.rows.length > 0) {
      // Update existing issue with latest run/result
      await query(
        `UPDATE qa_issues SET
           test_run_id = $1, test_result_id = $2,
           evidence = $3, updated_at = NOW()
         WHERE id = $4`,
        [run.id, result.id, buildEvidence(result), existing.rows[0].id],
      );
      continue;
    }

    // Determine severity from judge scores
    const scores = result.judge_scores as JudgeScores | null;
    const severity = determineSeverity(scores);

    // Check for regression (was this passing in the previous run?)
    const category = await detectRegression(result.case_id, run.id);

    const title = `${result.case_name}: ${result.failure_reasons?.[0] || result.status}`;
    const description = [
      `**Suite**: ${result.suite_name}`,
      `**Input**: "${result.input_message}"`,
      `**Status**: ${result.status}`,
      scores ? `**Scores**: correctness=${scores.correctness.toFixed(2)}, tool_accuracy=${scores.tool_accuracy.toFixed(2)}, quality=${scores.response_quality.toFixed(2)}` : null,
      result.failure_reasons?.length ? `**Failures**:\n${result.failure_reasons.map((r: string) => `- ${r}`).join("\n")}` : null,
      scores?.reasoning ? `**Judge reasoning**: ${scores.reasoning}` : null,
    ].filter(Boolean).join("\n\n");

    const issueResult = await query<QAIssue>(
      `INSERT INTO qa_issues (title, description, severity, category, test_case_id, test_run_id, test_result_id, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [title, description, severity, category, result.case_id, run.id, result.id, buildEvidence(result)],
    );

    created.push(issueResult.rows[0]);
  }

  return created;
}

/** Push issue to Things3 for AutoDev to pick up */
export async function pushToAutodev(issueId: string): Promise<void> {
  const result = await query<QAIssue>(
    "SELECT * FROM qa_issues WHERE id = $1",
    [issueId],
  );
  if (result.rows.length === 0) throw new Error(`Issue not found: ${issueId}`);

  const issue = result.rows[0];

  await createTask(`[QA] ${issue.title}`, {
    notes: [
      issue.description || "",
      "",
      `Severity: ${issue.severity}`,
      `Category: ${issue.category}`,
      `Issue ID: ${issue.id}`,
      issue.test_case_id ? `Test Case: ${issue.test_case_id}` : "",
    ].join("\n"),
    tags: ["qa", "autodev", issue.severity],
    when: issue.severity === "critical" ? "today" : "anytime",
  });

  await query(
    `UPDATE qa_issues SET status = 'autodev_assigned', updated_at = NOW() WHERE id = $1`,
    [issueId],
  );
}

/** Detect regressions by comparing against previous run */
async function detectRegression(caseId: string, currentRunId: string): Promise<string> {
  const prev = await query<{ status: string }>(
    `SELECT r.status FROM qa_test_results r
     JOIN qa_test_runs tr ON r.run_id = tr.id
     WHERE r.case_id = $1 AND r.run_id != $2
     ORDER BY tr.created_at DESC LIMIT 1`,
    [caseId, currentRunId],
  );

  if (prev.rows.length > 0 && prev.rows[0].status === "passed") {
    return "regression";
  }
  return "quality";
}

function determineSeverity(scores: JudgeScores | null): "critical" | "high" | "medium" | "low" {
  if (!scores) return "high"; // Errored test = high severity

  const avg = (scores.correctness + scores.tool_accuracy + scores.response_quality) / 3;
  if (avg < 0.3) return "critical";
  if (avg < 0.5) return "high";
  if (avg < 0.7) return "medium";
  return "low";
}

function buildEvidence(result: QATestResult & { case_name?: string; input_message?: string }): string {
  const blocks = [];

  blocks.push({
    type: "text",
    label: "Test Input",
    content: result.input_message || "(unknown)",
  });

  if (result.actual_content) {
    blocks.push({
      type: "text",
      label: "Agent Response",
      content: result.actual_content.slice(0, 2000),
    });
  }

  if (result.actual_tools && (result.actual_tools as unknown[]).length > 0) {
    blocks.push({
      type: "json",
      label: "Tools Used",
      data: result.actual_tools,
    });
  }

  if (result.judge_scores) {
    blocks.push({
      type: "json",
      label: "Judge Scores",
      data: result.judge_scores,
    });
  }

  if (result.failure_reasons?.length) {
    blocks.push({
      type: "text",
      label: "Failure Reasons",
      content: result.failure_reasons.join("\n"),
    });
  }

  return JSON.stringify(blocks);
}

// ─── CRUD ───

export async function listIssues(filters?: {
  status?: string;
  severity?: string;
  category?: string;
  limit?: number;
  offset?: number;
}): Promise<{ issues: QAIssue[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters?.status) { conditions.push(`status = $${idx++}`); params.push(filters.status); }
  if (filters?.severity) { conditions.push(`severity = $${idx++}`); params.push(filters.severity); }
  if (filters?.category) { conditions.push(`category = $${idx++}`); params.push(filters.category); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;

  const [countResult, issueResult] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*) FROM qa_issues ${where}`, params),
    query<QAIssue>(
      `SELECT * FROM qa_issues ${where} ORDER BY
         CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    ),
  ]);

  return {
    issues: issueResult.rows,
    total: parseInt(countResult.rows[0].count),
  };
}

export async function updateIssue(id: string, updates: {
  status?: string;
  severity?: string;
  resolution_notes?: string;
}): Promise<QAIssue> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  if (updates.status) { sets.push(`status = $${idx++}`); vals.push(updates.status); }
  if (updates.severity) { sets.push(`severity = $${idx++}`); vals.push(updates.severity); }
  if (updates.resolution_notes !== undefined) { sets.push(`resolution_notes = $${idx++}`); vals.push(updates.resolution_notes); }

  sets.push("updated_at = NOW()");
  vals.push(id);

  const result = await query<QAIssue>(
    `UPDATE qa_issues SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    vals,
  );

  if (result.rows.length === 0) throw new Error("Issue not found");
  return result.rows[0];
}
