// Quality Center — LLM-as-Judge evaluator
// Uses utilityCall() (cheapest model) to score agent responses on 3 dimensions

import { utilityCall } from "../agent/model-router.js";
import type { JoiConfig } from "../config/schema.js";
import type { JudgeScores, QATestCase, CapturedToolInteraction } from "./types.js";

const JUDGE_SYSTEM_PROMPT = `You are a QA judge evaluating an AI assistant's response to a test case.
Score the response on three dimensions from 0.0 to 1.0:

1. **correctness** — Did the assistant answer the question correctly and helpfully?
2. **tool_accuracy** — Did it use the right tools with appropriate parameters? (1.0 if no tools expected and none used)
3. **response_quality** — Is the response natural, well-formatted, and appropriately concise?

Return ONLY valid JSON (no markdown, no code fences):
{"correctness": 0.0, "tool_accuracy": 0.0, "response_quality": 0.0, "reasoning": "brief explanation"}`;

export async function evaluateResponse(
  config: JoiConfig,
  testCase: QATestCase,
  actualContent: string,
  actualTools: CapturedToolInteraction[],
): Promise<JudgeScores> {
  const toolsSummary = actualTools.length > 0
    ? actualTools.map((t) => `- ${t.name}(${JSON.stringify(t.input).slice(0, 200)})`).join("\n")
    : "(no tools used)";

  const userPrompt = `## Test Case
**Name**: ${testCase.name}
**Input**: "${testCase.input_message}"
**Expected tools**: ${testCase.expected_tools.length > 0 ? testCase.expected_tools.join(", ") : "none"}
**Unexpected tools**: ${testCase.unexpected_tools.length > 0 ? testCase.unexpected_tools.join(", ") : "none"}
**Content patterns expected**: ${testCase.expected_content_patterns.length > 0 ? testCase.expected_content_patterns.join(", ") : "none"}

## Actual Response
**Content**: ${actualContent.slice(0, 1500)}

**Tools used**:
${toolsSummary}

Score this response.`;

  try {
    const raw = await utilityCall(config, JUDGE_SYSTEM_PROMPT, userPrompt, {
      maxTokens: 300,
      temperature: 0.1,
      task: "utility",
    });

    // Parse JSON from response — handle potential markdown fences
    const jsonStr = raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(jsonStr);

    return {
      correctness: clamp(parsed.correctness ?? 0),
      tool_accuracy: clamp(parsed.tool_accuracy ?? 0),
      response_quality: clamp(parsed.response_quality ?? 0),
      reasoning: String(parsed.reasoning || ""),
    };
  } catch (err) {
    console.error("[QA] Judge evaluation failed:", err);
    return {
      correctness: 0,
      tool_accuracy: 0,
      response_quality: 0,
      reasoning: `Judge error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

// Rule-based checks (deterministic, no LLM needed)
export function runRuleChecks(
  testCase: QATestCase,
  actualContent: string,
  actualTools: CapturedToolInteraction[],
  latencyMs: number,
): { tools_ok: boolean; patterns_ok: boolean; latency_ok: boolean; details: string[] } {
  const details: string[] = [];
  const usedToolNames = actualTools.map((t) => t.name);

  // Check expected tools are present
  let tools_ok = true;
  for (const expected of testCase.expected_tools) {
    if (!usedToolNames.includes(expected)) {
      tools_ok = false;
      details.push(`Missing expected tool: ${expected}`);
    }
  }

  // Check unexpected tools are absent
  for (const unexpected of testCase.unexpected_tools) {
    if (usedToolNames.includes(unexpected)) {
      tools_ok = false;
      details.push(`Unexpected tool used: ${unexpected}`);
    }
  }

  // Check content patterns (regex)
  let patterns_ok = true;
  for (const pattern of testCase.expected_content_patterns) {
    try {
      const regex = new RegExp(pattern, "i");
      if (!regex.test(actualContent)) {
        patterns_ok = false;
        details.push(`Content pattern not matched: /${pattern}/i`);
      }
    } catch {
      details.push(`Invalid regex pattern: ${pattern}`);
    }
  }

  // Check latency
  let latency_ok = true;
  if (testCase.max_latency_ms && latencyMs > testCase.max_latency_ms) {
    latency_ok = false;
    details.push(`Latency ${latencyMs}ms exceeds max ${testCase.max_latency_ms}ms`);
  }

  return { tools_ok, patterns_ok, latency_ok, details };
}
