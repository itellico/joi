// Quality Center — Issue Manager
// Auto-creates issues from failed test cases, tracks severity, detects regressions, pushes to AutoDev

import { query } from "../db/client.js";
import { createTask, getActiveTasks, getProjectHeadings, getProjects } from "../things/client.js";
import type { QAIssue, QATestRun, QATestResult, JudgeScores } from "./types.js";

interface AutoDevRuntimeIssueInput {
  error: string;
  taskUuid?: string | null;
  taskTitle?: string | null;
  taskNotes?: string | null;
  projectTitle?: string | null;
  headingTitle?: string | null;
  tags?: string[];
  executor?: string | null;
  agentId?: string | null;
  skill?: string | null;
  routeReason?: string | null;
  strict?: boolean;
  logExcerpt?: string | null;
}

const AUTODEV_PROJECT_TITLE = process.env.JOI_AUTODEV_PROJECT_TITLE?.trim() || "JOI";
const AUTODEV_CLAUDE_HEADING = process.env.JOI_AUTODEV_CLAUDE_HEADING?.trim() || "Claude";

type RunModelConfig = Record<string, unknown> | null;

/** Create issues for all failed results in a test run */
export async function createIssuesFromRun(run: QATestRun): Promise<QAIssue[]> {
  // Get failed/errored results with case info
  const results = await query<QATestResult & {
    case_name: string;
    case_description: string | null;
    input_message: string;
    suite_name: string;
    suite_tags: string[] | null;
    suite_agent_id: string;
    run_model_config: RunModelConfig;
  }>(
    `SELECT r.*, c.name AS case_name, c.description AS case_description, c.input_message,
            s.name AS suite_name, s.tags AS suite_tags, s.agent_id AS suite_agent_id,
            tr.model_config AS run_model_config
     FROM qa_test_results r
     JOIN qa_test_cases c ON r.case_id = c.id
     JOIN qa_test_runs tr ON tr.id = r.run_id
     JOIN qa_test_suites s ON s.id = $2
     WHERE r.run_id = $1 AND r.status IN ('failed', 'errored')`,
    [run.id, run.suite_id],
  );

  const created: QAIssue[] = [];

  for (const result of results.rows) {
    // Dedup: check if open issue already exists for this test case
    const existing = await query<{ id: string; tags: string[] | null }>(
      `SELECT id, tags FROM qa_issues
       WHERE test_case_id = $1 AND status NOT IN ('closed', 'verified')
       LIMIT 1`,
      [result.case_id],
    );

    const mergedTags = Array.from(new Set([
      ...((result.suite_tags || []).filter((tag): tag is string => typeof tag === "string")),
      ...inferSoulIssueTags(result),
    ])).slice(0, 30);

    if (existing.rows.length > 0) {
      // Update existing issue with latest run/result
      const nextTags = Array.from(new Set([
        ...((existing.rows[0].tags || []).filter((tag): tag is string => typeof tag === "string")),
        ...mergedTags,
      ])).slice(0, 30);
      await query(
        `UPDATE qa_issues SET
           test_run_id = $1, test_result_id = $2,
           evidence = $3, tags = $4, updated_at = NOW()
         WHERE id = $5`,
        [run.id, result.id, buildEvidence(result), nextTags, existing.rows[0].id],
      );
      continue;
    }

    // Determine severity from judge scores
    const scores = result.judge_scores as JudgeScores | null;
    const severity = determineSeverity(scores);

    // Check for regression (was this passing in the previous run?)
    const category = await detectRegression(result.case_id, run.id);

    const runModel = (result.run_model_config && typeof result.run_model_config === "object")
      ? result.run_model_config
      : null;
    const runAgentRaw = runModel?.agentId;
    const runExecutionModeRaw = runModel?.executionMode;
    const runRouteReasonRaw = runModel?.routeReason;
    const runRouteConfidenceRaw = runModel?.routeConfidence;
    const runAgent = typeof runAgentRaw === "string" && runAgentRaw.trim().length > 0
      ? runAgentRaw.trim()
      : result.suite_agent_id;
    const runExecutionMode = typeof runExecutionModeRaw === "string" ? runExecutionModeRaw.trim() : "";
    const runRouteReason = typeof runRouteReasonRaw === "string" ? runRouteReasonRaw.trim() : "";
    const runRouteConfidence = typeof runRouteConfidenceRaw === "number" && Number.isFinite(runRouteConfidenceRaw)
      ? runRouteConfidenceRaw
      : null;

    const title = `${result.case_name}: ${result.failure_reasons?.[0] || result.status}`;
    const description = [
      `**Suite**: ${result.suite_name}`,
      runAgent ? `**Agent**: ${runAgent}` : null,
      `**Input**: "${result.input_message}"`,
      `**Status**: ${result.status}`,
      runExecutionMode ? `**Execution mode**: ${runExecutionMode}` : null,
      runRouteReason ? `**Route reason**: ${runRouteReason}` : null,
      runRouteConfidence !== null ? `**Route confidence**: ${(runRouteConfidence * 100).toFixed(1)}%` : null,
      result.case_description ? `**Capture context**:\n${result.case_description}` : null,
      scores ? `**Scores**: correctness=${scores.correctness.toFixed(2)}, tool_accuracy=${scores.tool_accuracy.toFixed(2)}, quality=${scores.response_quality.toFixed(2)}` : null,
      result.failure_reasons?.length ? `**Failures**:\n${result.failure_reasons.map((r: string) => `- ${r}`).join("\n")}` : null,
      scores?.reasoning ? `**Judge reasoning**: ${scores.reasoning}` : null,
    ].filter(Boolean).join("\n\n");

    const issueResult = await query<QAIssue>(
      `INSERT INTO qa_issues (title, description, severity, category, test_case_id, test_run_id, test_result_id, evidence, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [title, description, severity, category, result.case_id, run.id, result.id, buildEvidence(result), mergedTags],
    );

    created.push(issueResult.rows[0]);
  }

  return created;
}

/** Create or update an open Quality issue for an AutoDev runtime failure */
export async function createAutoDevRuntimeIssue(
  input: AutoDevRuntimeIssueInput,
): Promise<{ issue: QAIssue; created: boolean }> {
  const error = (input.error || "").trim();
  const taskUuid = input.taskUuid?.trim() || null;
  const taskTitle = input.taskTitle?.trim() || "AutoDev task failed";
  const tags = Array.from(new Set(["autodev", "runtime", ...(input.tags || [])])).slice(0, 20);
  const severity = determineAutoDevSeverity(error);
  const title = `[AutoDev] ${taskTitle}`;

  const descriptionParts = [
    `AutoDev execution failed during a runtime task.`,
    ``,
    `**Task**: ${taskTitle}`,
    taskUuid ? `**Task UUID**: ${taskUuid}` : null,
    input.projectTitle ? `**Project**: ${input.projectTitle}` : null,
    input.headingTitle ? `**Section**: ${input.headingTitle}` : null,
    input.executor ? `**Executor**: ${input.executor}` : null,
    input.agentId ? `**Agent**: ${input.agentId}` : null,
    input.skill ? `**Route Skill**: ${input.skill}` : null,
    input.routeReason ? `**Route Reason**: ${input.routeReason}` : null,
    typeof input.strict === "boolean" ? `**Strict Route**: ${input.strict ? "yes" : "no"}` : null,
    ``,
    `**Error**:`,
    "```",
    error,
    "```",
  ].filter(Boolean);

  const evidenceBlocks = [
    {
      type: "text",
      label: "AutoDev Error",
      content: error,
    },
    {
      type: "json",
      label: "Routing Context",
      data: {
        taskUuid,
        taskTitle,
        projectTitle: input.projectTitle || null,
        headingTitle: input.headingTitle || null,
        tags,
        executor: input.executor || null,
        agentId: input.agentId || null,
        skill: input.skill || null,
        routeReason: input.routeReason || null,
        strict: input.strict ?? null,
      },
    },
    input.taskNotes
      ? {
          type: "text",
          label: "Task Notes",
          content: input.taskNotes.slice(0, 8000),
        }
      : null,
    input.logExcerpt
      ? {
          type: "text",
          label: "AutoDev Log Excerpt",
          content: input.logExcerpt.slice(-12000),
        }
      : null,
  ].filter(Boolean);

  if (taskUuid) {
    const existing = await query<QAIssue>(
      `SELECT * FROM qa_issues
       WHERE autodev_task_id = $1
         AND category = 'tool_error'
         AND status NOT IN ('closed', 'verified')
       ORDER BY created_at DESC
       LIMIT 1`,
      [taskUuid],
    );

    if (existing.rows.length > 0) {
      const updated = await query<QAIssue>(
        `UPDATE qa_issues
         SET title = $1,
             description = $2,
             severity = $3,
             evidence = $4,
             tags = $5,
             updated_at = NOW()
         WHERE id = $6
         RETURNING *`,
        [
          title,
          descriptionParts.join("\n"),
          severity,
          JSON.stringify(evidenceBlocks),
          tags,
          existing.rows[0].id,
        ],
      );
      return { issue: updated.rows[0], created: false };
    }
  }

  const inserted = await query<QAIssue>(
    `INSERT INTO qa_issues (
       title, description, severity, category, status,
       autodev_task_id, evidence, tags
     ) VALUES (
       $1, $2, $3, 'tool_error', 'open',
       $4, $5, $6
     )
     RETURNING *`,
    [
      title,
      descriptionParts.join("\n"),
      severity,
      taskUuid,
      JSON.stringify(evidenceBlocks),
      tags,
    ],
  );

  return { issue: inserted.rows[0], created: true };
}

/** Push issue to Things3 for AutoDev to pick up */
export async function pushToAutodev(issueId: string): Promise<QAIssue> {
  const result = await query<QAIssue>(
    "SELECT * FROM qa_issues WHERE id = $1",
    [issueId],
  );
  if (result.rows.length === 0) throw new Error(`Issue not found: ${issueId}`);

  const issue = result.rows[0];
  if (issue.status === "autodev_assigned" && issue.autodev_task_id) {
    return issue;
  }

  const placement = resolveAutoDevPlacement();
  const taskTitle = `[QA] ${issue.title}`;
  if (issue.status === "autodev_assigned" && !issue.autodev_task_id) {
    const existingTaskId = await findCreatedAutodevTaskUuid(issue, taskTitle, placement.projectUuid || null);
    if (existingTaskId) {
      const withTaskId = await query<QAIssue>(
        `UPDATE qa_issues
           SET autodev_task_id = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [issueId, existingTaskId],
      );
      return withTaskId.rows[0];
    }
  }

  await createTask(taskTitle, {
    notes: [
      issue.description || "",
      "",
      "Executor: claude-code (required for Quality issues)",
      `Route: project=${placement.projectTitle || "unknown"}, section=${placement.headingTitle || AUTODEV_CLAUDE_HEADING}`,
      `Severity: ${issue.severity}`,
      `Category: ${issue.category}`,
      `Issue ID: ${issue.id}`,
      issue.test_case_id ? `Test Case: ${issue.test_case_id}` : "",
    ].join("\n"),
    tags: ["qa", "autodev", issue.severity, "claude"],
    when: issue.severity === "critical" ? "today" : "anytime",
    listId: placement.projectUuid || undefined,
    headingId: placement.headingUuid || undefined,
    heading: !placement.headingUuid ? AUTODEV_CLAUDE_HEADING : undefined,
  });

  const autodevTaskId = await findCreatedAutodevTaskUuid(issue, taskTitle, placement.projectUuid || null);
  const updated = await query<QAIssue>(
    `UPDATE qa_issues
       SET status = 'autodev_assigned',
           autodev_task_id = COALESCE($2, autodev_task_id),
           updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [issueId, autodevTaskId],
  );
  return updated.rows[0];
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

function inferSoulIssueTags(result: {
  suite_name?: string | null;
  suite_tags?: string[] | null;
  case_name?: string | null;
  case_description?: string | null;
  input_message?: string | null;
  failure_reasons?: string[] | null;
}): string[] {
  const suiteTags = (result.suite_tags || []).filter((tag): tag is string => typeof tag === "string");
  const suiteName = (result.suite_name || "").toLowerCase();
  const isSoulSuite = suiteName.includes("soul")
    || suiteTags.some((tag) => tag.toLowerCase().includes("soul"));

  if (!isSoulSuite) return [];

  const text = [
    result.case_name || "",
    result.case_description || "",
    result.input_message || "",
    ...(result.failure_reasons || []),
  ].join(" ").toLowerCase();

  const tags = new Set<string>(["soul", "governance"]);
  const sectionMatchers: Array<{ tag: string; pattern: RegExp }> = [
    { tag: "soul:identity", pattern: /\b(identity|persona|who are you|self)\b/i },
    { tag: "soul:mission", pattern: /\b(mission|goal|objective|purpose|task)\b/i },
    { tag: "soul:values", pattern: /\b(value|ethic|principle)\b/i },
    { tag: "soul:boundaries", pattern: /\b(boundar|safety|policy|compliance|forbidden|risk)\b/i },
    { tag: "soul:decision-policy", pattern: /\b(decision|tradeoff|reasoning|priorit)\b/i },
    { tag: "soul:collaboration", pattern: /\b(collab|handoff|team|coordinate|social)\b/i },
    { tag: "soul:learning-loop", pattern: /\b(learn|reflection|improv|retrospective)\b/i },
    { tag: "soul:success-metrics", pattern: /\b(success|metric|kpi|score)\b/i },
  ];

  for (const matcher of sectionMatchers) {
    if (matcher.pattern.test(text)) {
      tags.add(matcher.tag);
    }
  }

  return Array.from(tags);
}

function determineSeverity(scores: JudgeScores | null): "critical" | "high" | "medium" | "low" {
  if (!scores) return "high"; // Errored test = high severity

  const avg = (scores.correctness + scores.tool_accuracy + scores.response_quality) / 3;
  if (avg < 0.3) return "critical";
  if (avg < 0.5) return "high";
  if (avg < 0.7) return "medium";
  return "low";
}

function determineAutoDevSeverity(error: string): "critical" | "high" | "medium" | "low" {
  const text = error.toLowerCase();
  if (
    /database_url|database|connection refused|permission denied|column .* does not exist|duplicate key|migration|schema/.test(text)
  ) {
    return "high";
  }
  if (/failed to spawn|not found|enoent|timed out|timeout|aborted|resource_exhausted|429/.test(text)) {
    return "medium";
  }
  return "low";
}

function resolveAutoDevPlacement(): {
  projectUuid: string | null;
  projectTitle: string | null;
  headingUuid: string | null;
  headingTitle: string | null;
} {
  try {
    const projects = getProjects();
    const project = projects.find((p) => p.title.trim().toLowerCase() === AUTODEV_PROJECT_TITLE.toLowerCase());
    if (!project) {
      return { projectUuid: null, projectTitle: null, headingUuid: null, headingTitle: null };
    }

    const headings = getProjectHeadings(project.uuid);
    const heading = headings.find((h) => h.title.trim().toLowerCase() === AUTODEV_CLAUDE_HEADING.toLowerCase())
      || headings.find((h) => /\b(claude|cloride|chloride)\b/i.test(h.title));

    return {
      projectUuid: project.uuid,
      projectTitle: project.title,
      headingUuid: heading?.uuid || null,
      headingTitle: heading?.title || null,
    };
  } catch {
    return { projectUuid: null, projectTitle: null, headingUuid: null, headingTitle: null };
  }
}

async function findCreatedAutodevTaskUuid(
  issue: QAIssue,
  expectedTitle: string,
  projectUuid: string | null,
): Promise<string | null> {
  const marker = `Issue ID: ${issue.id}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const tasks = getActiveTasks();
    const candidates = tasks
      .filter((task) => task.title === expectedTitle)
      .filter((task) => (task.notes || "").includes(marker))
      .filter((task) => !projectUuid || task.projectUuid === projectUuid)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (candidates.length > 0) {
      return candidates[0].uuid;
    }
    await sleep(300 + attempt * 120);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      content: result.actual_content.slice(0, 12000),
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
