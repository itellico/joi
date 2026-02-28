// Quality Center — Type definitions

export interface QATestSuite {
  id: string;
  name: string;
  description: string | null;
  agent_id: string;
  config: Record<string, unknown>;
  tags: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface TurnDefinition {
  role: "user";
  message: string;
  expected_tools?: string[];
  unexpected_tools?: string[];
  expected_content_patterns?: string[];
  description?: string;
}

export interface TurnResult {
  turn_index: number;
  actual_content: string;
  actual_tools: CapturedToolInteraction[];
  judge_scores: JudgeScores | null;
  rule_checks: RuleCheckResult | null;
  latency_ms: number;
  model: string | null;
}

export interface QATestCase {
  id: string;
  suite_id: string;
  name: string;
  description: string | null;
  input_message: string;
  expected_tools: string[];
  unexpected_tools: string[];
  expected_content_patterns: string[];
  max_latency_ms: number | null;
  min_quality_score: number;
  enabled: boolean;
  sort_order: number;
  // Multi-turn fields
  turns: TurnDefinition[] | null;
  turn_count: number;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface QATestRun {
  id: string;
  suite_id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  triggered_by: string;
  model_config: Record<string, unknown>;
  total_cases: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  avg_correctness: number | null;
  avg_tool_accuracy: number | null;
  avg_response_quality: number | null;
  total_latency_ms: number | null;
  total_cost_usd: number;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface QATestResult {
  id: string;
  run_id: string;
  case_id: string;
  status: "running" | "passed" | "failed" | "errored" | "skipped";
  actual_content: string | null;
  actual_tools: CapturedToolInteraction[];
  judge_scores: JudgeScores | null;
  rule_checks: RuleCheckResult | null;
  failure_reasons: string[];
  latency_ms: number | null;
  cost_usd: number;
  model: string | null;
  provider: string | null;
  conversation_id: string | null;
  // Multi-turn fields
  turn_results: TurnResult[] | null;
  flow_coherence_score: number | null;
  flow_reasoning: string | null;
  created_at: string;
}

export interface JudgeScores {
  correctness: number;
  tool_accuracy: number;
  response_quality: number;
  reasoning: string;
}

export interface RuleCheckResult {
  tools_ok: boolean;
  patterns_ok: boolean;
  latency_ok: boolean;
  details: string[];
}

export interface CapturedToolInteraction {
  name: string;
  input: unknown;
  result?: unknown;
  id: string;
}

export interface QAIssue {
  id: string;
  title: string;
  description: string | null;
  severity: "critical" | "high" | "medium" | "low";
  category: "regression" | "quality" | "latency" | "cost" | "tool_error" | "prompt";
  status: "open" | "investigating" | "autodev_assigned" | "fixed" | "verified" | "closed";
  test_case_id: string | null;
  test_run_id: string | null;
  test_result_id: string | null;
  autodev_task_id: string | null;
  evidence: unknown[];
  resolution_notes: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface QAPromptVersion {
  id: string;
  agent_id: string;
  version: number;
  system_prompt: string;
  status: "draft" | "testing" | "active" | "retired";
  parent_version_id: string | null;
  test_run_id: string | null;
  baseline_run_id: string | null;
  scores: JudgeScores | null;
  change_summary: string | null;
  review_queue_id: string | null;
  created_at: string;
  updated_at: string;
}

// Aggregated stats for dashboard
export interface QAStats {
  total_suites: number;
  total_cases: number;
  total_runs: number;
  last_run: QATestRun | null;
  pass_rate: number | null;
  open_issues: number;
  critical_issues: number;
}

// ─── Live Observer Types ───

export interface QAChatAnalysis {
  id: string;
  conversation_id: string | null;
  message_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  user_message: string | null;
  assistant_content: string | null;
  tool_calls: unknown[];
  tool_results: unknown[];
  quality_score: number | null;
  correctness: number | null;
  tool_accuracy: number | null;
  response_quality: number | null;
  reasoning: string | null;
  issues_detected: { type: string; severity: string; description: string }[];
  skills_used: string[];
  skills_expected: string[];
  latency_ms: number | null;
  cost_usd: number | null;
  analysis_cost_usd: number | null;
  analysis_latency_ms: number | null;
  model: string | null;
  provider: string | null;
  status: "pending" | "analyzing" | "completed" | "skipped" | "error";
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface QAObserverConfig {
  enabled: boolean;
  quality_threshold: number;
  skip_dry_run: boolean;
  min_user_message_length: number;
  updated_at: string;
}

export interface QAChatAnalysisStats {
  total_analyzed: number;
  avg_quality_score: number | null;
  issues_created_today: number;
  by_agent: { agent_id: string; count: number; avg_quality: number }[];
  by_day: { date: string; count: number; avg_quality: number; issues: number }[];
}
