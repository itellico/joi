// Quality Center — Test Runner
// Executes test suites by calling runAgent() and capturing tool interactions

import { query } from "../db/client.js";
import { runAgent, ensureConversation } from "../agent/runtime.js";
import { evaluateResponse, runRuleChecks, evaluateTurn, runTurnRuleChecks, evaluateConversationFlow } from "./evaluator.js";
import type { JoiConfig } from "../config/schema.js";
import type {
  QATestSuite,
  QATestCase,
  QATestRun,
  QATestResult,
  CapturedToolInteraction,
  JudgeScores,
  TurnResult,
} from "./types.js";

export interface RunTestSuiteOptions {
  modelOverrides?: Record<string, unknown>;
  triggeredBy?: string;
  broadcast?: (type: string, data: unknown) => void;
}

export async function runTestSuite(
  suiteId: string,
  config: JoiConfig,
  options: RunTestSuiteOptions = {},
): Promise<QATestRun> {
  const { triggeredBy = "manual", broadcast } = options;

  // Load suite and cases
  const suiteResult = await query<QATestSuite>(
    "SELECT * FROM qa_test_suites WHERE id = $1",
    [suiteId],
  );
  if (suiteResult.rows.length === 0) throw new Error(`Suite not found: ${suiteId}`);
  const suite = suiteResult.rows[0];

  const casesResult = await query<QATestCase>(
    "SELECT * FROM qa_test_cases WHERE suite_id = $1 AND enabled = true ORDER BY sort_order, created_at",
    [suiteId],
  );
  const testCases = casesResult.rows;

  if (testCases.length === 0) throw new Error(`No enabled test cases in suite: ${suite.name}`);

  // Create test run
  const runResult = await query<QATestRun>(
    `INSERT INTO qa_test_runs (suite_id, status, triggered_by, model_config, total_cases)
     VALUES ($1, 'running', $2, $3, $4)
     RETURNING *`,
    [suiteId, triggeredBy, JSON.stringify(options.modelOverrides || {}), testCases.length],
  );
  const run = runResult.rows[0];

  broadcast?.("qa.run_started", { runId: run.id, suiteId, suiteName: suite.name, totalCases: testCases.length });

  let passed = 0;
  let failed = 0;
  let errored = 0;
  let totalLatency = 0;
  let totalCost = 0;
  const allScores: JudgeScores[] = [];

  // Execute each test case sequentially
  for (const testCase of testCases) {
    try {
      const result = await runTestCase(run.id, testCase, suite, config, options);

      if (result.status === "passed") passed++;
      else if (result.status === "failed") failed++;
      else if (result.status === "errored") errored++;

      if (result.latency_ms) totalLatency += result.latency_ms;
      totalCost += result.cost_usd;
      if (result.judge_scores) allScores.push(result.judge_scores);

      broadcast?.("qa.case_result", {
        runId: run.id,
        caseId: testCase.id,
        caseName: testCase.name,
        status: result.status,
        judgeScores: result.judge_scores,
        failureReasons: result.failure_reasons,
        latencyMs: result.latency_ms,
      });
    } catch (err) {
      errored++;
      console.error(`[QA] Error executing case "${testCase.name}":`, err);

      // Save error result
      await query(
        `INSERT INTO qa_test_results (run_id, case_id, status, failure_reasons)
         VALUES ($1, $2, 'errored', $3)`,
        [run.id, testCase.id, JSON.stringify([err instanceof Error ? err.message : String(err)])],
      );

      broadcast?.("qa.case_result", {
        runId: run.id,
        caseId: testCase.id,
        caseName: testCase.name,
        status: "errored",
        failureReasons: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  // Compute averages
  const avgCorrectness = allScores.length > 0
    ? allScores.reduce((s, sc) => s + sc.correctness, 0) / allScores.length : null;
  const avgToolAccuracy = allScores.length > 0
    ? allScores.reduce((s, sc) => s + sc.tool_accuracy, 0) / allScores.length : null;
  const avgResponseQuality = allScores.length > 0
    ? allScores.reduce((s, sc) => s + sc.response_quality, 0) / allScores.length : null;

  // Update run record
  const finalStatus = errored > 0 && passed === 0 && failed === 0 ? "failed" : "completed";
  const updatedRun = await query<QATestRun>(
    `UPDATE qa_test_runs SET
       status = $1, passed = $2, failed = $3, errored = $4,
       avg_correctness = $5, avg_tool_accuracy = $6, avg_response_quality = $7,
       total_latency_ms = $8, total_cost_usd = $9, completed_at = NOW()
     WHERE id = $10
     RETURNING *`,
    [finalStatus, passed, failed, errored, avgCorrectness, avgToolAccuracy, avgResponseQuality, totalLatency, totalCost, run.id],
  );

  broadcast?.("qa.run_completed", {
    runId: run.id,
    suiteId,
    suiteName: suite.name,
    status: finalStatus,
    passed,
    failed,
    errored,
    avgCorrectness,
    avgToolAccuracy,
    avgResponseQuality,
    totalCost,
  });

  return updatedRun.rows[0];
}

async function runTestCase(
  runId: string,
  testCase: QATestCase,
  suite: QATestSuite,
  config: JoiConfig,
  options: RunTestSuiteOptions,
): Promise<QATestResult> {
  // Branch: multi-turn vs single-turn
  if (testCase.turns && testCase.turns.length > 0) {
    return runMultiTurnTestCase(runId, testCase, suite, config, options);
  }

  return runSingleTurnTestCase(runId, testCase, suite, config, options);
}

async function runSingleTurnTestCase(
  runId: string,
  testCase: QATestCase,
  suite: QATestSuite,
  config: JoiConfig,
  options: RunTestSuiteOptions,
): Promise<QATestResult> {
  // Create isolated conversation tagged as QA test
  const conversationId = await ensureConversation(undefined, suite.agent_id, {
    source: "qa-test",
    suiteId: suite.id,
    caseId: testCase.id,
    runId,
  });

  // Capture tool interactions
  const capturedTools: CapturedToolInteraction[] = [];
  const pendingTools = new Map<string, CapturedToolInteraction>();

  // Insert running result row
  const resultRow = await query<QATestResult>(
    `INSERT INTO qa_test_results (run_id, case_id, status, conversation_id)
     VALUES ($1, $2, 'running', $3)
     RETURNING *`,
    [runId, testCase.id, conversationId],
  );
  const resultId = resultRow.rows[0].id;

  const startTime = Date.now();

  // Run agent
  const agentResult = await runAgent({
    conversationId,
    agentId: suite.agent_id,
    userMessage: testCase.input_message,
    config,
    model: (options.modelOverrides as Record<string, string>)?.model,
    onToolUse: (name: string, input: unknown, id: string) => {
      const interaction: CapturedToolInteraction = { name, input, id };
      pendingTools.set(id, interaction);
      capturedTools.push(interaction);
    },
    onToolResult: (id: string, result: unknown) => {
      const pending = pendingTools.get(id);
      if (pending) {
        pending.result = result;
        pendingTools.delete(id);
      }
    },
  });

  const latencyMs = Date.now() - startTime;
  const actualContent = agentResult.content;

  // Run rule-based checks
  const ruleChecks = runRuleChecks(testCase, actualContent, capturedTools, latencyMs);

  // Run LLM judge evaluation
  const judgeScores = await evaluateResponse(config, testCase, actualContent, capturedTools);

  // Determine pass/fail
  const failureReasons: string[] = [...ruleChecks.details];
  const avgScore = (judgeScores.correctness + judgeScores.tool_accuracy + judgeScores.response_quality) / 3;

  if (avgScore < testCase.min_quality_score) {
    failureReasons.push(`Average quality score ${avgScore.toFixed(2)} below minimum ${testCase.min_quality_score}`);
  }

  const allRulesPass = ruleChecks.tools_ok && ruleChecks.patterns_ok && ruleChecks.latency_ok;
  const status = failureReasons.length === 0 && allRulesPass ? "passed" : "failed";

  // Update result row
  const updated = await query<QATestResult>(
    `UPDATE qa_test_results SET
       status = $1, actual_content = $2, actual_tools = $3,
       judge_scores = $4, rule_checks = $5, failure_reasons = $6,
       latency_ms = $7, cost_usd = $8, model = $9, provider = $10
     WHERE id = $11
     RETURNING *`,
    [
      status,
      actualContent,
      JSON.stringify(capturedTools),
      JSON.stringify(judgeScores),
      JSON.stringify(ruleChecks),
      JSON.stringify(failureReasons),
      latencyMs,
      agentResult.costUsd,
      agentResult.model,
      agentResult.provider,
      resultId,
    ],
  );

  // ─── Cleanup ───
  await cleanupTestConversation(conversationId);

  return updated.rows[0];
}

async function runMultiTurnTestCase(
  runId: string,
  testCase: QATestCase,
  suite: QATestSuite,
  config: JoiConfig,
  options: RunTestSuiteOptions,
): Promise<QATestResult> {
  const turns = testCase.turns!;

  // Create a single conversation — all turns share it (builds up history naturally)
  const conversationId = await ensureConversation(undefined, suite.agent_id, {
    source: "qa-test",
    suiteId: suite.id,
    caseId: testCase.id,
    runId,
    multiTurn: true,
    turnCount: turns.length,
  });

  // Insert running result row
  const resultRow = await query<QATestResult>(
    `INSERT INTO qa_test_results (run_id, case_id, status, conversation_id)
     VALUES ($1, $2, 'running', $3)
     RETURNING *`,
    [runId, testCase.id, conversationId],
  );
  const resultId = resultRow.rows[0].id;

  const turnResults: TurnResult[] = [];
  const allCapturedTools: CapturedToolInteraction[] = [];
  const failureReasons: string[] = [];
  let totalLatency = 0;
  let totalCost = 0;
  let lastModel: string | null = null;
  let lastProvider: string | null = null;

  // Execute each turn sequentially against the same conversation
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const turnCapturedTools: CapturedToolInteraction[] = [];
    const pendingTools = new Map<string, CapturedToolInteraction>();

    const turnStart = Date.now();

    const agentResult = await runAgent({
      conversationId,
      agentId: suite.agent_id,
      userMessage: turn.message,
      config,
      model: (options.modelOverrides as Record<string, string>)?.model,
      onToolUse: (name: string, input: unknown, id: string) => {
        const interaction: CapturedToolInteraction = { name, input, id };
        pendingTools.set(id, interaction);
        turnCapturedTools.push(interaction);
        allCapturedTools.push(interaction);
      },
      onToolResult: (id: string, result: unknown) => {
        const pending = pendingTools.get(id);
        if (pending) {
          pending.result = result;
          pendingTools.delete(id);
        }
      },
    });

    const turnLatency = Date.now() - turnStart;
    totalLatency += turnLatency;
    totalCost += agentResult.costUsd;
    lastModel = agentResult.model;
    lastProvider = agentResult.provider;

    // Per-turn rule checks
    const turnRuleChecks = runTurnRuleChecks(turn, agentResult.content, turnCapturedTools, turnLatency);

    // Per-turn LLM judge
    const turnJudgeScores = await evaluateTurn(config, turn, agentResult.content, turnCapturedTools, i);

    // Collect per-turn failures
    for (const detail of turnRuleChecks.details) {
      failureReasons.push(`Turn ${i + 1}: ${detail}`);
    }

    turnResults.push({
      turn_index: i,
      actual_content: agentResult.content,
      actual_tools: turnCapturedTools,
      judge_scores: turnJudgeScores,
      rule_checks: turnRuleChecks,
      latency_ms: turnLatency,
      model: agentResult.model,
    });
  }

  // Cross-turn flow coherence evaluation
  const flowResult = await evaluateConversationFlow(config, turns, turnResults);

  // Aggregate scores across turns
  const turnScores = turnResults
    .map((tr) => tr.judge_scores)
    .filter((s): s is JudgeScores => s !== null);

  const avgCorrectness = turnScores.length > 0
    ? turnScores.reduce((s, sc) => s + sc.correctness, 0) / turnScores.length : 0;
  const avgToolAccuracy = turnScores.length > 0
    ? turnScores.reduce((s, sc) => s + sc.tool_accuracy, 0) / turnScores.length : 0;
  const avgResponseQuality = turnScores.length > 0
    ? turnScores.reduce((s, sc) => s + sc.response_quality, 0) / turnScores.length : 0;

  const overallAvg = (avgCorrectness + avgToolAccuracy + avgResponseQuality) / 3;

  if (overallAvg < testCase.min_quality_score) {
    failureReasons.push(`Average quality score ${overallAvg.toFixed(2)} below minimum ${testCase.min_quality_score}`);
  }

  if (flowResult.flow_coherence_score < 0.5) {
    failureReasons.push(`Flow coherence score ${flowResult.flow_coherence_score.toFixed(2)} below 0.5`);
  }

  // Aggregate rule checks
  const allTurnRulesPass = turnResults.every(
    (tr) => tr.rule_checks?.tools_ok !== false && tr.rule_checks?.patterns_ok !== false,
  );

  const status = failureReasons.length === 0 && allTurnRulesPass ? "passed" : "failed";

  // Build aggregated judge scores
  const aggregatedScores: JudgeScores = {
    correctness: avgCorrectness,
    tool_accuracy: avgToolAccuracy,
    response_quality: avgResponseQuality,
    reasoning: `Aggregated across ${turns.length} turns. Flow coherence: ${flowResult.flow_coherence_score.toFixed(2)}`,
  };

  // Last turn's content as the "actual_content" for display
  const lastTurnContent = turnResults[turnResults.length - 1]?.actual_content || "";

  const updated = await query<QATestResult>(
    `UPDATE qa_test_results SET
       status = $1, actual_content = $2, actual_tools = $3,
       judge_scores = $4, rule_checks = $5, failure_reasons = $6,
       latency_ms = $7, cost_usd = $8, model = $9, provider = $10,
       turn_results = $11, flow_coherence_score = $12, flow_reasoning = $13
     WHERE id = $14
     RETURNING *`,
    [
      status,
      lastTurnContent,
      JSON.stringify(allCapturedTools),
      JSON.stringify(aggregatedScores),
      JSON.stringify({ tools_ok: allTurnRulesPass, patterns_ok: allTurnRulesPass, latency_ok: true, details: failureReasons }),
      JSON.stringify(failureReasons),
      totalLatency,
      totalCost,
      lastModel,
      lastProvider,
      JSON.stringify(turnResults),
      flowResult.flow_coherence_score,
      flowResult.reasoning,
      resultId,
    ],
  );

  // ─── Cleanup ───
  await cleanupTestConversation(conversationId);

  return updated.rows[0];
}

async function cleanupTestConversation(conversationId: string): Promise<void> {
  // Delete memories created during this test conversation
  await query(
    `DELETE FROM memories WHERE conversation_id = $1`,
    [conversationId],
  ).catch(() => {}); // Table column may not exist — best-effort

  // Delete messages from the QA conversation (keep conversation row for audit trail)
  await query(
    `DELETE FROM messages WHERE conversation_id = $1`,
    [conversationId],
  ).catch(() => {});

  // Mark conversation as QA-completed so it's excluded from session lists
  await query(
    `UPDATE conversations SET metadata = metadata || '{"qa_completed": true}'::jsonb WHERE id = $1`,
    [conversationId],
  ).catch(() => {});
}
