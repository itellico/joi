// Quality Observer — Live chat analysis
// Automatically evaluates every chat for quality, detects issues, and feeds the self-improving loop.

import { query } from "../db/client.js";
import { utilityCall } from "../agent/model-router.js";
import type { JoiConfig } from "../config/schema.js";
import type { QAChatAnalysis, QAObserverConfig, QAChatAnalysisStats, JudgeScores } from "./types.js";

// ─── Types ───

export interface ChatDoneInput {
  conversationId: string;
  messageId: string;
  content: string;
  agentId?: string;
  agentName?: string;
  model?: string;
  provider?: string;
  latencyMs?: number;
  costUsd?: number;
  executionMode?: string;
}

type BroadcastFn = (type: string, data: unknown) => void;

// ─── Config ───

export async function getObserverConfig(): Promise<QAObserverConfig> {
  const result = await query<QAObserverConfig>(
    "SELECT enabled, quality_threshold, skip_dry_run, min_user_message_length, updated_at FROM qa_observer_config WHERE id = 1",
  );
  if (result.rows.length === 0) {
    return { enabled: false, quality_threshold: 0.4, skip_dry_run: true, min_user_message_length: 3, updated_at: new Date().toISOString() };
  }
  return result.rows[0];
}

export async function setObserverConfig(updates: Partial<Omit<QAObserverConfig, "updated_at">>): Promise<QAObserverConfig> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;
  if (updates.enabled !== undefined) { sets.push(`enabled = $${idx++}`); vals.push(updates.enabled); }
  if (updates.quality_threshold !== undefined) { sets.push(`quality_threshold = $${idx++}`); vals.push(updates.quality_threshold); }
  if (updates.skip_dry_run !== undefined) { sets.push(`skip_dry_run = $${idx++}`); vals.push(updates.skip_dry_run); }
  if (updates.min_user_message_length !== undefined) { sets.push(`min_user_message_length = $${idx++}`); vals.push(updates.min_user_message_length); }
  if (sets.length === 0) return getObserverConfig();
  sets.push("updated_at = NOW()");
  const result = await query<QAObserverConfig>(
    `UPDATE qa_observer_config SET ${sets.join(", ")} WHERE id = 1 RETURNING enabled, quality_threshold, skip_dry_run, min_user_message_length, updated_at`,
    vals,
  );
  return result.rows[0];
}

// ─── Entry point (non-blocking) ───

export async function analyzeChatAsync(
  config: JoiConfig,
  input: ChatDoneInput,
  broadcast: BroadcastFn,
): Promise<void> {
  const observerConfig = await getObserverConfig();
  if (!observerConfig.enabled) return;

  // Skip conditions
  if (input.executionMode === "dry_run" && observerConfig.skip_dry_run) return;

  // Fetch the user message from conversation
  const userMsgResult = await query<{ content: string; role: string }>(
    `SELECT content, role FROM messages
     WHERE conversation_id = $1 AND role = 'user'
     ORDER BY created_at DESC LIMIT 1`,
    [input.conversationId],
  );
  const userMessage = userMsgResult.rows[0]?.content || "";
  if (userMessage.length < observerConfig.min_user_message_length) return;

  // Fetch tool calls/results from the assistant message
  const toolData = await query<{ tool_calls: unknown; tool_results: unknown }>(
    `SELECT tool_calls, tool_results FROM messages WHERE id = $1`,
    [input.messageId],
  );
  const toolCalls = toolData.rows[0]?.tool_calls || [];
  const toolResults = toolData.rows[0]?.tool_results || [];

  // Insert pending row
  const insertResult = await query<{ id: string }>(
    `INSERT INTO qa_chat_analyses
       (conversation_id, message_id, agent_id, agent_name, user_message, assistant_content,
        tool_calls, tool_results, latency_ms, cost_usd, model, provider, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
     RETURNING id`,
    [
      input.conversationId, input.messageId,
      input.agentId || null, input.agentName || null,
      userMessage, input.content,
      JSON.stringify(toolCalls), JSON.stringify(toolResults),
      input.latencyMs || null, input.costUsd || null,
      input.model || null, input.provider || null,
    ],
  );
  const analysisId = insertResult.rows[0].id;

  // Fire async analysis — don't await
  analyzeChat(config, analysisId, observerConfig, {
    userMessage,
    assistantContent: input.content,
    toolCalls: Array.isArray(toolCalls) ? toolCalls : [],
    toolResults: Array.isArray(toolResults) ? toolResults : [],
    agentId: input.agentId,
  }, broadcast).catch(err => {
    console.warn("[QA Observer] Analysis failed:", err);
    query(
      "UPDATE qa_chat_analyses SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2",
      [String(err), analysisId],
    ).catch(() => {});
  });
}

// ─── LLM evaluation ───

interface AnalysisInput {
  userMessage: string;
  assistantContent: string;
  toolCalls: unknown[];
  toolResults: unknown[];
  agentId?: string;
}

async function analyzeChat(
  config: JoiConfig,
  analysisId: string,
  observerConfig: QAObserverConfig,
  input: AnalysisInput,
  broadcast: BroadcastFn,
): Promise<void> {
  await query("UPDATE qa_chat_analyses SET status = 'analyzing', updated_at = NOW() WHERE id = $1", [analysisId]);

  const toolSummary = input.toolCalls.length > 0
    ? `Tools called: ${JSON.stringify(input.toolCalls).slice(0, 2000)}`
    : "No tools were called.";

  const toolResultSummary = (input.toolResults as unknown[]).length > 0
    ? `Tool results: ${JSON.stringify(input.toolResults).slice(0, 2000)}`
    : "";

  const systemPrompt = `You are a quality evaluator for an AI assistant called JOI. Analyze the following chat exchange and score it.

Return ONLY valid JSON (no markdown fences) with this exact structure:
{
  "correctness": <0.0-1.0>,
  "tool_accuracy": <0.0-1.0>,
  "response_quality": <0.0-1.0>,
  "reasoning": "<brief explanation>",
  "issues": [{"type": "<tool_failure|missing_tool|hallucination|format_error|incomplete_response|wrong_answer|safety_concern>", "severity": "<critical|high|medium|low>", "description": "<what went wrong>"}],
  "skills_used": ["<skill names inferred from tools/content>"],
  "skills_expected": ["<skills that should have been used but weren't>"]
}

Scoring guide:
- correctness: Did the assistant answer correctly? (1.0 = perfect, 0.0 = completely wrong)
- tool_accuracy: Were the right tools called with correct parameters? If no tools needed, score 1.0.
- response_quality: Was the response clear, helpful, well-formatted? (1.0 = excellent)

Be strict but fair. Only flag real issues. An empty issues array is fine for good responses.`;

  const userPrompt = `User message: ${input.userMessage}

Assistant response: ${input.assistantContent?.slice(0, 3000) || "(empty)"}

${toolSummary}
${toolResultSummary}

Agent: ${input.agentId || "personal"}`;

  const analysisStartMs = Date.now();
  let llmResponse: string;
  try {
    llmResponse = await utilityCall(config, systemPrompt, userPrompt, {
      maxTokens: 1024,
      temperature: 0.1,
    });
  } catch (err) {
    await query(
      "UPDATE qa_chat_analyses SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2",
      [`LLM call failed: ${err}`, analysisId],
    );
    return;
  }
  const analysisLatencyMs = Date.now() - analysisStartMs;

  // Parse LLM response
  let parsed: {
    correctness: number;
    tool_accuracy: number;
    response_quality: number;
    reasoning: string;
    issues: { type: string; severity: string; description: string }[];
    skills_used: string[];
    skills_expected: string[];
  };
  try {
    // Strip markdown fences if present
    const cleaned = llmResponse.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    await query(
      "UPDATE qa_chat_analyses SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2",
      [`Failed to parse LLM response: ${llmResponse.slice(0, 500)}`, analysisId],
    );
    return;
  }

  const qualityScore = (parsed.correctness + parsed.tool_accuracy + parsed.response_quality) / 3;

  // Update analysis row
  await query(
    `UPDATE qa_chat_analyses SET
       quality_score = $1, correctness = $2, tool_accuracy = $3, response_quality = $4,
       reasoning = $5, issues_detected = $6,
       skills_used = $7, skills_expected = $8,
       analysis_latency_ms = $9, status = 'completed', updated_at = NOW()
     WHERE id = $10`,
    [
      qualityScore, parsed.correctness, parsed.tool_accuracy, parsed.response_quality,
      parsed.reasoning, JSON.stringify(parsed.issues || []),
      parsed.skills_used || [], parsed.skills_expected || [],
      analysisLatencyMs, analysisId,
    ],
  );

  // Fetch the completed row for broadcast
  const completed = await query<QAChatAnalysis>(
    "SELECT * FROM qa_chat_analyses WHERE id = $1",
    [analysisId],
  );
  const analysis = completed.rows[0];
  if (analysis) {
    broadcast("qa.chat_analyzed", analysis);
  }

  // Auto-create issue if below threshold
  if (qualityScore < observerConfig.quality_threshold) {
    await autoCreateIssue(analysisId, {
      correctness: parsed.correctness,
      tool_accuracy: parsed.tool_accuracy,
      response_quality: parsed.response_quality,
      reasoning: parsed.reasoning,
    }, parsed.issues || [], broadcast);
  }
}

// ─── Auto-create issue ───

async function autoCreateIssue(
  analysisId: string,
  scores: JudgeScores,
  issues: { type: string; severity: string; description: string }[],
  broadcast: BroadcastFn,
): Promise<void> {
  const avg = (scores.correctness + scores.tool_accuracy + scores.response_quality) / 3;
  const severity = avg < 0.3 ? "critical" : avg < 0.5 ? "high" : avg < 0.7 ? "medium" : "low";

  const issueDescriptions = issues.map(i => `- [${i.severity}] ${i.type}: ${i.description}`).join("\n");
  const description = `**Auto-detected by Live Observer**\n\n**Quality Score**: ${(avg * 100).toFixed(1)}%\n**Reasoning**: ${scores.reasoning}\n\n**Issues**:\n${issueDescriptions || "Score below threshold"}`;

  const title = issues.length > 0
    ? `Live Observer: ${issues[0].type} — ${issues[0].description.slice(0, 60)}`
    : `Live Observer: Low quality score (${(avg * 100).toFixed(1)}%)`;

  const result = await query<{ id: string }>(
    `INSERT INTO qa_issues (title, description, severity, category, status, tags, evidence)
     VALUES ($1, $2, $3, 'quality', 'open', $4, $5)
     RETURNING id`,
    [
      title.slice(0, 200),
      description,
      severity,
      JSON.stringify(["live-observer"]),
      JSON.stringify([{ analysis_id: analysisId, scores, issues }]),
    ],
  );

  if (result.rows[0]) {
    broadcast("qa.issue_created", { id: result.rows[0].id, title, severity, source: "live-observer" });
  }
}

// ─── Query functions ───

interface AnalysisFilters {
  agentId?: string;
  status?: string;
  minScore?: number;
  maxScore?: number;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export async function getAnalyses(filters: AnalysisFilters = {}): Promise<QAChatAnalysis[]> {
  const conditions: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  if (filters.agentId) { conditions.push(`agent_id = $${idx++}`); vals.push(filters.agentId); }
  if (filters.status) { conditions.push(`status = $${idx++}`); vals.push(filters.status); }
  if (filters.minScore !== undefined) { conditions.push(`quality_score >= $${idx++}`); vals.push(filters.minScore); }
  if (filters.maxScore !== undefined) { conditions.push(`quality_score <= $${idx++}`); vals.push(filters.maxScore); }
  if (filters.since) { conditions.push(`created_at >= $${idx++}`); vals.push(filters.since); }
  if (filters.until) { conditions.push(`created_at <= $${idx++}`); vals.push(filters.until); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit || 50, 200);
  const offset = filters.offset || 0;

  const result = await query<QAChatAnalysis>(
    `SELECT * FROM qa_chat_analyses ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
    [...vals, limit, offset],
  );
  return result.rows;
}

export async function getAnalysisById(id: string): Promise<QAChatAnalysis | null> {
  const result = await query<QAChatAnalysis>("SELECT * FROM qa_chat_analyses WHERE id = $1", [id]);
  return result.rows[0] || null;
}

export async function getAnalysisStats(days = 7): Promise<QAChatAnalysisStats> {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [totals, byAgent, byDay, issuesToday] = await Promise.all([
    query<{ total: number; avg_quality: number | null }>(
      `SELECT count(*)::int AS total, avg(quality_score) AS avg_quality
       FROM qa_chat_analyses WHERE status = 'completed' AND created_at >= $1`,
      [since],
    ),
    query<{ agent_id: string; count: number; avg_quality: number }>(
      `SELECT agent_id, count(*)::int AS count, avg(quality_score) AS avg_quality
       FROM qa_chat_analyses WHERE status = 'completed' AND created_at >= $1
       GROUP BY agent_id ORDER BY count DESC`,
      [since],
    ),
    query<{ date: string; count: number; avg_quality: number; issues: number }>(
      `SELECT created_at::date::text AS date, count(*)::int AS count, avg(quality_score) AS avg_quality,
              count(*) FILTER (WHERE quality_score < 0.4)::int AS issues
       FROM qa_chat_analyses WHERE status = 'completed' AND created_at >= $1
       GROUP BY created_at::date ORDER BY date DESC`,
      [since],
    ),
    query<{ count: number }>(
      `SELECT count(*)::int AS count FROM qa_issues
       WHERE 'live-observer' = ANY(tags) AND created_at >= CURRENT_DATE`,
    ),
  ]);

  return {
    total_analyzed: totals.rows[0]?.total || 0,
    avg_quality_score: totals.rows[0]?.avg_quality ?? null,
    issues_created_today: issuesToday.rows[0]?.count || 0,
    by_agent: byAgent.rows.map(r => ({ agent_id: r.agent_id || "unknown", count: r.count, avg_quality: r.avg_quality })),
    by_day: byDay.rows,
  };
}
