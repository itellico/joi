import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { loadConfig, saveConfig } from "./config/loader.js";
import {
  frame, parseFrame,
  type ChatSendData, type PtySpawnData, type PtyInputData, type PtyResizeData, type PtyKillData,
} from "./protocol.js";
import {
  spawnSession, writeInput, resizeSession, killSession,
  listSessions, addListener, addExitListener, getScrollback, killAllSessions,
} from "./pty/manager.js";
import { runAgent, saveMessage, ensureConversation, type AgentRunResult } from "./agent/runtime.js";
import { routeIntent, MEDIA_INTENT_KEYWORDS, type RouteDecision } from "./agent/intent-router.js";
import { runClaudeCode } from "./agent/claude-code.js";
import { query, recordSuccess, recordFailure, reloadFromEnv } from "./db/client.js";
import { checkOllama, pullModel, embed } from "./knowledge/embeddings.js";
import { AVAILABLE_MODELS, resetClients, getOllamaUrl, utilityCall, resolveModel } from "./agent/model-router.js";
// Cost calculation is now handled inside runtime.ts (totalCostUsd)
import { checkOllamaModel, pullOllamaLLMModel } from "./agent/ollama-llm.js";
import { listMemories } from "./knowledge/writer.js";
import { runConsolidation, type ConsolidationReport } from "./knowledge/consolidator.js";
import { fullSync, startWatching, stopWatching, isSyncActive } from "./knowledge/obsidian-sync.js";
import { ingestDocument } from "./knowledge/ingest.js";
import { startScheduler, stopScheduler, listJobs, createJob, updateJob, toggleJob, deleteJob, executeJobNow, listJobRuns } from "./cron/scheduler.js";
import { runSelfRepair } from "./cron/self-repair.js";
import { searchMemories } from "./knowledge/searcher.js";
import { log as writeLog, getRecentLogs, queryLogs, pruneLogs, setLogBroadcast } from "./logging.js";
import { getActiveTasks, getProjects, getTags, getAreas, getCompletedTasks, getCompletedTasksByProject, createTask, completeTask, uncompleteTask, updateTask, moveTask, duplicateTask, createProject, createArea, deleteProject, appendChecklistItems, getProjectHeadings, showInThings, toggleChecklistItem, deleteChecklistItem, deleteTask, getAllHeadingsForProjects, type ThingsList } from "./things/client.js";
import { createOutlineWebhookRouter } from "./sync/outline-webhook.js";
import { fullOutlineSync, scanObsidianToOutline, getSyncStatus, getConflicts, resolveConflict } from "./sync/outline-sync.js";
import { createMediaWebhookRouter } from "./channels/media-webhooks.js";
import {
  initChannelManager,
  connectChannel,
  disconnectChannel,
  getAllStatuses,
  shutdownAllChannels,
} from "./channels/manager.js";
import { transcribeYouTube, transcribeAudioFile } from "./youtube/transcriber.js";
import { executeTriageActions, handleTriageRejection } from "./channels/triage-actions.js";
import { processFeedback } from "./knowledge/learner.js";
import { applyFactReviewResolution } from "./knowledge/fact-reviews.js";
import { getMem0RuntimeStatus } from "./knowledge/mem0-engine.js";
import { syncToThings3, readThings3Progress } from "./okr/things3-sync.js";
import { configureAPNs, closeAPNs } from "./notifications/apns.js";
import { createPushDispatcher, getNotificationLog, getDeviceCount } from "./notifications/dispatcher.js";
import { generateToken } from "./livekit/token.js";
import { AutoDevProxy } from "./autodev/proxy.js";
import { runTestSuite } from "./quality/runner.js";
import { createIssuesFromRun, listIssues, updateIssue, pushToAutodev, createAutoDevRuntimeIssue } from "./quality/issues.js";
import { generatePromptCandidate, abTestPrompt, submitForReview, activatePromptVersion } from "./quality/optimizer.js";
import type { QATestSuite, QATestCase, QATestRun, QATestResult, QAIssue, QAStats } from "./quality/types.js";
import { getAllHeartbeats, getHeartbeat, createTask as createAgentTask, updateTask as updateAgentTask, listTasks as listAgentTasks } from "./agent/heartbeat.js";
import { getPermissionStates, resetPermission } from "./apple/permission-guard.js";
import {
  ensureAvatarStyleGuide,
  generateAvatarAndStore,
  generateAvatarsForAllAgents,
  saveAvatarStyleGuide,
  type AvatarRenderMode,
} from "./social/avatar-studio.js";
import {
  ensureAgentSoulDocument,
  getGlobalSoulPath,
  readGlobalSoulDocument,
  writeAgentSoulDocument,
} from "./agent/soul-documents.js";
import {
  getSoulSpecSummary,
  validateSoulDocument,
} from "./agent/soul-spec.js";
import {
  createSoulVersion,
  ensureSoulVersion,
  getActiveSoulVersion,
  getSoulVersionById,
  listSoulVersions,
} from "./agent/soul-versions.js";
import { SOUL_ROLLOUT_POLICY } from "./agent/soul-policy.js";
import {
  cancelActiveSoulRolloutForAgent,
  evaluateAllActiveSoulRollouts,
  evaluateSoulRollout,
  getActiveSoulRolloutForAgent,
  getSoulGovernanceSummary,
  getSoulRollout,
  listSoulRollouts,
  promoteSoulRollout,
  rollbackSoulRollout,
  startSoulRollout,
  type SoulRollout,
  type SoulRolloutStatus,
} from "./agent/soul-rollouts.js";
import {
  listExternalSkillCatalog,
  mapRegistryRowsToCatalog,
  resolveSkillPathByName,
  summarizeSkillCatalog,
  type RegistrySkillRow,
} from "./skills/catalog.js";

const config = loadConfig();

const TOOL_ANNOUNCEMENT_CACHE = new Map<string, string>();
const TOOL_ANNOUNCEMENT_RULES: Array<{ pattern: RegExp; phrase: string }> = [
  { pattern: /(calendar|event|schedule)/i, phrase: "checking your calendar" },
  { pattern: /(gmail|email|inbox|mail)/i, phrase: "checking your inbox" },
  { pattern: /(weather|forecast)/i, phrase: "checking the weather" },
  { pattern: /(memory|knowledge|search|lookup|find)/i, phrase: "looking that up" },
  { pattern: /(contact|person|people)/i, phrase: "checking that contact" },
  { pattern: /(task|todo|things|okr)/i, phrase: "checking your task list" },
  { pattern: /(channel_send|whatsapp|telegram|imessage|slack|discord|sms|message)/i, phrase: "preparing that message" },
  { pattern: /(notion)/i, phrase: "checking Notion" },
  { pattern: /(emby|jellyseerr|movie|series|watchlist)/i, phrase: "checking your media library" },
  { pattern: /(code|autodev|terminal|shell|command|git)/i, phrase: "running that task" },
];
const VOICE_TOOL_FILLER_INITIAL_DELAY_MS = Math.max(
  200,
  Number.parseInt(process.env.JOI_VOICE_TOOL_FILLER_DELAY_MS || "900", 10) || 900,
);
const VOICE_TOOL_FILLER_PROGRESS_DELAY_MS = Math.max(
  1200,
  Number.parseInt(process.env.JOI_VOICE_TOOL_FILLER_PROGRESS_DELAY_MS || "4200", 10) || 4200,
);
const VOICE_TOOL_FILLER_LONG_DELAY_MS = Math.max(
  2500,
  Number.parseInt(process.env.JOI_VOICE_TOOL_FILLER_LONG_DELAY_MS || "8000", 10) || 8000,
);
const VOICE_TOOL_FILLER_STAGE_DELAYS_MS = [
  VOICE_TOOL_FILLER_INITIAL_DELAY_MS,
  VOICE_TOOL_FILLER_PROGRESS_DELAY_MS,
  VOICE_TOOL_FILLER_LONG_DELAY_MS,
];
const VOICE_PRE_TOOL_PROGRESS_DELAY_MS = Math.max(
  300,
  Number.parseInt(process.env.JOI_VOICE_PRE_TOOL_PROGRESS_DELAY_MS || "1200", 10) || 1200,
);
const VOICE_PRE_TOOL_LONG_DELAY_MS = Math.max(
  1500,
  Number.parseInt(process.env.JOI_VOICE_PRE_TOOL_LONG_DELAY_MS || "5200", 10) || 5200,
);

type VoiceToolFillerRule = {
  pattern: RegExp;
  startVariants: string[];
  progressVariants?: string[];
  longVariants?: string[];
};

const VOICE_TOOL_FILLER_RULES: VoiceToolFillerRule[] = [
  {
    pattern: /(calendar|event|schedule)/i,
    startVariants: [
      "Give me a second while I check your calendar.",
      "One moment, I am pulling your calendar details.",
      "Let me quickly check your schedule.",
      "Checking your calendar now.",
    ],
    progressVariants: [
      "Still on it. I am checking cached calendar context and verifying the latest updates.",
      "This is taking a bit longer. I am still comparing your calendar details.",
      "I am still working on your schedule and validating the timing now.",
    ],
    longVariants: [
      "This calendar check is taking longer than usual, but I am still on it.",
      "Thanks for waiting. I am still finishing your schedule check.",
    ],
  },
  {
    pattern: /(gmail|email|inbox|mail)/i,
    startVariants: [
      "One moment while I check your inbox.",
      "Let me pull your latest emails.",
      "Checking your inbox now.",
      "Give me a second to review your emails.",
    ],
    progressVariants: [
      "Still on it. I am checking cached inbox context first, then pulling fresh messages.",
      "This is taking a bit longer. I am still reviewing your latest emails.",
      "I am still working through your inbox updates now.",
    ],
    longVariants: [
      "This inbox check is taking longer than usual, but I am still working on it.",
      "Still on it. I am finishing the email scan now.",
    ],
  },
  {
    pattern: /(task|todo|things|okr)/i,
    startVariants: [
      "One moment while I check your tasks.",
      "Let me pull your task list.",
      "Checking your tasks now.",
      "Give me a second to review your tasks.",
    ],
    progressVariants: [
      "Still on it. I am checking cached task context and syncing the latest items.",
      "This is taking a bit longer. I am still verifying your task details.",
      "I am still working through your task list now.",
    ],
    longVariants: [
      "This task check is taking longer than usual, but I am still working on it.",
      "Thanks for waiting. I am still finalizing your task update.",
    ],
  },
  {
    pattern: /(contact|person|people)/i,
    startVariants: [
      "One moment while I look that contact up.",
      "Let me check your contacts.",
      "Checking your contacts now.",
      "Give me a second to find that person.",
    ],
    progressVariants: [
      "Still on it. I am checking cached contact context and validating the latest details.",
      "This is taking a bit longer. I am still searching for the right contact.",
      "I am still working on that contact lookup.",
    ],
    longVariants: [
      "This contact lookup is taking longer than usual, but I am still on it.",
      "Thanks for waiting. I am still narrowing down the contact details.",
    ],
  },
  {
    pattern: /(search|lookup|find|memory|knowledge)/i,
    startVariants: [
      "Give me a second while I look up {hint}.",
      "Let me search that for you.",
      "I am checking that now.",
      "One moment while I pull that up.",
    ],
    progressVariants: [
      "Still on it. I am checking cached context for {hint} and then refreshing with live data.",
      "This is taking a bit longer. I am still validating details for {hint}.",
      "I am still working on that lookup and cross-checking context now.",
    ],
    longVariants: [
      "This lookup is taking longer than usual, but I am still working on {hint}.",
      "Thanks for waiting. I am still finishing the lookup for {hint}.",
    ],
  },
  {
    pattern: /(channel_send|whatsapp|telegram|imessage|sms|message)/i,
    startVariants: [
      "One moment while I prepare that message.",
      "Let me set that message up.",
      "I am preparing that message now.",
      "Give me a second to handle that message.",
    ],
    progressVariants: [
      "Still on it. I am drafting and checking context before sending.",
      "This is taking a bit longer. I am still preparing that message carefully.",
      "I am still working on the message and validating details now.",
    ],
    longVariants: [
      "Message prep is taking longer than usual, but I am still on it.",
      "Thanks for waiting. I am still finalizing the message.",
    ],
  },
  {
    pattern: /(code|autodev|terminal|shell|command|git)/i,
    startVariants: [
      "One moment while I run that.",
      "Let me execute that now.",
      "I am running that for you.",
      "Give me a second to process that command.",
    ],
    progressVariants: [
      "Still on it. I am running the command and checking intermediate results.",
      "This is taking a bit longer. I am still executing that task.",
      "I am still working on that run and validating output.",
    ],
    longVariants: [
      "This run is taking longer than usual, but I am still on it.",
      "Thanks for waiting. I am still finishing that command sequence.",
    ],
  },
];
const VOICE_TOOL_FILLER_START_FALLBACK = [
  "One moment while I handle {hint}.",
  "Give me a second, I am on it.",
  "Working on that now.",
  "Let me pull that up for you.",
];
const VOICE_TOOL_FILLER_PROGRESS_FALLBACK = [
  "Still on it. I am checking cached context where possible and refreshing the rest now.",
  "This is taking a bit longer, but I am still working on {hint}.",
  "I am still working on that and validating details before I answer.",
];
const VOICE_TOOL_FILLER_LONG_FALLBACK = [
  "This is taking longer than usual, but I am still working on it.",
  "Thanks for waiting. I am still on it and will answer as soon as it is ready.",
  "Still working on {hint}. I am finishing the last step now.",
];

function pickSeededVariant(seed: string, variants: string[]): string {
  if (variants.length === 0) return "";
  const digest = crypto.createHash("sha1").update(seed).digest("hex");
  const value = Number.parseInt(digest.slice(0, 8), 16);
  const idx = Number.isFinite(value) ? value % variants.length : 0;
  return variants[idx];
}

function getVoiceIntentLabel(message: string): string {
  const text = message.toLowerCase();
  if (/(task|todo|things|okr)/.test(text)) return "task";
  if (/(email|inbox|mail|gmail)/.test(text)) return "inbox";
  if (/(calendar|schedule|event)/.test(text)) return "calendar";
  if (/(contact|person|people)/.test(text)) return "contact";
  if (/(weather|forecast)/.test(text)) return "weather";
  if (/(message|whatsapp|telegram|imessage|sms)/.test(text)) return "message";
  if (/(memory|knowledge|search|lookup|find)/.test(text)) return "lookup";
  return "request";
}

function getPreToolProgressFiller(message: string, stage: 0 | 1): string {
  const label = getVoiceIntentLabel(message);
  const earlyVariants = [
    `On it, I am preparing your ${label} check now.`,
    `Working on your ${label} request now.`,
    `I am starting your ${label} lookup now.`,
  ];
  const longVariants = [
    `Still working on your ${label} request. I am checking cached context first, then refreshing live data.`,
    `This is taking a bit longer. I am still processing your ${label} request now.`,
    `Thanks for waiting. I am still working on your ${label} check.`,
  ];
  return pickSeededVariant(
    `${message.trim().toLowerCase()}:pretool:${stage}`,
    stage === 0 ? earlyVariants : longVariants,
  );
}

function getVoiceToolInputHint(toolInput: unknown): string | null {
  const hintKeys = [
    "query",
    "q",
    "search",
    "term",
    "name",
    "title",
    "contact",
    "person",
    "subject",
    "topic",
    "collection",
    "event",
    "location",
    "city",
  ] as const;
  for (const key of hintKeys) {
    const value = firstStringField(toolInput, key);
    if (value) {
      const compact = value.replace(/\s+/g, " ").trim();
      if (compact.length <= 48) return compact;
      return `${compact.slice(0, 45).trimEnd()}...`;
    }
  }
  return null;
}

function renderVoiceToolFillerTemplate(template: string, hint: string | null): string {
  const subject = hint ? `"${hint}"` : "that";
  return template.replace(/\{hint\}/g, subject).replace(/\s+/g, " ").trim();
}

function getDelayedVoiceToolFiller(toolName: string, toolInput: unknown, toolUseId: string, stage: number): string {
  const key = (toolName || "tool").trim().toLowerCase();
  const rule = VOICE_TOOL_FILLER_RULES.find((r) => r.pattern.test(key));
  const variants = stage <= 0
    ? (rule?.startVariants ?? VOICE_TOOL_FILLER_START_FALLBACK)
    : stage === 1
      ? (rule?.progressVariants ?? VOICE_TOOL_FILLER_PROGRESS_FALLBACK)
      : (rule?.longVariants ?? VOICE_TOOL_FILLER_LONG_FALLBACK);
  const hint = getVoiceToolInputHint(toolInput);
  const template = pickSeededVariant(`${toolUseId}:${key}:stage:${stage}`, variants);
  return renderVoiceToolFillerTemplate(template, hint);
}

// Voice-specific tool intent gate. Keep narrow so small-talk stays fast.
// Media keywords are shared with intent-router to avoid duplication.
const VOICE_TOOL_INTENT_REGEX = /\b(task|todo|things|okr|email|inbox|calendar|event|schedule|contact|weather|forecast|search|find|lookup|check|show|list|open|send|message|whatsapp|telegram|imessage|sms|notion|memory|knowledge)\b/i;
function shouldEnableVoiceTools(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return VOICE_TOOL_INTENT_REGEX.test(trimmed) || MEDIA_INTENT_KEYWORDS.test(trimmed);
}

function firstStringField(input: unknown, key: string): string | null {
  const obj = asRecord(input);
  if (!obj) return null;
  const value = obj[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function getGenericToolAnnouncement(toolName: string): string {
  const key = (toolName || "tool").trim().toLowerCase();
  const cached = TOOL_ANNOUNCEMENT_CACHE.get(key);
  if (cached) return cached;
  const rule = TOOL_ANNOUNCEMENT_RULES.find((r) => r.pattern.test(key));
  const phrase = rule?.phrase ?? "working on that";
  const announcement = `I am ${phrase} now.`;
  TOOL_ANNOUNCEMENT_CACHE.set(key, announcement);
  return announcement;
}

function getToolAnnouncement(toolName: string, toolInput: unknown): string {
  const key = (toolName || "tool").trim().toLowerCase();

  if (key === "store_create_collection") {
    const name = firstStringField(toolInput, "name");
    return name
      ? `I am creating the ${name} collection now.`
      : "I am creating that collection now.";
  }

  if (key === "store_create_object") {
    const collection = firstStringField(toolInput, "collection");
    const title = firstStringField(toolInput, "title");
    if (title && collection) return `I am adding ${title} to ${collection} now.`;
    if (title) return `I am adding ${title} now.`;
    if (collection) return `I am adding that to ${collection} now.`;
    return "I am creating that record now.";
  }

  if (key === "store_update_object") {
    const collection = firstStringField(toolInput, "collection");
    if (collection) return `I am updating that in ${collection} now.`;
    return "I am updating that record now.";
  }

  if (key === "store_query" || key === "store_search") {
    const collection = firstStringField(toolInput, "collection");
    return collection
      ? `I am checking ${collection} now.`
      : "I am checking your stored data now.";
  }

  if (key === "contacts_search") {
    return "I am looking up your contacts now.";
  }

  if (key === "okr_report") {
    return "I am checking your OKRs now.";
  }

  return getGenericToolAnnouncement(key);
}

function getToolPlanStep(toolName: string, toolInput: unknown): string {
  const announcement = getToolAnnouncement(toolName, toolInput);
  const trimmed = announcement
    .replace(/^I am\s+/i, "")
    .replace(/\s+now\.?$/i, "")
    .trim();
  if (!trimmed) return "Work on requested step";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isVerifyFactReview(type: string | null | undefined, proposedAction: unknown): boolean {
  if (type !== "verify") return false;
  const action = asRecord(proposedAction);
  if (!action) return false;
  const kind = typeof action.kind === "string" ? action.kind : "";
  const factId = typeof action.fact_id === "string"
    ? action.fact_id
    : (typeof action.factId === "string" ? action.factId : "");
  return kind === "verify_fact" && factId.trim().length > 0;
}

interface AgentSoulRecord {
  id: string;
  name: string | null;
  description: string | null;
  model: string | null;
  skills: string[] | null;
}

type ReviewResolutionStatus = "approved" | "rejected" | "modified";

interface ParsedSoulUpdateAction {
  kind: "soul_update";
  agentId: string;
  content: string;
  summary: string | null;
  source: string | null;
  author: string | null;
  runQualityGate: boolean;
  qualitySuiteId: string | null;
  metadata: Record<string, unknown> | null;
  baseVersionId: string | null;
  rolloutTrafficPercent: number | null;
  rolloutMinimumSampleSize: number | null;
}

interface SoulQualityGateResult {
  status: "not_run" | "passed" | "failed";
  suiteId: string | null;
  run: QATestRun | null;
  skippedReason: string | null;
}

interface SoulReviewApplyResult {
  applied: boolean;
  agentId: string;
  validation: ReturnType<typeof validateSoulDocument>;
  version: Awaited<ReturnType<typeof createSoulVersion>> | null;
  rollout: SoulRollout | null;
  rolloutMode: "canary" | "direct";
  quality: SoulQualityGateResult;
  action: ParsedSoulUpdateAction;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function parseSoulUpdateAction(value: unknown, fallbackAgentId?: string | null): ParsedSoulUpdateAction | null {
  const action = asRecord(value);
  if (!action) return null;

  const kind = normalizeOptionalString(action.kind) || "soul_update";
  if (kind !== "soul_update") return null;

  const agentId = normalizeOptionalString(action.agentId)
    || normalizeOptionalString(action.agent_id)
    || normalizeOptionalString(action.targetAgentId)
    || normalizeOptionalString(action.target_agent_id)
    || normalizeOptionalString(fallbackAgentId || null);

  const content = normalizeOptionalString(action.content)
    || normalizeOptionalString(action.soul)
    || normalizeOptionalString(action.soulContent)
    || normalizeOptionalString(action.soul_content)
    || normalizeOptionalString(action.newContent)
    || normalizeOptionalString(action.new_content);

  if (!agentId || !content) return null;

  const metadata = asRecord(action.metadata);
  const runQualityGate =
    normalizeOptionalBoolean(action.runQualityGate)
    ?? normalizeOptionalBoolean(action.qualityGate)
    ?? false;

  return {
    kind: "soul_update",
    agentId,
    content,
    summary: normalizeOptionalString(action.summary)
      || normalizeOptionalString(action.changeSummary)
      || normalizeOptionalString(action.change_summary),
    source: normalizeOptionalString(action.source),
    author: normalizeOptionalString(action.author)
      || normalizeOptionalString(action.proposer)
      || normalizeOptionalString(action.proposed_by),
    runQualityGate,
    qualitySuiteId: normalizeOptionalString(action.qualitySuiteId)
      || normalizeOptionalString(action.quality_suite_id)
      || normalizeOptionalString(action.suiteId),
    metadata,
    baseVersionId: normalizeOptionalString(action.baseVersionId)
      || normalizeOptionalString(action.base_version_id)
      || normalizeOptionalString(action.parentVersionId),
    rolloutTrafficPercent:
      normalizeOptionalNumber(action.rolloutTrafficPercent)
      ?? normalizeOptionalNumber(action.rollout_traffic_percent)
      ?? normalizeOptionalNumber(action.canaryTrafficPercent),
    rolloutMinimumSampleSize:
      normalizeOptionalNumber(action.rolloutMinimumSampleSize)
      ?? normalizeOptionalNumber(action.rollout_minimum_sample_size)
      ?? normalizeOptionalNumber(action.canaryMinimumSampleSize),
  };
}

function isSoulUpdateReview(type: string | null | undefined, proposedAction: unknown): boolean {
  if (type !== "soul_update") return false;
  return parseSoulUpdateAction(proposedAction) !== null;
}

async function loadAgentSoulRecord(agentId: string): Promise<AgentSoulRecord | null> {
  const result = await query<AgentSoulRecord>(
    "SELECT id, name, description, model, skills FROM agents WHERE id = $1",
    [agentId],
  );
  return result.rows[0] || null;
}

async function findEnabledQualitySuiteForAgent(agentId: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    `SELECT id
     FROM qa_test_suites
     WHERE agent_id = $1 AND enabled = true
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
    [agentId],
  );
  return result.rows[0]?.id || null;
}

async function runSoulQualityGate(params: {
  agentId: string;
  requestedSuiteId: string | null;
  runQualityGate: boolean;
  triggeredBy: string;
}): Promise<SoulQualityGateResult> {
  if (!params.runQualityGate) {
    return {
      status: "not_run",
      suiteId: null,
      run: null,
      skippedReason: null,
    };
  }

  const suiteId = params.requestedSuiteId || await findEnabledQualitySuiteForAgent(params.agentId);
  if (!suiteId) {
    return {
      status: "not_run",
      suiteId: null,
      run: null,
      skippedReason: `No enabled quality suite found for agent "${params.agentId}".`,
    };
  }

  const suiteResult = await query<{ id: string; agent_id: string; enabled: boolean }>(
    "SELECT id, agent_id, enabled FROM qa_test_suites WHERE id = $1",
    [suiteId],
  );
  const suite = suiteResult.rows[0];
  if (!suite) {
    throw new Error(`Quality suite "${suiteId}" not found.`);
  }
  if (suite.agent_id !== params.agentId) {
    throw new Error(`Quality suite "${suiteId}" does not belong to agent "${params.agentId}".`);
  }
  if (!suite.enabled) {
    throw new Error(`Quality suite "${suiteId}" is disabled.`);
  }

  const run = await runTestSuite(suiteId, config, {
    triggeredBy: params.triggeredBy,
    broadcast: wsBroadcast,
  });

  await createIssuesFromRun(run).catch((err) => {
    console.warn("[Soul] Failed to auto-create QA issues from quality gate run:", err);
  });

  const passed = run.status === "completed" && run.failed === 0 && run.errored === 0;
  return {
    status: passed ? "passed" : "failed",
    suiteId,
    run,
    skippedReason: null,
  };
}

async function applySoulReviewResolution(params: {
  reviewId: string;
  status: ReviewResolutionStatus;
  resolution: unknown;
  proposedAction: unknown;
  resolvedBy: string;
  fallbackAgentId?: string | null;
}): Promise<SoulReviewApplyResult | null> {
  if (params.status === "rejected") return null;

  const action = parseSoulUpdateAction(params.resolution, params.fallbackAgentId)
    || parseSoulUpdateAction(params.proposedAction, params.fallbackAgentId);

  if (!action) {
    throw new Error("Soul review resolution must include a valid soul_update action with agentId and content.");
  }

  const agent = await loadAgentSoulRecord(action.agentId);
  if (!agent) {
    throw new Error(`Agent "${action.agentId}" not found.`);
  }

  const validation = validateSoulDocument(action.content);
  if (!validation.valid) {
    throw new Error(`Soul validation failed: ${validation.issues.join(" ")}`);
  }

  const currentSoul = ensureAgentSoulDocument(agent);
  let activeVersion = await getActiveSoulVersion(agent.id);
  if (!activeVersion) {
    activeVersion = await ensureSoulVersion(agent.id, currentSoul.content);
  }

  const quality = await runSoulQualityGate({
    agentId: agent.id,
    requestedSuiteId: action.qualitySuiteId,
    runQualityGate: action.runQualityGate,
    triggeredBy: `review:soul_update:${params.reviewId}`,
  });

  if (action.runQualityGate && quality.status !== "passed") {
    const qualityMessage = quality.skippedReason
      || `Quality gate failed (failed=${quality.run?.failed ?? 0}, errored=${quality.run?.errored ?? 0}).`;
    throw new Error(qualityMessage);
  }

  const normalizedContent = `${action.content.trim()}\n`;
  const activeContent = activeVersion?.content || "";
  if (activeVersion && activeContent.trim() === normalizedContent.trim()) {
    return {
      applied: true,
      agentId: agent.id,
      validation,
      version: activeVersion,
      rollout: null,
      rolloutMode: "direct",
      quality,
      action,
    };
  }

  const metadata = action.metadata || {};
  const rolloutEnabledOverride = typeof metadata.rolloutEnabled === "boolean"
    ? metadata.rolloutEnabled
    : null;
  const rolloutModeFromMetadata = typeof metadata.rolloutMode === "string"
    ? String(metadata.rolloutMode).trim().toLowerCase()
    : null;
  const shouldCanary = (rolloutEnabledOverride ?? SOUL_ROLLOUT_POLICY.canary.enabledByDefault)
    && rolloutModeFromMetadata !== "direct";

  let rollout: SoulRollout | null = null;
  let version: Awaited<ReturnType<typeof createSoulVersion>>;

  if (shouldCanary) {
    version = await createSoulVersion({
      agentId: agent.id,
      content: normalizedContent,
      source: action.source || "review",
      author: action.author || params.resolvedBy || "human",
      reviewId: params.reviewId,
      qualityRunId: quality.run?.id || null,
      qualityStatus: quality.status,
      changeSummary: action.summary,
      parentVersionId: activeVersion?.id || action.baseVersionId || null,
      metadata: {
        ...metadata,
        appliedVia: "review.resolve",
        runQualityGate: action.runQualityGate,
        qualitySuiteId: quality.suiteId,
        rolloutMode: "canary",
        policyVersion: SOUL_ROLLOUT_POLICY.version,
      },
      activate: false,
    });

    if (!activeVersion?.id) {
      throw new Error(`Cannot start soul rollout for "${agent.id}" without an active baseline version.`);
    }
    rollout = await startSoulRollout({
      agentId: agent.id,
      candidateVersionId: version.id,
      baselineVersionId: activeVersion.id,
      trafficPercent: action.rolloutTrafficPercent ?? SOUL_ROLLOUT_POLICY.canary.defaultTrafficPercent,
      minimumSampleSize: action.rolloutMinimumSampleSize ?? SOUL_ROLLOUT_POLICY.canary.minimumSampleSize,
      metadata: {
        reviewId: params.reviewId,
        source: action.source || "review",
        summary: action.summary || null,
        qualityRunId: quality.run?.id || null,
        qualityStatus: quality.status,
        policyVersion: SOUL_ROLLOUT_POLICY.version,
      },
      decisionReason: "Started from approved soul review",
    });
  } else {
    await cancelActiveSoulRolloutForAgent(agent.id, "Cancelled by direct soul activation");
    const saved = writeAgentSoulDocument(agent.id, normalizedContent);
    version = await createSoulVersion({
      agentId: agent.id,
      content: saved.content,
      source: action.source || "review",
      author: action.author || params.resolvedBy || "human",
      reviewId: params.reviewId,
      qualityRunId: quality.run?.id || null,
      qualityStatus: quality.status,
      changeSummary: action.summary,
      parentVersionId: activeVersion?.id || action.baseVersionId || null,
      metadata: {
        ...metadata,
        appliedVia: "review.resolve",
        runQualityGate: action.runQualityGate,
        qualitySuiteId: quality.suiteId,
        rolloutMode: "direct",
        policyVersion: SOUL_ROLLOUT_POLICY.version,
      },
      activate: true,
    });
  }

  return {
    applied: true,
    agentId: agent.id,
    validation,
    version,
    rollout,
    rolloutMode: shouldCanary ? "canary" : "direct",
    quality,
    action,
  };
}

// Configure APNs if credentials are available
if (config.apns.keyPath && config.apns.keyId && config.apns.teamId) {
  configureAPNs({
    keyPath: config.apns.keyPath,
    keyId: config.apns.keyId,
    teamId: config.apns.teamId,
    bundleId: config.apns.bundleId,
    production: config.apns.production,
  });
}
const app = express();
const server = http.createServer(app);

// CORS for React dev server
app.use(cors({ origin: config.gateway.corsOrigins }));
app.use(express.json());

// ─── Access Logging Middleware ───
app.use((req, res, next) => {
  // Skip health checks and WS upgrades (too noisy)
  if (req.path === "/health" || req.headers.upgrade === "websocket") {
    return next();
  }
  const start = Date.now();
  res.on("finish", () => {
    writeLog("access", `${req.method} ${req.path} ${res.statusCode}`, {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: Date.now() - start,
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      authenticated: !!req.headers.authorization,
    });
  });
  next();
});

// ─── Auth Middleware (Bearer Token) ───
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const secret = config.gateway.secret;
  if (!secret) return next(); // No secret configured = open (dev mode)

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);
  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  next();
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw.split(",")[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}

function isLocalHostname(hostname: string): boolean {
  const lower = hostname.trim().toLowerCase();
  return lower === "localhost"
    || lower === "127.0.0.1"
    || lower === "::1"
    || lower === "0.0.0.0"
    || lower === "::";
}

function normalizeWebhookBaseUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (isLocalHostname(parsed.hostname)) return null;
  return `${parsed.protocol}//${parsed.host}`;
}

function isPrivateIpv4(address: string): boolean {
  if (address.startsWith("10.")) return true;
  if (address.startsWith("192.168.")) return true;
  const match = address.match(/^172\.(\d{1,2})\./);
  if (!match) return false;
  const second = Number(match[1]);
  return Number.isFinite(second) && second >= 16 && second <= 31;
}

function isCarrierGradeNatIpv4(address: string): boolean {
  const match = address.match(/^100\.(\d{1,3})\./);
  if (!match) return false;
  const second = Number(match[1]);
  return Number.isFinite(second) && second >= 64 && second <= 127;
}

function isTunnelInterface(name: string): boolean {
  return /^(utun|tun|tap)/i.test(name);
}

function interfacePriority(name: string): number {
  if (/^en\d+$/i.test(name)) return 0;      // macOS physical interfaces (Wi-Fi/Ethernet)
  if (/^eth\d+$/i.test(name)) return 1;
  if (/^(wlan|wl)\d*/i.test(name)) return 1;
  if (isTunnelInterface(name)) return 2;
  if (/^bridge/i.test(name)) return 5;
  return 3;
}

function addressPriority(address: string, interfaceName: string): number {
  // Prefer Tailscale/overlay addresses on tunnel interfaces for road mode.
  if (isCarrierGradeNatIpv4(address) && isTunnelInterface(interfaceName)) return 0;
  if (address.startsWith("192.168.")) return 1;
  if (address.startsWith("10.")) return 2;
  if (isPrivateIpv4(address)) return 3;
  if (isCarrierGradeNatIpv4(address)) return 5;
  return 4;
}

function getLanIpv4Candidates(): string[] {
  const results: Array<{ name: string; address: string }> = [];
  const interfaces = os.networkInterfaces();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (!entry) continue;
      if (entry.family !== "IPv4") continue;
      if (entry.internal) continue;
      if (!entry.address) continue;
      results.push({ name, address: entry.address });
    }
  }

  results.sort((a, b) => {
    const addrDiff = addressPriority(a.address, a.name) - addressPriority(b.address, b.name);
    if (addrDiff !== 0) return addrDiff;

    const ifaceDiff = interfacePriority(a.name) - interfacePriority(b.name);
    if (ifaceDiff !== 0) return ifaceDiff;

    const nameDiff = a.name.localeCompare(b.name);
    if (nameDiff !== 0) return nameDiff;

    return a.address.localeCompare(b.address);
  });

  const deduped: string[] = [];
  for (const row of results) {
    if (deduped.includes(row.address)) continue;
    deduped.push(row.address);
  }
  return deduped;
}

function resolveWebhookBase(req: express.Request): {
  webhookBaseUrl: string | null;
  source: string | null;
  candidates: Array<{ source: string; url: string }>;
} {
  const candidates: Array<{ source: string; url: string }> = [];
  const pushCandidate = (source: string, rawUrl: string | undefined | null) => {
    const normalized = normalizeWebhookBaseUrl(rawUrl || undefined);
    if (!normalized) return;
    if (candidates.some((c) => c.url === normalized)) return;
    candidates.push({ source, url: normalized });
  };

  const requestProto = firstHeaderValue(req.headers["x-forwarded-proto"]) || req.protocol || "http";
  const requestHost = firstHeaderValue(req.headers["x-forwarded-host"]) || req.headers.host || "";
  const requestBaseRaw = requestHost ? `${requestProto}://${requestHost}` : undefined;

  let requestIsLocal = true;
  if (requestBaseRaw) {
    try {
      const parsed = new URL(requestBaseRaw);
      requestIsLocal = isLocalHostname(parsed.hostname);
    } catch {
      requestIsLocal = true;
    }
  }

  if (!requestIsLocal) {
    pushCandidate("request", requestBaseRaw);
    pushCandidate("config.publicUrl", config.gateway.publicUrl);
  } else {
    for (const ip of getLanIpv4Candidates()) {
      pushCandidate("lan-ip", `http://${ip}:${config.gateway.port}`);
    }
    const host = config.gateway.host;
    if (host && !isLocalHostname(host)) {
      pushCandidate("config.host", `http://${host}:${config.gateway.port}`);
    }
    pushCandidate("config.publicUrl", config.gateway.publicUrl);
  }

  const first = candidates[0] || null;
  return {
    webhookBaseUrl: first?.url || null,
    source: first?.source || null,
    candidates,
  };
}

// Health check (no auth required)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// DB-aware health check (no auth) — used by watchdog to detect poisoned pools
app.get("/health/db", async (_req, res) => {
  try {
    const result = await Promise.race([
      query("SELECT 1 as ok"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    if (result.rows.length > 0) {
      recordSuccess();
      res.json({ status: "ok" });
    } else {
      await recordFailure();
      res.status(503).json({ status: "error", detail: "no rows" });
    }
  } catch (err) {
    await recordFailure();
    res.status(503).json({ status: "error", detail: err instanceof Error ? err.message : String(err) });
  }
});

// Outline webhook has its own signature verification (no Bearer auth)
// (registered below at /api/webhooks/outline)

// Apply auth to all /api/* routes EXCEPT webhooks
app.use("/api", (req, res, next) => {
  // Webhook paths are exempt — they do per-channel secret validation
  if (req.path.startsWith("/webhooks/")) return next();
  requireAuth(req, res, next);
});

// ─── LiveKit Voice Endpoints ───

// List available voices from the configured TTS provider
app.get("/api/livekit/voices", async (req, res) => {
  const provider = (req.query.provider as string) || config.livekit.ttsProvider;
  const language = req.query.language as string | undefined;
  const gender = req.query.gender as string | undefined;

  try {
    if (provider === "cartesia") {
      const apiKey = config.livekit.cartesiaApiKey;
      if (!apiKey) return res.status(400).json({ error: "Cartesia API key not configured" });

      const params = new URLSearchParams({ limit: "100" });
      if (gender) params.set("gender", gender);

      const response = await fetch(`https://api.cartesia.ai/voices?${params}`, {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Cartesia-Version": "2024-11-13",
        },
      });
      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: `Cartesia API error: ${errText}` });
      }
      const data = await response.json() as { data?: Array<{ id: string; name: string; description: string; language: string; gender: string | null }>; voices?: Array<{ id: string; name: string; description: string; language: string; gender: string | null }> };
      let voices = data.data || data.voices || [];

      // Filter by language if specified
      if (language) {
        voices = voices.filter((v: { language: string }) => v.language === language || v.language?.startsWith(language));
      }

      res.json({
        provider: "cartesia",
        voices: voices.map((v: { id: string; name: string; description: string; language: string; gender: string | null }) => ({
          id: v.id,
          name: v.name,
          description: v.description || "",
          language: v.language || "en",
          gender: v.gender || "unknown",
        })),
      });
    } else if (provider === "elevenlabs") {
      const apiKey = config.auth.elevenlabsApiKey;
      if (!apiKey) return res.status(400).json({ error: "ElevenLabs API key not configured" });

      const response = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": apiKey },
      });
      if (!response.ok) {
        return res.status(response.status).json({ error: "ElevenLabs API error" });
      }
      const data = await response.json() as { voices: Array<{ voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string; description?: string }> };

      res.json({
        provider: "elevenlabs",
        voices: (data.voices || []).map((v: { voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string; description?: string }) => ({
          id: v.voice_id,
          name: v.name,
          description: v.description || "",
          language: v.labels?.language || "en",
          gender: v.labels?.gender || "unknown",
          previewUrl: v.preview_url || null,
        })),
      });
    } else {
      res.json({ provider, voices: [] });
    }
  } catch (err) {
    console.error("Failed to list voices:", err);
    res.status(500).json({ error: "Failed to fetch voices" });
  }
});

// Generate a short voice preview
app.post("/api/livekit/voices/preview", async (req, res) => {
  const { voiceId, text, provider: reqProvider, language: reqLanguage } = req.body;
  const provider = reqProvider || config.livekit.ttsProvider;
  const rules = config.livekit.pronunciations ?? [];

  // Build default preview text that naturally includes pronunciation words
  let defaultText = "Hello! I'm JOI, your personal AI assistant. How can I help you today?";
  if (rules.length > 0) {
    // Include all pronunciation words in a natural sentence
    const examples = rules.map((r) => r.word);
    if (examples.length === 1) {
      defaultText = `Hello! I'm ${examples[0]}, your personal AI assistant. Let me know how I can help you today.`;
    } else {
      defaultText = `Hello! This is ${examples[0]}. Let me say a few words: ${examples.join(", ")}. How can I help you today?`;
    }
  }

  // Apply pronunciation replacements to the text so TTS says the words correctly
  let previewText = text || defaultText;
  for (const rule of rules) {
    const regex = new RegExp(`\\b${rule.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    previewText = previewText.replace(regex, rule.replacement);
  }

  try {
    if (provider === "cartesia") {
      const apiKey = config.livekit.cartesiaApiKey;
      if (!apiKey) return res.status(400).json({ error: "Cartesia API key not configured" });

      const response = await fetch("https://api.cartesia.ai/tts/bytes", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Cartesia-Version": "2024-11-13",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_id: config.livekit.ttsModel || "sonic-2",
          transcript: previewText,
          voice: { mode: "id", id: voiceId },
          output_format: { container: "mp3", bit_rate: 128000, sample_rate: 44100 },
          language: reqLanguage || "en",
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: `Cartesia TTS error: ${errText}` });
      }

      const audioBuffer = await response.arrayBuffer();
      res.set("Content-Type", "audio/mpeg");
      res.send(Buffer.from(audioBuffer));
    } else if (provider === "elevenlabs") {
      const apiKey = config.auth.elevenlabsApiKey;
      if (!apiKey) return res.status(400).json({ error: "ElevenLabs API key not configured" });

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: previewText,
          model_id: "eleven_multilingual_v2",
        }),
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: "ElevenLabs TTS error" });
      }

      const audioBuffer = await response.arrayBuffer();
      res.set("Content-Type", "audio/mpeg");
      res.send(Buffer.from(audioBuffer));
    } else {
      res.status(400).json({ error: `Preview not supported for provider: ${provider}` });
    }
  } catch (err) {
    console.error("Voice preview failed:", err);
    res.status(500).json({ error: "Failed to generate preview" });
  }
});

// ─── LiveKit Config Endpoint ───
app.get("/api/livekit/config", (_req, res) => {
  const lk = config.livekit;
  res.json({
    url: lk.url || "",
    sttProvider: lk.sttProvider,
    sttModel: lk.sttModel,
    ttsProvider: lk.ttsProvider,
    ttsModel: lk.ttsModel,
    ttsVoice: lk.ttsVoice || "",
    hasDeepgramKey: !!lk.deepgramApiKey,
    hasCartesiaKey: !!lk.cartesiaApiKey,
    hasApiKey: !!lk.apiKey,
    hasApiSecret: !!lk.apiSecret,
    pronunciations: lk.pronunciations ?? [],
    voicePrompt: lk.voicePrompt ?? "",
    voiceModel: lk.voiceModel,
    voiceHistoryLimit: lk.voiceHistoryLimit,
    voiceEnableTools: lk.voiceEnableTools,
    voiceIncludeMemory: lk.voiceIncludeMemory,
    voiceMinEndpointSec: lk.voiceMinEndpointSec,
    voiceMaxEndpointSec: lk.voiceMaxEndpointSec,
    ttsCacheEnabled: lk.ttsCacheEnabled,
    ttsCacheLocalMaxItems: lk.ttsCacheLocalMaxItems,
    ttsCacheLocalMaxBytes: lk.ttsCacheLocalMaxBytes,
    ttsCacheMaxTextChars: lk.ttsCacheMaxTextChars,
    ttsCacheMaxAudioBytes: lk.ttsCacheMaxAudioBytes,
    ttsCacheRedisTtlSec: lk.ttsCacheRedisTtlSec,
    ttsCachePrefix: lk.ttsCachePrefix,
    ttsCacheRedisUrl: lk.ttsCacheRedisUrl || "",
    hasTtsCacheRedisUrl: !!lk.ttsCacheRedisUrl,
  });
});

// ─── LiveKit Token Endpoint ───
app.post("/api/livekit/token", async (req, res) => {
  try {
    const agentId = req.body.agentId || "personal";
    const conversationId = await ensureConversation(req.body.conversationId, agentId);
    const result = await generateToken(config.livekit, {
      participantName: req.body.participantName,
      conversationId,
      agentId,
    });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Token generation failed";
    res.status(500).json({ error: msg });
  }
});

// ─── Voice Chat SSE Endpoint (for Python LiveKit worker) ───
app.post("/api/voice/chat", async (req, res) => {
  try {
    const { conversationId, agentId, message, voicePromptSuffix } = req.body;
    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders?.();

    const convId = await ensureConversation(conversationId, agentId || "personal");
    const voiceModel = config.livekit.voiceModel || process.env.JOI_VOICE_MODEL || "openai/gpt-4o-mini";
    const voiceHistoryLimitRaw = Number.parseInt(
      String(config.livekit.voiceHistoryLimit ?? process.env.JOI_VOICE_HISTORY_LIMIT ?? "8"),
      10,
    );
    const voiceHistoryLimit = Number.isFinite(voiceHistoryLimitRaw)
      ? Math.min(50, Math.max(2, voiceHistoryLimitRaw))
      : 8;
    const voiceToolsEnabled = config.livekit.voiceEnableTools ?? (process.env.JOI_VOICE_ENABLE_TOOLS === "1");
    const voiceMemoryEnabled = config.livekit.voiceIncludeMemory ?? (process.env.JOI_VOICE_INCLUDE_MEMORY === "1");
    const hasToolIntent = shouldEnableVoiceTools(String(message || ""));
    const effectiveVoiceToolsEnabled = voiceToolsEnabled && hasToolIntent;
    const effectiveVoiceMemoryEnabled = voiceMemoryEnabled && hasToolIntent;
    const effectiveVoiceHistoryLimit = hasToolIntent
      ? voiceHistoryLimit
      : Math.max(2, Math.min(4, voiceHistoryLimit));
    const voiceExecutionGuardSuffix = [
      "Voice execution rules:",
      "- For requests about personal data or status (contacts, tasks, calendar, inbox, messages, weather, memory, knowledge), call the relevant tools before giving a factual answer.",
      "- Never claim you are checking, searching, or working on something unless a tool call is actually being executed in this turn.",
      "- If tool execution is unavailable or fails, say exactly what is blocked instead of implying completion.",
      "- Keep progress updates short, factual, and natural.",
    ].join("\n");
    const effectiveVoicePromptSuffix = [voicePromptSuffix, voiceExecutionGuardSuffix]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join("\n\n");
    const stripVoiceTags = (text: string) =>
      text.replace(/\[(?:[a-z][a-z0-9_-]{0,20})\]\s*/gi, "");
    const voiceStartMs = Date.now();
    const emittedToolUseIds = new Set<string>();
    type VoiceToolFillerState = {
      toolName: string;
      toolInput: unknown;
      stage: number;
      timer?: NodeJS.Timeout;
    };
    const pendingVoiceToolFillers = new Map<string, VoiceToolFillerState>();
    let voiceClosed = false;
    let preToolActivityStarted = false;
    let preToolProgressTimer: NodeJS.Timeout | null = null;
    let preToolLongTimer: NodeJS.Timeout | null = null;
    const clearPreToolProgressTimers = () => {
      if (preToolProgressTimer) clearTimeout(preToolProgressTimer);
      if (preToolLongTimer) clearTimeout(preToolLongTimer);
      preToolProgressTimer = null;
      preToolLongTimer = null;
    };
    const markPreToolActivityStarted = () => {
      if (preToolActivityStarted) return;
      preToolActivityStarted = true;
      clearPreToolProgressTimers();
    };
    const clearPendingVoiceToolFillers = () => {
      for (const state of pendingVoiceToolFillers.values()) {
        if (state.timer) clearTimeout(state.timer);
      }
      pendingVoiceToolFillers.clear();
    };
    const emitVoiceStreamDelta = (delta: string) => {
      if (voiceClosed) return;
      const cleanDelta = stripVoiceTags(delta);
      if (!cleanDelta) return;
      res.write(`data: ${JSON.stringify({ type: "stream", delta: cleanDelta })}\n\n`);
      wsBroadcast("chat.stream", {
        conversationId: convId,
        delta: cleanDelta,
      });
    };
    req.on("close", () => {
      voiceClosed = true;
      clearPreToolProgressTimers();
      clearPendingVoiceToolFillers();
    });
    if (hasToolIntent) {
      preToolProgressTimer = setTimeout(() => {
        if (voiceClosed || preToolActivityStarted) return;
        emitVoiceStreamDelta(`${getPreToolProgressFiller(String(message || ""), 0)} `);
      }, VOICE_PRE_TOOL_PROGRESS_DELAY_MS);
      preToolLongTimer = setTimeout(() => {
        if (voiceClosed || preToolActivityStarted) return;
        emitVoiceStreamDelta(`${getPreToolProgressFiller(String(message || ""), 1)} `);
      }, VOICE_PRE_TOOL_LONG_DELAY_MS);
    }
    const scheduleVoiceToolFiller = (toolUseId: string) => {
      const state = pendingVoiceToolFillers.get(toolUseId);
      if (!state || voiceClosed) return;
      const delayMs = VOICE_TOOL_FILLER_STAGE_DELAYS_MS[state.stage];
      if (!Number.isFinite(delayMs) || delayMs <= 0) {
        pendingVoiceToolFillers.delete(toolUseId);
        return;
      }
      state.timer = setTimeout(() => {
        const current = pendingVoiceToolFillers.get(toolUseId);
        if (!current || voiceClosed) return;
        const filler = getDelayedVoiceToolFiller(current.toolName, current.toolInput, toolUseId, current.stage);
        if (filler) emitVoiceStreamDelta(`${filler} `);
        const nextStage = current.stage + 1;
        if (nextStage >= VOICE_TOOL_FILLER_STAGE_DELAYS_MS.length) {
          pendingVoiceToolFillers.delete(toolUseId);
          return;
        }
        current.stage = nextStage;
        pendingVoiceToolFillers.set(toolUseId, current);
        scheduleVoiceToolFiller(toolUseId);
      }, delayMs);
      pendingVoiceToolFillers.set(toolUseId, state);
    };

    // Intent routing for voice path
    let effectiveVoiceAgentId = agentId || "personal";
    let voiceRouteDecision: RouteDecision | null = null;
    const voiceRouteResult = await routeIntent(String(message || ""), effectiveVoiceAgentId);
    if (voiceRouteResult.routed) {
      voiceRouteDecision = voiceRouteResult;
      effectiveVoiceAgentId = voiceRouteResult.agentId;
      console.log(`[voice/chat] Intent router: ${agentId || "personal"} → ${effectiveVoiceAgentId} (reason=${voiceRouteResult.reason})`);
    }

    console.log(
      `[voice/chat] conv=${convId} agent=${effectiveVoiceAgentId} model=${voiceModel} tools=${effectiveVoiceToolsEnabled} memory=${effectiveVoiceMemoryEnabled} history=${effectiveVoiceHistoryLimit} tool_intent=${hasToolIntent}`,
    );

    // Emit chat.routed event over WS if intent router selected a different agent
    const voiceAgentVisibility = process.env.JOI_AGENT_VISIBILITY === "1";
    if (voiceRouteDecision && voiceAgentVisibility) {
      wsBroadcast("chat.routed", {
        conversationId: convId,
        agentId: voiceRouteDecision.agentId,
        agentName: voiceRouteDecision.agentName,
        reason: voiceRouteDecision.reason,
        confidence: voiceRouteDecision.confidence,
        matchedPattern: voiceRouteDecision.matchedPattern,
      });
    }

    const voiceRunOptions: Parameters<typeof runAgent>[0] = {
      conversationId: convId,
      agentId: effectiveVoiceAgentId,
      userMessage: message,
      config,
      model: voiceModel,
      toolTask: "voice",
      chatTask: "voice",
      enableTools: effectiveVoiceToolsEnabled,
      includeSkillsPrompt: false,
      forceToolUse: hasToolIntent,
      historyLimit: effectiveVoiceHistoryLimit,
      includeMemoryContext: effectiveVoiceMemoryEnabled,
      systemPromptSuffix: effectiveVoicePromptSuffix,
      onToolPlan: (toolCalls) => {
        const steps = toolCalls.map((tc) => getToolPlanStep(tc.name, tc.input));
        if (steps.length > 0) {
          wsBroadcast("chat.plan", {
            conversationId: convId,
            steps,
          });
        }
      },
      onStream: (delta: string) => {
        markPreToolActivityStarted();
        emitVoiceStreamDelta(delta);
      },
      onToolUse: (toolName, toolInput, toolUseId) => {
        markPreToolActivityStarted();
        const normalizedToolUseId = toolUseId || crypto.randomUUID();
        if (emittedToolUseIds.has(normalizedToolUseId)) return;
        emittedToolUseIds.add(normalizedToolUseId);
        wsBroadcast("chat.tool_use", {
          conversationId: convId,
          toolName,
          toolInput,
          toolUseId: normalizedToolUseId,
        });
        if (pendingVoiceToolFillers.has(normalizedToolUseId)) return;
        pendingVoiceToolFillers.set(normalizedToolUseId, {
          toolName,
          toolInput,
          stage: 0,
        });
        scheduleVoiceToolFiller(normalizedToolUseId);
      },
      onToolResult: (toolUseId, resultData) => {
        if (toolUseId) {
          const state = pendingVoiceToolFillers.get(toolUseId);
          if (state?.timer) clearTimeout(state.timer);
          pendingVoiceToolFillers.delete(toolUseId);
        }
        wsBroadcast("chat.tool_result", {
          conversationId: convId,
          toolUseId,
          result: resultData,
        });
      },
    };

    // Apply execution profile from voice route if applicable
    if (voiceRouteDecision) {
      const ep = voiceRouteDecision.executionProfile;
      voiceRunOptions.includeMemoryContext = ep.includeMemoryContext;
      voiceRunOptions.historyLimit = Math.min(ep.historyLimit, effectiveVoiceHistoryLimit);
    }

    const result = await runAgent(voiceRunOptions);

    clearPreToolProgressTimers();
    clearPendingVoiceToolFillers();
    const cleanContent = stripVoiceTags(result.content);
    const latencyMs = Date.now() - voiceStartMs;
    wsBroadcast("chat.done", {
      conversationId: convId,
      messageId: result.messageId,
      content: cleanContent,
      model: result.model,
      provider: result.provider,
      toolModel: result.toolModel,
      toolProvider: result.toolProvider,
      usage: result.usage,
      costUsd: result.costUsd,
      latencyMs,
      timings: result.timings,
      ...(voiceAgentVisibility ? {
        agentId: result.agentId,
        agentName: result.agentName || voiceRouteDecision?.agentName,
        routeReason: voiceRouteDecision?.reason,
        routeConfidence: voiceRouteDecision?.confidence,
        delegations: result.delegations,
      } : {}),
    });
    if (!voiceClosed) {
      res.write(`data: ${JSON.stringify({ type: "done", messageId: result.messageId, content: cleanContent, model: result.model, usage: result.usage, costUsd: result.costUsd, latencyMs })}\n\n`);
    }
    voiceClosed = true;
    res.end();
  } catch (err) {
    console.error("[voice/chat] Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Voice chat failed" });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: String(err) })}\n\n`);
      res.end();
    }
  }
});

// ─── Voice Cache Metrics Ingest (from LiveKit worker) ───
app.post("/api/voice/cache-metrics", async (req, res) => {
  try {
    const body = req.body as {
      conversationId?: string;
      messageId?: string;
      agentId?: string;
      provider?: string;
      model?: string;
      voice?: string;
      metrics?: {
        cacheHits?: number;
        cacheMisses?: number;
        cacheHitChars?: number;
        cacheMissChars?: number;
        cacheHitAudioBytes?: number;
        cacheMissAudioBytes?: number;
        segments?: number;
      };
    };

    const conversationId = body.conversationId || null;
    const messageId = body.messageId || null;
    const agentId = body.agentId || null;
    const provider = body.provider || "cartesia";
    const model = body.model || null;
    const voice = body.voice || null;
    const metrics = body.metrics || {};

    const cacheHits = Math.max(0, Number(metrics.cacheHits || 0));
    const cacheMisses = Math.max(0, Number(metrics.cacheMisses || 0));
    const cacheHitChars = Math.max(0, Number(metrics.cacheHitChars || 0));
    const cacheMissChars = Math.max(0, Number(metrics.cacheMissChars || 0));
    const cacheHitAudioBytes = Math.max(0, Number(metrics.cacheHitAudioBytes || 0));
    const cacheMissAudioBytes = Math.max(0, Number(metrics.cacheMissAudioBytes || 0));
    const segments = Math.max(0, Number(metrics.segments || 0));
    const totalSegments = Math.max(segments, cacheHits + cacheMisses);

    if (!conversationId || totalSegments <= 0) {
      res.status(400).json({ error: "conversationId and non-empty metrics are required" });
      return;
    }

    const usagePatch = {
      voiceCache: {
        cacheHits,
        cacheMisses,
        cacheHitChars,
        cacheMissChars,
        cacheHitAudioBytes,
        cacheMissAudioBytes,
        segments: totalSegments,
        hitRate: totalSegments > 0 ? cacheHits / totalSegments : 0,
      },
    };

    if (messageId) {
      await query(
        `UPDATE messages
         SET token_usage = COALESCE(token_usage, '{}'::jsonb) || $2::jsonb
         WHERE id = $1 AND conversation_id = $3`,
        [messageId, JSON.stringify(usagePatch), conversationId],
      );
    } else {
      await query(
        `UPDATE messages
         SET token_usage = COALESCE(token_usage, '{}'::jsonb) || $2::jsonb
         WHERE id = (
           SELECT id FROM messages
           WHERE conversation_id = $1 AND role = 'assistant'
           ORDER BY created_at DESC
           LIMIT 1
         )`,
        [conversationId, JSON.stringify(usagePatch)],
      );
    }

    try {
      await query(
        `INSERT INTO voice_usage_log (provider, service, model, duration_ms, characters, cost_usd, conversation_id, agent_id, metadata)
         VALUES ($1, 'tts_cache', $2, 0, $3, 0, $4, $5, $6::jsonb)`,
        [
          provider,
          model,
          cacheHitChars + cacheMissChars,
          conversationId,
          agentId,
          JSON.stringify({
            voice,
            cache_hits: cacheHits,
            cache_misses: cacheMisses,
            cache_hit_chars: cacheHitChars,
            cache_miss_chars: cacheMissChars,
            cache_hit_audio_bytes: cacheHitAudioBytes,
            cache_miss_audio_bytes: cacheMissAudioBytes,
            segments: totalSegments,
            hit_rate: totalSegments > 0 ? cacheHits / totalSegments : 0,
          }),
        ],
      );
    } catch (err) {
      console.warn("[voice/cache-metrics] failed inserting voice_usage_log:", (err as Error).message);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[voice/cache-metrics] failed:", err);
    res.status(500).json({ error: "Failed to ingest voice cache metrics" });
  }
});

// POST /api/voice/usage — ingest STT/TTS usage metrics from LiveKit worker
app.post("/api/voice/usage", async (req, res) => {
  try {
    const { conversationId, agentId, provider, service, model, durationMs, characters } = req.body;
    if (!provider || !service) {
      res.status(400).json({ error: "provider and service required" });
      return;
    }
    await query(
      `INSERT INTO voice_usage_log (provider, service, model, duration_ms, characters, cost_usd, conversation_id, agent_id)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7)`,
      [
        provider,
        service,
        model || null,
        Math.round(durationMs || 0),
        Math.round(characters || 0),
        conversationId || null,
        agentId || null,
      ],
    );
    res.json({ ok: true });
  } catch (err) {
    console.warn("[voice/usage] insert failed:", (err as Error).message);
    res.status(500).json({ error: "Failed to store voice usage" });
  }
});

// REST API: List conversations
app.get("/api/conversations", async (req, res) => {
  try {
    const typeFilter = req.query.type as string | undefined;
    const includeHandled = req.query.include_handled === "true";
    const limitParam = Math.min(Math.max(parseInt(req.query.limit as string) || 200, 1), 500);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (typeFilter && (typeFilter === "inbox" || typeFilter === "direct")) {
      params.push(typeFilter);
      conditions.push(`c.type = $${params.length}`);
      if (typeFilter === "inbox" && !includeHandled) {
        conditions.push(`COALESCE(c.inbox_status, 'new') != 'handled'`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limitParam);

    const result = await query(
      `SELECT c.id, c.title, c.agent_id, c.updated_at,
              c.type, c.inbox_status, c.contact_id, c.session_key, c.channel_id,
              (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
              (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message
       FROM conversations c
       ${whereClause}
       ORDER BY c.updated_at DESC
       LIMIT $${params.length}`,
      params,
    );
    res.json({ conversations: result.rows });
  } catch (err) {
    console.error("Failed to list conversations:", err);
    res.status(500).json({ error: "Failed to list conversations" });
  }
});

// REST API: Get conversation messages
app.get("/api/conversations/:id/messages", async (req, res) => {
  try {
    const result = await query(
      `SELECT id, role, content, tool_calls, tool_results, model, token_usage, attachments, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [req.params.id],
    );
    // Attach media records to messages that have them
    const messageIds = result.rows.map((m: any) => m.id);
    let mediaByMessage: Record<string, any[]> = {};
    if (messageIds.length > 0) {
      const mediaResult = await query(
        `SELECT id, message_id, media_type, thumbnail_path, storage_path, status, filename, mime_type, size_bytes, width, height
         FROM media
         WHERE message_id = ANY($1) AND status = 'ready'`,
        [messageIds],
      );
      for (const m of mediaResult.rows) {
        if (!mediaByMessage[m.message_id]) mediaByMessage[m.message_id] = [];
        mediaByMessage[m.message_id].push(m);
      }
    }
    const messages = result.rows.map((msg: any) => ({
      ...msg,
      media: mediaByMessage[msg.id] || undefined,
    }));
    res.json({ messages });
  } catch (err) {
    console.error("Failed to load messages:", err);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

// REST API: Delete conversation
app.delete("/api/conversations/:id", async (req, res) => {
  try {
    await query("DELETE FROM messages WHERE conversation_id = $1", [req.params.id]);
    await query("DELETE FROM conversations WHERE id = $1", [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    console.error("Failed to delete conversation:", err);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

// REST API: List agents
app.get("/api/agents", async (_req, res) => {
  try {
    const result = await query(
      "SELECT id, name, description, system_prompt, model, enabled, skills, config FROM agents ORDER BY name",
    );
    res.json({ agents: result.rows });
  } catch (err) {
    console.error("Failed to list agents:", err);
    res.status(500).json({ error: "Failed to list agents" });
  }
});

// REST API: Update agent
app.put("/api/agents/:id", async (req, res) => {
  try {
    const updates: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    let idx = 1;

    for (const field of ["name", "description", "system_prompt", "model"]) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        params.push(req.body[field]);
      }
    }

    if (req.body.enabled !== undefined) {
      updates.push(`enabled = $${idx++}`);
      params.push(req.body.enabled);
    }

    if (req.body.skills !== undefined) {
      updates.push(`skills = $${idx++}`);
      params.push(req.body.skills);
    }

    // JSONB merge for config — partial updates don't clobber existing keys
    if (req.body.config !== undefined) {
      updates.push(`config = COALESCE(config, '{}'::jsonb) || $${idx++}::jsonb`);
      params.push(JSON.stringify(req.body.config));
    }

    if (updates.length <= 1) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    params.push(req.params.id);
    const result = await query(
      `UPDATE agents SET ${updates.join(", ")} WHERE id = $${idx} RETURNING id`,
      params,
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    res.json({ updated: true, id: req.params.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to update agent:", message);
    res.status(500).json({ error: "Failed to update agent" });
  }
});

// REST API: Improve agent system prompt via AI
app.post("/api/agents/:id/improve-prompt", async (req, res) => {
  try {
    const { system_prompt } = req.body;
    if (!system_prompt) {
      res.status(400).json({ error: "system_prompt is required" });
      return;
    }

    // Resolve utility model to show user which model is being used
    const utilityRoute = await resolveModel(config, "utility");

    const improved = await utilityCall(
      config,
      `You are an expert at writing system prompts for AI agents. Your task is to improve the given system prompt while preserving its intent and personality.

Rules:
- Keep the same voice, tone, and purpose
- Make instructions clearer and more specific
- Add structure with markdown headings and bullet points where helpful
- Remove redundancy
- Ensure the prompt is well-organized
- Do NOT add generic filler — every line should be purposeful
- Return ONLY the improved prompt, no explanations or preamble`,
      `Improve this system prompt:\n\n${system_prompt}`,
      { maxTokens: 4096, temperature: 0.5 },
    );

    res.json({ improved, model: utilityRoute.model });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to improve prompt:", message);
    res.status(500).json({ error: "Failed to improve prompt" });
  }
});

// ─── Agent Heartbeat & Task API ───

// ─── macOS Permission Status ───

app.get("/api/system/permissions", (_req, res) => {
  res.json(getPermissionStates());
});

app.post("/api/system/permissions/:resource/reset", (req, res) => {
  const resource = req.params.resource as "contacts" | "messages" | "things";
  if (!["contacts", "messages", "things"].includes(resource)) {
    return res.status(400).json({ error: "Invalid resource" });
  }
  resetPermission(resource);
  res.json({ ok: true, message: `Permission for ${resource} reset — will re-check on next access` });
});

app.get("/api/agents/heartbeats", async (_req, res) => {
  try {
    const heartbeats = await getAllHeartbeats();
    res.json({ heartbeats });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/agents/:id/heartbeat", async (req, res) => {
  try {
    const heartbeat = await getHeartbeat(req.params.id);
    if (!heartbeat) return res.status(404).json({ error: "No heartbeat for agent" });
    res.json(heartbeat);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/agents/tasks", async (req, res) => {
  try {
    const { status, assigned_by, limit } = req.query as Record<string, string>;
    const tasks = await listAgentTasks({
      status: status || undefined,
      assigned_by: assigned_by || undefined,
      limit: parseInt(limit) || 50,
    });
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/agents/:id/tasks", async (req, res) => {
  try {
    const { status, limit } = req.query as Record<string, string>;
    const tasks = await listAgentTasks({
      agent_id: req.params.id,
      status: status || undefined,
      limit: parseInt(limit) || 50,
    });
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/agents/:id/tasks", async (req, res) => {
  try {
    const { title, description, priority, input_data, deadline, assigned_by } = req.body;
    if (!title) return res.status(400).json({ error: "title is required" });
    const task = await createAgentTask({
      agent_id: req.params.id,
      assigned_by: assigned_by || "manual",
      title,
      description,
      priority,
      input_data,
      deadline,
    });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.put("/api/agents/tasks/:taskId", async (req, res) => {
  try {
    const { status, progress, result_data } = req.body;
    const task = await updateAgentTask(req.params.taskId, { status, progress, result_data });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// REST API: Improve skill content via AI
app.post("/api/skills/improve", async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const improved = await utilityCall(
      config,
      `You are an expert at writing SKILL.md files for Claude, Codex, and Gemini skills. Your task is to improve the given skill definition while preserving its intent and capabilities.

Rules:
- Preserve the YAML frontmatter structure (name, description, metadata fields)
- Make instructions clearer and more specific
- Improve trigger patterns for better activation
- Add structure with markdown headings and bullet points where helpful
- Remove redundancy
- Ensure the skill is well-organized and actionable
- Do NOT add generic filler — every line should be purposeful
- Return ONLY the improved SKILL.md content, no explanations or preamble`,
      `Improve this SKILL.md:\n\n${content}`,
      { maxTokens: 4096, temperature: 0.5 },
    );

    res.json({ improved });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to improve skill:", message);
    res.status(500).json({ error: "Failed to improve skill" });
  }
});

// REST API: Dashboard data (legacy compatibility)
app.get("/api/dashboard", (_req, res) => {
  try {
    const projectRoot = path.resolve(process.cwd(), "..");
    const dashboardPath = path.resolve(projectRoot, "legacy/data/dashboard.json");
    if (fs.existsSync(dashboardPath)) {
      const data = JSON.parse(fs.readFileSync(dashboardPath, "utf-8"));
      res.json(data);
    } else {
      res.status(404).json({ error: "Dashboard data not found", path: dashboardPath });
    }
  } catch (err) {
    console.error("Failed to load dashboard:", err);
    res.status(500).json({ error: "Failed to load dashboard data" });
  }
});

// REST API: System status
app.get("/api/status", async (_req, res) => {
  try {
    const dbCheck = await query("SELECT 1 as ok");
    const ollamaStatus = await checkOllama(config);
    res.json({
      status: "ok",
      database: dbCheck.rows.length > 0 ? "connected" : "error",
      ollama: ollamaStatus,
      hasAnthropicKey: !!config.auth.anthropicApiKey,
      hasOpenRouterKey: !!config.auth.openrouterApiKey,
      uptime: process.uptime(),
      version: "0.1.0",
    });
  } catch {
    res.json({
      status: "degraded",
      database: "disconnected",
      uptime: process.uptime(),
      version: "0.1.0",
    });
  }
});

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const WATCHDOG_AUTORESTART_FILE = "/tmp/joi-watchdog.enabled";

function parseWatchdogAutoRestart(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (["1", "true", "yes", "on", "enabled"].includes(value)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(value)) return false;
  return null;
}

function readWatchdogAutoRestartEnabled(): boolean {
  try {
    const raw = fs.readFileSync(WATCHDOG_AUTORESTART_FILE, "utf-8");
    const parsed = parseWatchdogAutoRestart(raw);
    return parsed ?? true;
  } catch {
    return true;
  }
}

function writeWatchdogAutoRestartEnabled(enabled: boolean): void {
  fs.writeFileSync(WATCHDOG_AUTORESTART_FILE, enabled ? "1\n" : "0\n", { encoding: "utf-8" });
}

function isProcessPatternRunning(pattern: string): boolean {
  try {
    execFileSync("pgrep", ["-f", pattern], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function listPidsByPattern(pattern: string): number[] {
  try {
    const raw = execFileSync("pgrep", ["-f", pattern], {
      encoding: "utf-8",
    });
    return raw
      .split(/\s+/)
      .map((entry) => Number(entry))
      .filter((pid) => Number.isFinite(pid) && pid > 0);
  } catch {
    return [];
  }
}

function listPidsByPatterns(patterns: string[]): number[] {
  const seen = new Set<number>();
  for (const pattern of patterns) {
    for (const pid of listPidsByPattern(pattern)) {
      seen.add(pid);
    }
  }
  return Array.from(seen).sort((a, b) => a - b);
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isWatchdogPidRunning(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0 || !isPidRunning(pid)) {
    return false;
  }

  try {
    const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf-8",
    }).trim();
    return /(^|[\\/ ])watchdog\.sh(\s|$)/.test(cmd);
  } catch {
    return false;
  }
}

function readWatchdogPid(): number | null {
  try {
    const raw = fs.readFileSync("/tmp/joi-watchdog.pid", "utf-8").trim();
    const pid = Number(raw);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return isWatchdogPidRunning(pid) ? pid : null;
  } catch {
    return null;
  }
}

type StartableService = "watchdog" | "autodev" | "livekit";

function isServiceRunning(service: StartableService): boolean {
  if (service === "watchdog") {
    return !!readWatchdogPid() || isProcessPatternRunning("scripts/watchdog.sh");
  }
  if (service === "autodev") {
    const adStatus = autoDevProxy.getStatus();
    return !!adStatus.workerConnected
      || isProcessPatternRunning("src/autodev/worker.ts")
      || isProcessPatternRunning("scripts/dev-autodev.sh");
  }
  // livekit
  return isProcessPatternRunning("infra/livekit-worker/run.sh")
    || isProcessPatternRunning("livekit-worker");
}

function startServiceDetached(service: StartableService): {
  ok: boolean;
  started: boolean;
  alreadyRunning: boolean;
  detail: string;
  pid?: number;
} {
  if (isServiceRunning(service)) {
    return {
      ok: true,
      started: false,
      alreadyRunning: true,
      detail: "Already running",
    };
  }

  const scriptByService: Record<StartableService, string> = {
    watchdog: "scripts/watchdog.sh",
    autodev: "scripts/dev-autodev.sh",
    livekit: "scripts/dev-worker.sh",
  };
  const logByService: Record<StartableService, string> = {
    watchdog: "/tmp/joi-watchdog.log",
    autodev: "/tmp/joi-autodev.log",
    livekit: "/tmp/joi-livekit.log",
  };

  const scriptPath = path.join(PROJECT_ROOT, scriptByService[service]);
  if (!fs.existsSync(scriptPath)) {
    return {
      ok: false,
      started: false,
      alreadyRunning: false,
      detail: `Script not found: ${scriptByService[service]}`,
    };
  }

  try {
    const outFd = fs.openSync(logByService[service], "a");
    const child = spawn(scriptPath, [], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: ["ignore", outFd, outFd],
      env: process.env as NodeJS.ProcessEnv,
    });
    if (child.pid) child.unref();
    fs.closeSync(outFd);
    return {
      ok: true,
      started: true,
      alreadyRunning: false,
      detail: `Start requested via ${scriptByService[service]}`,
      pid: child.pid ?? undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      started: false,
      alreadyRunning: false,
      detail: `Failed to start: ${message}`,
    };
  }
}

// Health overview for sidebar indicators
app.get("/api/health", async (_req, res) => {
  const services: Record<string, { status: "green" | "orange" | "red"; detail?: string }> = {};
  const watchdogAutoRestartDefault = readWatchdogAutoRestartEnabled();
  const debug: Record<string, unknown> = {
    capturedAt: new Date().toISOString(),
    gateway: {
      pid: process.pid,
      host: config.gateway.host,
      port: config.gateway.port,
      publicUrl: config.gateway.publicUrl || null,
    },
    runtime: {
      autodevWorkerConnected: false,
      autodevState: "unknown",
      livekitConfigured: false,
    },
    processIds: {
      watchdog: listPidsByPatterns(["scripts/watchdog.sh", "watchdog.sh"]),
      autodev: listPidsByPatterns(["src/autodev/worker.ts", "scripts/dev-autodev.sh"]),
      livekit: listPidsByPatterns(["infra/livekit-worker/run.sh", "livekit-worker"]),
    },
    watchdog: {
      autoRestartEnabled: watchdogAutoRestartDefault,
      pidFilePid: readWatchdogPid(),
      statusFilePresent: false,
      statusFileTimestamp: null,
      statusFileAgeMs: null,
      statusFileServices: null,
    },
    database: {
      ok: false,
      error: null as string | null,
    },
    memory: {
      ok: false,
      ollamaAvailable: false,
      modelLoaded: false,
      ollamaError: null as string | null,
      mem0: null as unknown,
    },
  };

  // Gateway — always green if we're responding
  services.gateway = { status: "green", detail: "HTTP responsive" };

  // Database — 5s cap, auto-reset pool after repeated failures
  try {
    const dbCheck = await Promise.race([
      query("SELECT 1 as ok"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DB timeout")), 5000)),
    ]);
    if (dbCheck.rows.length > 0) {
      recordSuccess();
      services.database = { status: "green", detail: "Connected" };
      (debug.database as Record<string, unknown>).ok = true;
    } else {
      await recordFailure();
      services.database = { status: "red", detail: "No response" };
      (debug.database as Record<string, unknown>).error = "No response";
    }
  } catch (dbErr) {
    await recordFailure();
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    services.database = { status: "red", detail: msg.slice(0, 80) };
    (debug.database as Record<string, unknown>).error = msg;
  }

  // AutoDev worker
  const adStatus = autoDevProxy.getStatus();
  services.autodev = adStatus.workerConnected
    ? { status: "green", detail: adStatus.state }
    : { status: "red", detail: "Worker disconnected" };
  (debug.runtime as Record<string, unknown>).autodevWorkerConnected = adStatus.workerConnected;
  (debug.runtime as Record<string, unknown>).autodevState = adStatus.state;

  // LiveKit
  const lkConfigured = !!(config.livekit.url && config.livekit.apiKey && config.livekit.apiSecret);
  services.livekit = lkConfigured
    ? { status: "orange", detail: "Configured, waiting for worker" }
    : { status: "orange", detail: "Not configured" };
  (debug.runtime as Record<string, unknown>).livekitConfigured = lkConfigured;

  // Web + Watchdog (from watchdog status file)
  try {
    const raw = fs.readFileSync("/tmp/joi-watchdog.json", "utf-8");
    const wd = JSON.parse(raw) as {
      timestamp: string;
      watchdogPid: number;
      autoRestartEnabled?: boolean;
      services: Record<string, { status: string; failures: number; backoff: number }>;
    };
    const autoRestartEnabled = watchdogAutoRestartDefault;
    const ageMs = Date.now() - new Date(wd.timestamp).getTime();
    const fresh = ageMs < 90_000;
    const watchdogDebug = debug.watchdog as Record<string, unknown>;
    watchdogDebug.statusFilePresent = true;
    watchdogDebug.statusFileTimestamp = wd.timestamp;
    watchdogDebug.statusFileAgeMs = ageMs;
    watchdogDebug.statusFileServices = wd.services;
    watchdogDebug.watchdogPid = wd.watchdogPid;

    // Web status from watchdog
    const webSvc = wd.services.web;
    if (webSvc?.status === "healthy" && fresh) {
      services.web = { status: "green", detail: "Serving on :5173" };
    } else if (webSvc && fresh) {
      services.web = webSvc.failures > 0
        ? { status: "red", detail: `Down (${webSvc.failures} failures)` }
        : { status: "orange", detail: "Starting..." };
    } else if (webSvc) {
      services.web = { status: "red", detail: "Status stale" };
    } else {
      services.web = { status: "orange", detail: "Unknown" };
    }

    // Watchdog itself: running + fresh data
    if (isWatchdogPidRunning(wd.watchdogPid) && fresh) {
      services.watchdog = autoRestartEnabled
        ? { status: "green", detail: `PID ${wd.watchdogPid} (auto-restart on)` }
        : { status: "orange", detail: `PID ${wd.watchdogPid} (auto-restart paused)` };
    } else if (fresh) {
      services.watchdog = { status: "orange", detail: "PID gone, data fresh" };
    } else {
      services.watchdog = { status: "red", detail: `Stale (${Math.round(ageMs / 1000)}s ago)` };
    }

    // AutoDev: prefer live WS truth, then watchdog process health fallback.
    const adSvc = wd.services.autodev;
    if (!adStatus.workerConnected && adSvc) {
      if (adSvc.status === "healthy" && fresh) {
        services.autodev = { status: "orange", detail: "Process up, awaiting gateway link" };
      } else if (fresh) {
        services.autodev = adSvc.failures > 0
          ? { status: "red", detail: `Down (${adSvc.failures} failures)` }
          : { status: "orange", detail: "Starting..." };
      } else {
        services.autodev = { status: "red", detail: "Status stale" };
      }
    }

    // LiveKit: use watchdog worker health, not just static config.
    const lkSvc = wd.services.livekit;
    if (lkSvc) {
      if (lkSvc.status === "healthy" && fresh) {
        services.livekit = { status: "green", detail: "Worker healthy" };
      } else if (lkConfigured && fresh) {
        services.livekit = lkSvc.failures > 0
          ? { status: "orange", detail: `Worker down (${lkSvc.failures} failures)` }
          : { status: "orange", detail: "Worker starting..." };
      } else if (lkConfigured) {
        services.livekit = { status: "red", detail: "Worker status stale" };
      }
    }
  } catch {
    services.web = { status: "orange", detail: "Watchdog not running" };
    const mode = watchdogAutoRestartDefault ? "auto-restart on" : "auto-restart paused";
    services.watchdog = { status: "red", detail: `No status file (${mode})` };
  }

  // Memory (Ollama) — hard 3s cap so health endpoint never hangs
  try {
    const ollama = await Promise.race([
      checkOllama(config),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Health check timeout")), 3000)),
    ]);
    const mem0 = getMem0RuntimeStatus(config);
    const memoryDebug = debug.memory as Record<string, unknown>;
    memoryDebug.mem0 = mem0;
    memoryDebug.ollamaUrl = config.memory.ollamaUrl;
    memoryDebug.ollamaAvailable = ollama.available;
    memoryDebug.modelLoaded = ollama.modelLoaded;
    memoryDebug.ollamaError = ollama.error || null;
    if (ollama.available && ollama.modelLoaded) {
      if (!mem0.configured) {
        services.memory = { status: "green", detail: "Ollama ready" };
        memoryDebug.ok = true;
      } else if (mem0.active) {
        services.memory = { status: "green", detail: "Ollama + Mem0 ready" };
        memoryDebug.ok = true;
      } else {
        services.memory = {
          status: "orange",
          detail: `Ollama ready, Mem0 fallback (${mem0.error || "init failed"})`,
        };
      }
    } else if (ollama.available) {
      services.memory = { status: "orange", detail: "Model not loaded" };
    } else {
      services.memory = { status: "red", detail: ollama.error || "Unavailable" };
    }
  } catch {
    services.memory = { status: "red", detail: "Timeout" };
    (debug.memory as Record<string, unknown>).ollamaError = "Timeout";
  }

  res.json({ services, uptime: process.uptime(), debug });
});

// Admin — hot-reload DATABASE_URL from .env and reset the connection pool
app.post("/api/admin/reload-db", async (_req, res) => {
  try {
    const result = await reloadFromEnv();
    const changed = result.old !== result.new;
    console.log(`[Admin] DB reload: ${result.old} -> ${result.new} (changed=${changed})`);
    // Verify connectivity with the new pool
    await query("SELECT 1 as ok");
    recordSuccess();
    res.json({ ok: true, changed, old: result.old, new: result.new, connected: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// Dev service controls — start background services on demand
app.post("/api/services/:service/start", async (req, res) => {
  const requested = String(req.params.service || "").toLowerCase();
  const service: StartableService | null =
    requested === "watchdog"
      ? "watchdog"
      : requested === "autodev"
        ? "autodev"
        : (requested === "livekit" || requested === "livekit-worker")
          ? "livekit"
          : null;

  if (!service) {
    res.status(400).json({ error: "Unknown service. Use watchdog, autodev, or livekit." });
    return;
  }

  const result = startServiceDetached(service);
  if (!result.ok) {
    res.status(500).json(result);
    return;
  }

  res.json({ service, ...result });
});

// Restart a service (kill existing process, then start fresh)
app.post("/api/services/:service/restart", async (req, res) => {
  const requested = String(req.params.service || "").toLowerCase();
  const restartable = ["watchdog", "autodev", "livekit", "gateway"];
  const service =
    requested === "watchdog" ? "watchdog"
    : requested === "autodev" ? "autodev"
    : (requested === "livekit" || requested === "livekit-worker") ? "livekit"
    : requested === "gateway" ? "gateway"
    : null;

  if (!service) {
    res.status(400).json({ error: `Unknown service. Use: ${restartable.join(", ")}` });
    return;
  }

  // Gateway: respond first, then exit — watchdog will restart us
  if (service === "gateway") {
    res.json({ service, restarted: true, detail: "Exiting — watchdog will restart" });
    setTimeout(() => process.exit(0), 500);
    return;
  }

  // Kill existing process(es)
  const killPatterns: Record<string, string[]> = {
    watchdog: ["scripts/watchdog.sh"],
    autodev: ["scripts/dev-autodev.sh", "src/autodev/worker.ts"],
    livekit: ["infra/livekit-worker/run.sh", "livekit-worker/agent.py"],
  };

  for (const pat of killPatterns[service]) {
    try { execFileSync("pkill", ["-f", pat], { stdio: "ignore" }); } catch { /* not running */ }
  }

  // Brief pause so port/resources release
  await new Promise((r) => setTimeout(r, 1500));

  const result = startServiceDetached(service as StartableService);
  res.json({ service, restarted: result.ok, ...result });
});

app.get("/api/services/watchdog/mode", (_req, res) => {
  res.json({
    autoRestartEnabled: readWatchdogAutoRestartEnabled(),
    source: WATCHDOG_AUTORESTART_FILE,
  });
});

app.put("/api/services/watchdog/mode", (req, res) => {
  const enabled = req.body?.autoRestartEnabled;
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "Body must include boolean autoRestartEnabled" });
    return;
  }
  try {
    writeWatchdogAutoRestartEnabled(enabled);
    res.json({
      ok: true,
      autoRestartEnabled: enabled,
      source: WATCHDOG_AUTORESTART_FILE,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message || "Failed to write watchdog mode" });
  }
});

// ─── Settings API ───

// GET /api/settings — returns current config (API keys masked)
app.get("/api/settings", (_req, res) => {
  const masked = {
    ...config,
    auth: {
      anthropicApiKey: config.auth.anthropicApiKey ? "sk-ant-***" + config.auth.anthropicApiKey.slice(-4) : null,
      openrouterApiKey: config.auth.openrouterApiKey ? "sk-or-***" + config.auth.openrouterApiKey.slice(-4) : null,
      openaiApiKey: config.auth.openaiApiKey ? "sk-***" + config.auth.openaiApiKey.slice(-4) : null,
      googleApiKey: config.auth.googleApiKey ? "AIza***" + config.auth.googleApiKey.slice(-4) : null,
      elevenlabsApiKey: config.auth.elevenlabsApiKey ? "***" + config.auth.elevenlabsApiKey.slice(-4) : null,
    },
    telegram: {
      botToken: config.telegram.botToken ? "***" + config.telegram.botToken.slice(-4) : null,
      botUsername: config.telegram.botUsername || null,
      chatId: config.telegram.chatId || null,
    },
    livekit: {
      url: config.livekit.url || "",
      apiKey: config.livekit.apiKey ? "***" + config.livekit.apiKey.slice(-4) : null,
      apiSecret: config.livekit.apiSecret ? "***" + config.livekit.apiSecret.slice(-4) : null,
      sttProvider: config.livekit.sttProvider,
      sttModel: config.livekit.sttModel,
      ttsProvider: config.livekit.ttsProvider,
      ttsModel: config.livekit.ttsModel,
      ttsVoice: config.livekit.ttsVoice || "",
      deepgramApiKey: config.livekit.deepgramApiKey ? "***" + config.livekit.deepgramApiKey.slice(-4) : null,
      cartesiaApiKey: config.livekit.cartesiaApiKey ? "***" + config.livekit.cartesiaApiKey.slice(-4) : null,
      pronunciations: config.livekit.pronunciations ?? [],
      voicePrompt: config.livekit.voicePrompt ?? "",
      voiceModel: config.livekit.voiceModel,
      voiceHistoryLimit: config.livekit.voiceHistoryLimit,
      voiceEnableTools: config.livekit.voiceEnableTools,
      voiceIncludeMemory: config.livekit.voiceIncludeMemory,
      voiceMinEndpointSec: config.livekit.voiceMinEndpointSec,
      voiceMaxEndpointSec: config.livekit.voiceMaxEndpointSec,
      ttsCacheEnabled: config.livekit.ttsCacheEnabled,
      ttsCacheLocalMaxItems: config.livekit.ttsCacheLocalMaxItems,
      ttsCacheLocalMaxBytes: config.livekit.ttsCacheLocalMaxBytes,
      ttsCacheMaxTextChars: config.livekit.ttsCacheMaxTextChars,
      ttsCacheMaxAudioBytes: config.livekit.ttsCacheMaxAudioBytes,
      ttsCacheRedisTtlSec: config.livekit.ttsCacheRedisTtlSec,
      ttsCachePrefix: config.livekit.ttsCachePrefix,
      ttsCacheRedisUrl: config.livekit.ttsCacheRedisUrl || "",
    },
  };
  res.json(masked);
});

// GET /api/gateway/webhook-base — resolve best public/LAN base URL for inbound webhooks
app.get("/api/gateway/webhook-base", (req, res) => {
  const resolved = resolveWebhookBase(req);
  res.json(resolved);
});

// PUT /api/settings — update config sections
app.put("/api/settings", (req, res) => {
  try {
    const updates = req.body;

    // Merge updates into current config
    if (updates.auth) {
      // Only update keys that are actually provided (not masked values)
      if (updates.auth.anthropicApiKey && !updates.auth.anthropicApiKey.includes("***")) {
        (config as any).auth.anthropicApiKey = updates.auth.anthropicApiKey;
      }
      if (updates.auth.openrouterApiKey && !updates.auth.openrouterApiKey.includes("***")) {
        (config as any).auth.openrouterApiKey = updates.auth.openrouterApiKey;
      }
      if (updates.auth.openaiApiKey && !updates.auth.openaiApiKey.includes("***")) {
        (config as any).auth.openaiApiKey = updates.auth.openaiApiKey;
      }
      if (updates.auth.googleApiKey && !updates.auth.googleApiKey.includes("***")) {
        (config as any).auth.googleApiKey = updates.auth.googleApiKey;
      }
      if (updates.auth.elevenlabsApiKey && !updates.auth.elevenlabsApiKey.includes("***")) {
        (config as any).auth.elevenlabsApiKey = updates.auth.elevenlabsApiKey;
      }
    }

    if (updates.memory) {
      Object.assign((config as any).memory, updates.memory);
    }

    if (updates.obsidian) {
      Object.assign((config as any).obsidian, updates.obsidian);
    }

    if (updates.models) {
      Object.assign((config as any).models, updates.models);
    }

    if (updates.telegram) {
      if (updates.telegram.botToken && !updates.telegram.botToken.includes("***")) {
        (config as any).telegram.botToken = updates.telegram.botToken;
      }
      if (updates.telegram.botUsername !== undefined) {
        (config as any).telegram.botUsername = updates.telegram.botUsername;
      }
      if (updates.telegram.chatId !== undefined) {
        (config as any).telegram.chatId = updates.telegram.chatId;
      }
    }

    if (updates.livekit) {
      const lk = updates.livekit;
      if (lk.url !== undefined) (config as any).livekit.url = lk.url;
      if (lk.apiKey && !lk.apiKey.includes("***")) (config as any).livekit.apiKey = lk.apiKey;
      if (lk.apiSecret && !lk.apiSecret.includes("***")) (config as any).livekit.apiSecret = lk.apiSecret;
      if (lk.sttProvider !== undefined) (config as any).livekit.sttProvider = lk.sttProvider;
      if (lk.sttModel !== undefined) (config as any).livekit.sttModel = lk.sttModel;
      if (lk.ttsProvider !== undefined) (config as any).livekit.ttsProvider = lk.ttsProvider;
      if (lk.ttsModel !== undefined) (config as any).livekit.ttsModel = lk.ttsModel;
      if (lk.ttsVoice !== undefined) (config as any).livekit.ttsVoice = lk.ttsVoice;
      if (lk.deepgramApiKey && !lk.deepgramApiKey.includes("***")) (config as any).livekit.deepgramApiKey = lk.deepgramApiKey;
      if (lk.cartesiaApiKey && !lk.cartesiaApiKey.includes("***")) (config as any).livekit.cartesiaApiKey = lk.cartesiaApiKey;
      if (Array.isArray(lk.pronunciations)) (config as any).livekit.pronunciations = lk.pronunciations;
      if (lk.voicePrompt !== undefined) (config as any).livekit.voicePrompt = lk.voicePrompt;
      if (lk.voiceModel !== undefined) (config as any).livekit.voiceModel = lk.voiceModel;
      if (lk.voiceHistoryLimit !== undefined) (config as any).livekit.voiceHistoryLimit = lk.voiceHistoryLimit;
      if (lk.voiceEnableTools !== undefined) (config as any).livekit.voiceEnableTools = !!lk.voiceEnableTools;
      if (lk.voiceIncludeMemory !== undefined) (config as any).livekit.voiceIncludeMemory = !!lk.voiceIncludeMemory;
      if (lk.voiceMinEndpointSec !== undefined) (config as any).livekit.voiceMinEndpointSec = lk.voiceMinEndpointSec;
      if (lk.voiceMaxEndpointSec !== undefined) (config as any).livekit.voiceMaxEndpointSec = lk.voiceMaxEndpointSec;
      if (lk.ttsCacheEnabled !== undefined) (config as any).livekit.ttsCacheEnabled = !!lk.ttsCacheEnabled;
      if (lk.ttsCacheLocalMaxItems !== undefined) (config as any).livekit.ttsCacheLocalMaxItems = lk.ttsCacheLocalMaxItems;
      if (lk.ttsCacheLocalMaxBytes !== undefined) (config as any).livekit.ttsCacheLocalMaxBytes = lk.ttsCacheLocalMaxBytes;
      if (lk.ttsCacheMaxTextChars !== undefined) (config as any).livekit.ttsCacheMaxTextChars = lk.ttsCacheMaxTextChars;
      if (lk.ttsCacheMaxAudioBytes !== undefined) (config as any).livekit.ttsCacheMaxAudioBytes = lk.ttsCacheMaxAudioBytes;
      if (lk.ttsCacheRedisTtlSec !== undefined) (config as any).livekit.ttsCacheRedisTtlSec = lk.ttsCacheRedisTtlSec;
      if (lk.ttsCachePrefix !== undefined) (config as any).livekit.ttsCachePrefix = lk.ttsCachePrefix;
      if (lk.ttsCacheRedisUrl !== undefined) (config as any).livekit.ttsCacheRedisUrl = lk.ttsCacheRedisUrl;
    }

    // Reset cached API clients so they pick up new keys
    resetClients();

    // Save to disk
    saveConfig(config);

    res.json({ saved: true });
  } catch (err) {
    console.error("Failed to save settings:", err);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

// GET /api/settings/models — available models for dropdowns
app.get("/api/settings/models", (_req, res) => {
  res.json({
    available: AVAILABLE_MODELS,
    hasAnthropicKey: !!config.auth.anthropicApiKey,
    hasOpenRouterKey: !!config.auth.openrouterApiKey,
    hasOllama: true, // Ollama is always potentially available (no API key needed)
  });
});

// GET /api/settings/ollama/llm-status — Check if an Ollama LLM model is available
app.get("/api/settings/ollama/llm-status", async (req, res) => {
  const model = (req.query.model as string) || "qwen3";
  const ollamaUrl = getOllamaUrl(config);
  const status = await checkOllamaModel(ollamaUrl, model);
  res.json(status);
});

// POST /api/settings/ollama/pull-llm — Pull an LLM model into Ollama
app.post("/api/settings/ollama/pull-llm", async (req, res) => {
  const { model } = req.body as { model: string };
  if (!model) {
    res.status(400).json({ error: "model is required" });
    return;
  }
  try {
    const ollamaUrl = getOllamaUrl(config);
    await pullOllamaLLMModel(ollamaUrl, model);
    res.json({ pulled: true, model });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// GET /api/settings/model-routes — current model routing
app.get("/api/settings/model-routes", async (_req, res) => {
  const defaultRoutes = [
    { task: "chat", model: "claude-sonnet-4-20250514", provider: "anthropic" },
    { task: "tool", model: "openai/gpt-4o-mini", provider: "openrouter" },
    { task: "utility", model: "anthropic/claude-haiku-3-20240307", provider: "openrouter" },
    { task: "triage", model: "openai/gpt-4o-mini", provider: "openrouter" },
    { task: "embedding", model: "nomic-embed-text", provider: "ollama" },
  ];
  try {
    const result = await query<{ task: string; model: string; provider: string; updated_at: string }>(
      "SELECT task, model, provider, updated_at FROM model_routes ORDER BY task",
    );
    // Fill in any missing tasks with defaults
    const existing = new Set(result.rows.map((r) => r.task));
    const routes: Array<{ task: string; model: string; provider: string; updated_at?: string }> = [...result.rows];
    for (const def of defaultRoutes) {
      if (!existing.has(def.task)) routes.push(def);
    }
    // Sort in canonical order
    const order = defaultRoutes.map((d) => d.task);
    routes.sort((a, b) => order.indexOf(a.task) - order.indexOf(b.task));
    res.json({ routes });
  } catch {
    res.json({ routes: defaultRoutes });
  }
});

// PUT /api/settings/model-routes — update model routing
app.put("/api/settings/model-routes", async (req, res) => {
  try {
    const { routes } = req.body as { routes: Array<{ task: string; model: string; provider: string }> };

    for (const route of routes) {
      await query(
        `INSERT INTO model_routes (task, model, provider, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (task) DO UPDATE SET model = $2, provider = $3, updated_at = NOW()`,
        [route.task, route.model, route.provider],
      );
    }

    resetClients();
    res.json({ saved: true });
  } catch (err) {
    console.error("Failed to save model routes:", err);
    res.status(500).json({ error: "Failed to save model routes" });
  }
});

// GET /api/settings/ollama — Ollama status
app.get("/api/settings/ollama", async (_req, res) => {
  const status = await checkOllama(config);
  res.json(status);
});

// POST /api/settings/ollama/pull — Pull embedding model
app.post("/api/settings/ollama/pull", async (_req, res) => {
  try {
    await pullModel(config);
    res.json({ pulled: true, model: config.memory.embeddingModel });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ===== OpenRouter Admin =====

// GET /api/stats/openrouter — credits + activity from OpenRouter management API
app.get("/api/stats/openrouter", async (_req, res) => {
  const mgmtKey = config.auth.openrouterMgmtKey;
  if (!mgmtKey) {
    res.json({ error: "OPENROUTER_MGMT_KEY not configured" });
    return;
  }

  const headers = { Authorization: `Bearer ${mgmtKey}` };

  try {
    const [creditsRes, activityRes, keysRes] = await Promise.all([
      fetch("https://openrouter.ai/api/v1/credits", { headers }).then((r) => r.json()) as Promise<{ data: unknown }>,
      fetch("https://openrouter.ai/api/v1/activity", { headers }).then((r) => r.json()) as Promise<{ data: unknown }>,
      fetch("https://openrouter.ai/api/v1/keys", { headers }).then((r) => r.json()) as Promise<{ data: Record<string, unknown>[] }>,
    ]);

    res.json({
      credits: creditsRes.data,
      activity: activityRes.data,
      keys: (keysRes.data || []).map((k) => ({
        name: k.name,
        label: k.label,
        disabled: k.disabled,
        limit: k.limit,
        limitRemaining: k.limit_remaining,
        usage: k.usage,
        usageDaily: k.usage_daily,
        usageWeekly: k.usage_weekly,
        usageMonthly: k.usage_monthly,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ===== Usage Statistics =====

// GET /api/stats/usage/summary — overall usage summary
app.get("/api/stats/usage/summary", async (_req, res) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*)::int AS total_calls,
        COALESCE(SUM(input_tokens), 0)::bigint AS total_input_tokens,
        COALESCE(SUM(output_tokens), 0)::bigint AS total_output_tokens,
        COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS total_tokens,
        COALESCE(SUM(cost_usd), 0)::float AS total_cost,
        COALESCE(AVG(latency_ms), 0)::int AS avg_latency_ms
      FROM usage_log WHERE NOT error
    `);
    const today = await query(`
      SELECT
        COUNT(*)::int AS calls,
        COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS tokens,
        COALESCE(SUM(cost_usd), 0)::float AS cost
      FROM usage_log
      WHERE NOT error AND created_at >= CURRENT_DATE
    `);
    res.json({
      all: result.rows[0],
      today: today.rows[0],
    });
  } catch {
    res.json({ all: { total_calls: 0, total_tokens: 0, total_cost: 0 }, today: { calls: 0, tokens: 0, cost: 0 } });
  }
});

// GET /api/stats/usage/daily — daily usage for charts (last 30 days)
app.get("/api/stats/usage/daily", async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 90);
  try {
    const result = await query(`
      SELECT
        date_trunc('day', created_at)::date AS day,
        provider,
        COUNT(*)::int AS calls,
        COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
        COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS total_tokens,
        COALESCE(SUM(cost_usd), 0)::float AS cost
      FROM usage_log
      WHERE NOT error AND created_at >= CURRENT_DATE - $1::int
      GROUP BY 1, 2
      ORDER BY 1 ASC, 2
    `, [days]);
    res.json({ daily: result.rows });
  } catch {
    res.json({ daily: [] });
  }
});

// GET /api/stats/usage/by-model — usage breakdown by model
app.get("/api/stats/usage/by-model", async (_req, res) => {
  try {
    const result = await query(`
      SELECT
        provider,
        model,
        COUNT(*)::int AS calls,
        COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS total_tokens,
        COALESCE(SUM(cost_usd), 0)::float AS cost,
        COALESCE(AVG(latency_ms), 0)::int AS avg_latency_ms
      FROM usage_log
      WHERE NOT error
      GROUP BY provider, model
      ORDER BY total_tokens DESC
    `);
    res.json({ models: result.rows });
  } catch {
    res.json({ models: [] });
  }
});

// GET /api/stats/usage/by-provider — usage breakdown by provider
app.get("/api/stats/usage/by-provider", async (_req, res) => {
  try {
    const result = await query(`
      SELECT
        provider,
        COUNT(*)::int AS calls,
        COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS total_tokens,
        COALESCE(SUM(cost_usd), 0)::float AS cost
      FROM usage_log
      WHERE NOT error
      GROUP BY provider
      ORDER BY total_tokens DESC
    `);
    res.json({ providers: result.rows });
  } catch {
    res.json({ providers: [] });
  }
});

// ─── Reports API ───

// GET /api/reports/costs/daily — daily cost breakdown by provider
app.get("/api/reports/costs/daily", async (req, res) => {
  const days = Number(req.query.days) || 30;
  try {
    const result = await query(
      `SELECT date_trunc('day', created_at)::date AS day, provider,
        COUNT(*)::int AS calls, COALESCE(SUM(cost_usd),0)::float AS cost,
        COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
        COALESCE(SUM(output_tokens),0)::bigint AS output_tokens
       FROM usage_log WHERE NOT error AND created_at >= CURRENT_DATE - $1::int
       GROUP BY 1, 2 ORDER BY 1, 2`,
      [days],
    );
    res.json({ daily: result.rows });
  } catch {
    res.json({ daily: [] });
  }
});

// GET /api/reports/costs/by-task — cost breakdown by task type
app.get("/api/reports/costs/by-task", async (req, res) => {
  const days = Number(req.query.days) || 30;
  try {
    const result = await query(
      `SELECT task, COUNT(*)::int AS calls, COALESCE(SUM(cost_usd),0)::float AS cost,
        COALESCE(SUM(input_tokens+output_tokens),0)::bigint AS total_tokens
       FROM usage_log WHERE NOT error AND created_at >= CURRENT_DATE - $1::int
       GROUP BY task ORDER BY cost DESC`,
      [days],
    );
    res.json({ tasks: result.rows });
  } catch {
    res.json({ tasks: [] });
  }
});

// GET /api/reports/costs/by-agent — cost breakdown by agent
app.get("/api/reports/costs/by-agent", async (req, res) => {
  const days = Number(req.query.days) || 30;
  try {
    const result = await query(
      `SELECT COALESCE(agent_id,'unknown') AS agent_id, COUNT(*)::int AS calls,
        COALESCE(SUM(cost_usd),0)::float AS cost
       FROM usage_log WHERE NOT error AND created_at >= CURRENT_DATE - $1::int
       GROUP BY agent_id ORDER BY cost DESC`,
      [days],
    );
    res.json({ agents: result.rows });
  } catch {
    res.json({ agents: [] });
  }
});

// GET /api/reports/costs/agent/:id — per-agent stats (cost, calls, tokens, latency)
app.get("/api/reports/costs/agent/:id", async (req, res) => {
  const days = Number(req.query.days) || 30;
  const agentId = req.params.id;
  try {
    const summaryResult = await query(
      `SELECT COUNT(*)::int AS total_calls,
        COALESCE(SUM(cost_usd),0)::float AS total_cost,
        COALESCE(SUM(input_tokens),0)::bigint AS total_input_tokens,
        COALESCE(SUM(output_tokens),0)::bigint AS total_output_tokens,
        COALESCE(AVG(latency_ms),0)::int AS avg_latency_ms
       FROM usage_log WHERE NOT error AND agent_id = $1 AND created_at >= CURRENT_DATE - $2::int`,
      [agentId, days],
    );
    const dailyResult = await query(
      `SELECT date_trunc('day', created_at)::date AS day,
        COUNT(*)::int AS calls,
        COALESCE(SUM(cost_usd),0)::float AS cost
       FROM usage_log WHERE NOT error AND agent_id = $1 AND created_at >= CURRENT_DATE - $2::int
       GROUP BY 1 ORDER BY 1`,
      [agentId, days],
    );
    res.json({ summary: summaryResult.rows[0], daily: dailyResult.rows });
  } catch {
    res.json({ summary: { total_calls: 0, total_cost: 0, total_input_tokens: 0, total_output_tokens: 0, avg_latency_ms: 0 }, daily: [] });
  }
});

// GET /api/reports/costs/cumulative — running cost total over time
app.get("/api/reports/costs/cumulative", async (req, res) => {
  const days = Number(req.query.days) || 30;
  try {
    const result = await query(
      `SELECT date_trunc('day', created_at)::date AS day,
        SUM(COALESCE(cost_usd,0))::float AS daily_cost,
        SUM(SUM(COALESCE(cost_usd,0))) OVER (ORDER BY date_trunc('day', created_at)::date)::float AS cumulative_cost
       FROM usage_log WHERE NOT error AND created_at >= CURRENT_DATE - $1::int
       GROUP BY 1 ORDER BY 1`,
      [days],
    );
    res.json({ cumulative: result.rows });
  } catch {
    res.json({ cumulative: [] });
  }
});

// GET /api/reports/costs/models — full model breakdown table
app.get("/api/reports/costs/models", async (req, res) => {
  const days = Number(req.query.days) || 30;
  try {
    const result = await query(
      `SELECT provider, model, COUNT(*)::int AS calls,
        COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,
        COALESCE(SUM(output_tokens),0)::bigint AS output_tokens,
        COALESCE(SUM(cost_usd),0)::float AS cost,
        COALESCE(AVG(latency_ms),0)::int AS avg_latency_ms
       FROM usage_log WHERE NOT error AND created_at >= CURRENT_DATE - $1::int
       GROUP BY provider, model ORDER BY cost DESC`,
      [days],
    );
    res.json({ models: result.rows });
  } catch {
    res.json({ models: [] });
  }
});

// GET /api/reports/knowledge/summary — totals for docs/chunks/memories
app.get("/api/reports/knowledge/summary", async (_req, res) => {
  try {
    const result = await query(
      `SELECT
        (SELECT count(*)::int FROM documents) AS total_documents,
        (SELECT count(*)::int FROM chunks) AS total_chunks,
        (SELECT count(*)::int FROM chunks WHERE embedding IS NOT NULL) AS embedded_chunks,
        (SELECT count(*)::int FROM memories WHERE superseded_by IS NULL) AS active_memories`,
    );
    res.json(result.rows[0]);
  } catch {
    res.json({ total_documents: 0, total_chunks: 0, embedded_chunks: 0, active_memories: 0 });
  }
});

// GET /api/reports/knowledge/by-source — document/chunk counts per source
app.get("/api/reports/knowledge/by-source", async (_req, res) => {
  try {
    const result = await query(
      `SELECT d.source,
        COUNT(DISTINCT d.id)::int AS documents,
        COUNT(c.id)::int AS chunks,
        COUNT(c.id) FILTER (WHERE c.embedding IS NOT NULL)::int AS embedded_chunks
       FROM documents d
       LEFT JOIN chunks c ON c.document_id = d.id
       GROUP BY d.source ORDER BY documents DESC`,
    );
    res.json({ sources: result.rows });
  } catch {
    res.json({ sources: [] });
  }
});

// GET /api/reports/knowledge/growth — document ingestion over time
app.get("/api/reports/knowledge/growth", async (req, res) => {
  const days = Number(req.query.days) || 90;
  try {
    const result = await query(
      `SELECT date_trunc('day', created_at)::date AS day,
        COUNT(*)::int AS new_docs,
        SUM(COUNT(*)) OVER (ORDER BY date_trunc('day', created_at)::date)::int AS cumulative_docs
       FROM documents
       WHERE created_at >= CURRENT_DATE - $1::int
       GROUP BY 1 ORDER BY 1`,
      [days],
    );
    res.json({ growth: result.rows });
  } catch {
    res.json({ growth: [] });
  }
});

// GET /api/reports/knowledge/memories-by-area — memory stats per area
app.get("/api/reports/knowledge/memories-by-area", async (_req, res) => {
  try {
    const result = await query(
      `SELECT area,
        COUNT(*)::int AS count,
        AVG(confidence)::float AS avg_confidence,
        COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS with_embedding,
        COUNT(*) FILTER (WHERE pinned)::int AS pinned
       FROM memories WHERE superseded_by IS NULL
       GROUP BY area ORDER BY count DESC`,
    );
    res.json({ areas: result.rows });
  } catch {
    res.json({ areas: [] });
  }
});

// GET /api/reports/cron/summary — per-job aggregate stats
app.get("/api/reports/cron/summary", async (_req, res) => {
  try {
    const result = await query(
      `SELECT j.id, j.name, j.agent_id, j.enabled,
        COUNT(r.id)::int AS total_runs,
        COUNT(r.id) FILTER (WHERE r.status='ok')::int AS success_count,
        COUNT(r.id) FILTER (WHERE r.status='error')::int AS error_count,
        COALESCE(AVG(r.duration_ms) FILTER (WHERE r.status='ok'),0)::int AS avg_duration_ms,
        COALESCE(MAX(r.duration_ms),0)::int AS max_duration_ms,
        MAX(r.started_at) AS last_run_at
       FROM cron_jobs j LEFT JOIN cron_job_runs r ON r.job_id = j.id
       GROUP BY j.id, j.name, j.agent_id, j.enabled ORDER BY total_runs DESC`,
    );
    res.json({ jobs: result.rows });
  } catch {
    res.json({ jobs: [] });
  }
});

// GET /api/reports/cron/timeline — daily success/error counts
app.get("/api/reports/cron/timeline", async (req, res) => {
  const days = Number(req.query.days) || 30;
  try {
    const result = await query(
      `SELECT date_trunc('day', started_at)::date AS day,
        COUNT(*) FILTER (WHERE status='ok')::int AS success,
        COUNT(*) FILTER (WHERE status='error')::int AS errors,
        COALESCE(AVG(duration_ms) FILTER (WHERE status='ok'),0)::int AS avg_duration_ms
       FROM cron_job_runs
       WHERE started_at >= CURRENT_DATE - $1::int
       GROUP BY 1 ORDER BY 1`,
      [days],
    );
    res.json({ timeline: result.rows });
  } catch {
    res.json({ timeline: [] });
  }
});

// GET /api/reports/conversations/summary — overview stats
app.get("/api/reports/conversations/summary", async (req, res) => {
  const days = Number(req.query.days) || 30;
  try {
    const result = await query(
      `SELECT
        COUNT(DISTINCT c.id)::int AS conversations,
        COUNT(m.id)::int AS messages,
        CASE WHEN COUNT(DISTINCT c.id) > 0
          THEN ROUND(COUNT(m.id)::numeric / COUNT(DISTINCT c.id), 1)::float
          ELSE 0 END AS avg_msgs_per_conv,
        COUNT(DISTINCT c.agent_id)::int AS active_agents
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.created_at >= CURRENT_DATE - $1::int`,
      [days],
    );
    res.json(result.rows[0]);
  } catch {
    res.json({ conversations: 0, messages: 0, avg_msgs_per_conv: 0, active_agents: 0 });
  }
});

// GET /api/reports/conversations/by-agent — per agent breakdown
app.get("/api/reports/conversations/by-agent", async (req, res) => {
  const days = Number(req.query.days) || 30;
  try {
    const result = await query(
      `SELECT COALESCE(c.agent_id, 'unknown') AS agent_id,
        COUNT(DISTINCT c.id)::int AS conversations,
        COUNT(m.id)::int AS messages
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.created_at >= CURRENT_DATE - $1::int
       GROUP BY c.agent_id ORDER BY conversations DESC`,
      [days],
    );
    res.json({ agents: result.rows });
  } catch {
    res.json({ agents: [] });
  }
});

// GET /api/reports/conversations/daily — daily message volume
app.get("/api/reports/conversations/daily", async (req, res) => {
  const days = Number(req.query.days) || 30;
  try {
    const result = await query(
      `SELECT date_trunc('day', m.created_at)::date AS day,
        COUNT(DISTINCT c.id)::int AS conversations,
        COUNT(m.id)::int AS messages
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.created_at >= CURRENT_DATE - $1::int
       GROUP BY 1 ORDER BY 1`,
      [days],
    );
    res.json({ daily: result.rows });
  } catch {
    res.json({ daily: [] });
  }
});

// Cartesia TTS: 1 credit = 1 character. Startup plan: $49 / 1.25M credits
const CARTESIA_COST_PER_CHAR = 49 / 1_250_000; // ~$0.0000392
// DeepGram Nova-3 streaming: $0.0077/min
const DEEPGRAM_COST_PER_MS = 0.0077 / 60_000; // ~$0.000000128/ms

// GET /api/reports/voice/summary — voice usage totals
app.get("/api/reports/voice/summary", async (req, res) => {
  const days = Number(req.query.days) || 30;
  try {
    const result = await query(
      `SELECT
        COUNT(*) FILTER (WHERE service IN ('stt','tts'))::int AS total_calls,
        COALESCE(SUM(duration_ms) FILTER (WHERE service IN ('stt','tts')),0)::bigint AS total_duration_ms,
        COALESCE(SUM(characters) FILTER (WHERE service='tts'),0)::bigint AS total_characters,
        COALESCE(SUM(cost_usd),0)::float AS total_cost,
        COALESCE(SUM(cost_usd) FILTER (WHERE service='stt'),0)::float AS stt_cost,
        COALESCE(SUM(cost_usd) FILTER (WHERE service='tts'),0)::float AS tts_cost,
        COALESCE(SUM(duration_ms) FILTER (WHERE service='stt'),0)::bigint AS stt_duration_ms,
        COALESCE(SUM(characters) FILTER (WHERE service='tts'),0)::bigint AS tts_characters,
        COUNT(*) FILTER (WHERE service='tts_cache')::int AS tts_cache_calls,
        COALESCE(SUM(characters) FILTER (WHERE service='tts_cache'),0)::bigint AS tts_cache_total_chars,
        COALESCE(SUM((metadata->>'cache_hits')::int) FILTER (WHERE service='tts_cache'),0)::bigint AS cache_hits,
        COALESCE(SUM((metadata->>'cache_misses')::int) FILTER (WHERE service='tts_cache'),0)::bigint AS cache_misses,
        COALESCE(SUM((metadata->>'cache_hit_chars')::int) FILTER (WHERE service='tts_cache'),0)::bigint AS cache_hit_chars,
        COALESCE(SUM((metadata->>'cache_miss_chars')::int) FILTER (WHERE service='tts_cache'),0)::bigint AS cache_miss_chars,
        COALESCE(SUM((metadata->>'cache_hit_audio_bytes')::int) FILTER (WHERE service='tts_cache'),0)::bigint AS cache_hit_audio_bytes,
        COALESCE(SUM((metadata->>'cache_miss_audio_bytes')::int) FILTER (WHERE service='tts_cache'),0)::bigint AS cache_miss_audio_bytes
       FROM voice_usage_log
       WHERE created_at >= CURRENT_DATE - $1::int`,
      [days],
    );
    const row = result.rows[0] as Record<string, unknown>;
    const cacheHits = Number(row.cache_hits || 0);
    const cacheMisses = Number(row.cache_misses || 0);
    const cacheTotal = cacheHits + cacheMisses;
    const cacheMissChars = Number(row.cache_miss_chars || 0);
    const ttsCacheCalls = Number(row.tts_cache_calls || 0);
    const ttsCacheTotalChars = Number(row.tts_cache_total_chars || 0);
    const sttDurationMs = Number(row.stt_duration_ms || 0);
    // Estimate costs from raw metrics when cost_usd is not recorded
    const estimatedTtsCost = cacheMissChars * CARTESIA_COST_PER_CHAR;
    const estimatedSttCost = sttDurationMs * DEEPGRAM_COST_PER_MS;
    const directTtsCost = Number(row.tts_cost || 0);
    const directSttCost = Number(row.stt_cost || 0);
    const directTotalCost = Number(row.total_cost || 0);
    const ttsCost = directTtsCost > 0 ? directTtsCost : estimatedTtsCost;
    const sttCost = directSttCost > 0 ? directSttCost : estimatedSttCost;
    res.json({
      ...row,
      tts_cost: ttsCost,
      stt_cost: sttCost,
      total_cost: directTotalCost > 0 ? directTotalCost : ttsCost + sttCost,
      // Include tts_cache data in totals when no direct tts rows exist
      total_calls: Number(row.total_calls || 0) || ttsCacheCalls,
      total_characters: Number(row.total_characters || 0) || ttsCacheTotalChars,
      cache_hit_rate: cacheTotal > 0 ? cacheHits / cacheTotal : 0,
    });
  } catch {
    res.json({
      total_calls: 0, total_duration_ms: 0, total_characters: 0, total_cost: 0,
      stt_cost: 0, tts_cost: 0, stt_duration_ms: 0, tts_characters: 0,
      cache_hits: 0, cache_misses: 0, cache_hit_chars: 0, cache_miss_chars: 0,
      cache_hit_audio_bytes: 0, cache_miss_audio_bytes: 0, cache_hit_rate: 0,
    });
  }
});

// GET /api/reports/voice/daily — daily voice cost breakdown
app.get("/api/reports/voice/daily", async (req, res) => {
  const days = Number(req.query.days) || 30;
  try {
    const result = await query(
      `SELECT day, service, calls,
        CASE WHEN cost > 0 THEN cost
             WHEN service = 'stt' THEN duration_ms * ${DEEPGRAM_COST_PER_MS}
             WHEN service = 'tts' THEN characters * ${CARTESIA_COST_PER_CHAR}
             ELSE 0 END::float AS cost,
        duration_ms, characters
       FROM (
         SELECT date_trunc('day', created_at)::date AS day,
           service,
           COUNT(*)::int AS calls,
           COALESCE(SUM(cost_usd),0)::float AS cost,
           COALESCE(SUM(duration_ms),0)::bigint AS duration_ms,
           COALESCE(SUM(characters),0)::bigint AS characters
         FROM voice_usage_log
         WHERE service IN ('stt','tts') AND created_at >= CURRENT_DATE - $1::int
         GROUP BY 1, 2
       ) direct_usage

       UNION ALL

       -- Synthesize 'tts' rows from tts_cache data with estimated cost (cache misses only)
       SELECT date_trunc('day', created_at)::date AS day,
         'tts'::text AS service,
         COUNT(*)::int AS calls,
         (COALESCE(SUM((metadata->>'cache_miss_chars')::int),0) * ${CARTESIA_COST_PER_CHAR})::float AS cost,
         0::bigint AS duration_ms,
         COALESCE(SUM(characters),0)::bigint AS characters
       FROM voice_usage_log
       WHERE service='tts_cache' AND created_at >= CURRENT_DATE - $1::int
       GROUP BY 1

       UNION ALL

       SELECT date_trunc('day', created_at)::date AS day,
         'tts_cache_hit'::text AS service,
         COALESCE(SUM((metadata->>'cache_hits')::int),0)::int AS calls,
         0::float AS cost,
         0::bigint AS duration_ms,
         COALESCE(SUM((metadata->>'cache_hit_chars')::int),0)::bigint AS characters
       FROM voice_usage_log
       WHERE service='tts_cache' AND created_at >= CURRENT_DATE - $1::int
       GROUP BY 1

       UNION ALL

       SELECT date_trunc('day', created_at)::date AS day,
         'tts_cache_miss'::text AS service,
         COALESCE(SUM((metadata->>'cache_misses')::int),0)::int AS calls,
         0::float AS cost,
         0::bigint AS duration_ms,
         COALESCE(SUM((metadata->>'cache_miss_chars')::int),0)::bigint AS characters
       FROM voice_usage_log
       WHERE service='tts_cache' AND created_at >= CURRENT_DATE - $1::int
       GROUP BY 1

       ORDER BY 1, 2`,
      [days],
    );
    res.json({ daily: result.rows });
  } catch {
    res.json({ daily: [] });
  }
});

interface KnowledgeAuditSnapshot {
  facts: {
    active: number;
    archived: number;
    duplicateRows: number;
    duplicateGroups: number;
  };
  memories: {
    operationalActive: number;
    legacyIdentityActive: number;
    legacyPreferencesActive: number;
  };
  reviews: {
    pendingTotal: number;
    pendingTriage: number;
    pendingVerifyFact: number;
  };
}

interface KnowledgeRepairState {
  running: boolean;
  runCount: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastReport: ConsolidationReport | null;
  lastAudit: KnowledgeAuditSnapshot | null;
}

const knowledgeRepairState: KnowledgeRepairState = {
  running: false,
  runCount: 0,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastDurationMs: null,
  lastError: null,
  lastReport: null,
  lastAudit: null,
};

function knowledgeHealthStatus(audit: KnowledgeAuditSnapshot): "healthy" | "warning" {
  return knowledgeHealthReasons(audit).length > 0 ? "warning" : "healthy";
}

function knowledgeHealthReasons(audit: KnowledgeAuditSnapshot): string[] {
  const reasons: string[] = [];

  if (audit.facts.duplicateRows > 0) {
    reasons.push(`Fact duplicates (${audit.facts.duplicateRows})`);
  }
  if (audit.memories.legacyIdentityActive > 0) {
    reasons.push(`Legacy identity memories (${audit.memories.legacyIdentityActive})`);
  }
  if (audit.memories.legacyPreferencesActive > 0) {
    reasons.push(`Legacy preference memories (${audit.memories.legacyPreferencesActive})`);
  }
  if (audit.reviews.pendingTriage > 250) {
    reasons.push(`Triage backlog high (${audit.reviews.pendingTriage} pending)`);
  }
  if (audit.reviews.pendingVerifyFact > 50) {
    reasons.push(`Fact verification backlog (${audit.reviews.pendingVerifyFact} pending)`);
  }

  return reasons.slice(0, 4);
}

async function getKnowledgeAuditSnapshot(): Promise<KnowledgeAuditSnapshot> {
  const factsCollection = await query<{ id: string }>(
    "SELECT id FROM store_collections WHERE name = 'Facts' LIMIT 1",
  );
  const factsCollectionId = factsCollection.rows[0]?.id;

  let facts = {
    active: 0,
    archived: 0,
    duplicateRows: 0,
    duplicateGroups: 0,
  };

  if (factsCollectionId) {
    const factsCounts = await query<{ status: string; count: number }>(
      `SELECT status, count(*)::int AS count
       FROM store_objects
       WHERE collection_id = $1
       GROUP BY status`,
      [factsCollectionId],
    );
    for (const row of factsCounts.rows) {
      if (row.status === "active") facts.active = row.count;
      if (row.status === "archived") facts.archived = row.count;
    }

    const dupes = await query<{ duplicate_rows: number; duplicate_groups: number }>(
      `WITH norm AS (
         SELECT
           LOWER(BTRIM(COALESCE(data->>'subject',''))) AS subject,
           LOWER(BTRIM(COALESCE(data->>'predicate',''))) AS predicate,
           LOWER(BTRIM(COALESCE(data->>'object',''))) AS object,
           count(*) AS c
         FROM store_objects
         WHERE collection_id = $1
           AND status = 'active'
         GROUP BY 1, 2, 3
       )
       SELECT
         COALESCE(SUM(c - 1), 0)::int AS duplicate_rows,
         count(*) FILTER (WHERE c > 1)::int AS duplicate_groups
       FROM norm`,
      [factsCollectionId],
    );
    facts.duplicateRows = dupes.rows[0]?.duplicate_rows ?? 0;
    facts.duplicateGroups = dupes.rows[0]?.duplicate_groups ?? 0;
  }

  const memoryCounts = await query<{ area: string; source: string; count: number }>(
    `SELECT area, COALESCE(source, '') AS source, count(*)::int AS count
     FROM memories
     WHERE superseded_by IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
       AND confidence > 0.05
     GROUP BY area, COALESCE(source, '')`,
  );
  const memories = {
    operationalActive: 0,
    legacyIdentityActive: 0,
    legacyPreferencesActive: 0,
  };
  for (const row of memoryCounts.rows) {
    if (row.area === "knowledge" || row.area === "solutions" || row.area === "episodes") {
      memories.operationalActive += row.count;
    } else if (row.area === "identity" && row.source !== "user") {
      memories.legacyIdentityActive += row.count;
    } else if (row.area === "preferences" && row.source !== "user") {
      memories.legacyPreferencesActive += row.count;
    }
  }

  const reviewCounts = await query<{ type: string; count: number }>(
    `SELECT type, count(*)::int AS count
     FROM review_queue
     WHERE status = 'pending'
     GROUP BY type`,
  );
  const reviews = {
    pendingTotal: 0,
    pendingTriage: 0,
    pendingVerifyFact: 0,
  };
  for (const row of reviewCounts.rows) {
    reviews.pendingTotal += row.count;
    if (row.type === "triage") reviews.pendingTriage = row.count;
    if (row.type === "verify_fact") reviews.pendingVerifyFact = row.count;
  }

  return { facts, memories, reviews };
}

// GET /api/knowledge/audit — quick health snapshot for learning system
app.get("/api/knowledge/audit", async (_req, res) => {
  try {
    const audit = await getKnowledgeAuditSnapshot();
    const health = knowledgeHealthStatus(audit);
    const healthReasons = knowledgeHealthReasons(audit);
    res.json({
      ...audit,
      _meta: {
        generatedAt: new Date().toISOString(),
        health,
        healthReasons,
        repair: {
          running: knowledgeRepairState.running,
          runCount: knowledgeRepairState.runCount,
          lastStartedAt: knowledgeRepairState.lastStartedAt,
          lastFinishedAt: knowledgeRepairState.lastFinishedAt,
          lastDurationMs: knowledgeRepairState.lastDurationMs,
          lastError: knowledgeRepairState.lastError,
        },
      },
    });
  } catch (err) {
    console.error("Failed to build knowledge audit:", err);
    res.status(500).json({ error: "Failed to build knowledge audit" });
  }
});

// GET /api/knowledge/repair/status — current + last run info
app.get("/api/knowledge/repair/status", async (_req, res) => {
  try {
    const audit = knowledgeRepairState.lastAudit ?? (await getKnowledgeAuditSnapshot());
    res.json({
      running: knowledgeRepairState.running,
      runCount: knowledgeRepairState.runCount,
      lastStartedAt: knowledgeRepairState.lastStartedAt,
      lastFinishedAt: knowledgeRepairState.lastFinishedAt,
      lastDurationMs: knowledgeRepairState.lastDurationMs,
      lastError: knowledgeRepairState.lastError,
      lastReport: knowledgeRepairState.lastReport,
      health: knowledgeHealthStatus(audit),
      healthReasons: knowledgeHealthReasons(audit),
    });
  } catch (err) {
    console.error("Failed to get knowledge repair status:", err);
    res.status(500).json({ error: "Failed to get knowledge repair status" });
  }
});

// POST /api/knowledge/repair — run consolidation/cleanup now
app.post("/api/knowledge/repair", async (_req, res) => {
  if (knowledgeRepairState.running) {
    res.status(409).json({
      error: "Knowledge repair is already running",
      running: true,
      lastStartedAt: knowledgeRepairState.lastStartedAt,
    });
    return;
  }

  const startedAtIso = new Date().toISOString();
  const startedAtMs = Date.now();
  knowledgeRepairState.running = true;
  knowledgeRepairState.lastStartedAt = startedAtIso;
  knowledgeRepairState.lastError = null;

  try {
    const report = await runConsolidation(config);
    const audit = await getKnowledgeAuditSnapshot();
    const finishedAtIso = new Date().toISOString();
    const durationMs = Date.now() - startedAtMs;

    knowledgeRepairState.running = false;
    knowledgeRepairState.runCount += 1;
    knowledgeRepairState.lastFinishedAt = finishedAtIso;
    knowledgeRepairState.lastDurationMs = durationMs;
    knowledgeRepairState.lastReport = report;
    knowledgeRepairState.lastAudit = audit;

    res.json({
      repaired: true,
      report,
      audit,
      _meta: {
        startedAt: startedAtIso,
        finishedAt: finishedAtIso,
        durationMs,
      },
    });
  } catch (err) {
    const finishedAtIso = new Date().toISOString();
    const durationMs = Date.now() - startedAtMs;
    const message = err instanceof Error ? err.message : String(err);

    knowledgeRepairState.running = false;
    knowledgeRepairState.lastFinishedAt = finishedAtIso;
    knowledgeRepairState.lastDurationMs = durationMs;
    knowledgeRepairState.lastError = message;

    console.error("Failed to run knowledge repair:", err);
    res.status(500).json({ error: "Failed to run knowledge repair" });
  }
});

// GET /api/memories — list memories by area, scope, tags
app.get("/api/memories", async (req, res) => {
  try {
    const area = req.query.area as string | undefined;
    const scope = req.query.scope as string | undefined;
    const visibility = req.query.visibility as string | undefined;
    const tags = req.query.tags ? (req.query.tags as string).split(",").map((t) => t.trim()).filter(Boolean) : undefined;
    const limit = Number(req.query.limit) || 50;
    const memories = await listMemories(area, limit, { scope, tags, visibility });
    res.json({ memories });
  } catch (err) {
    console.error("Failed to list memories:", err);
    res.status(500).json({ error: "Failed to list memories" });
  }
});

// GET /api/memories/stats — memory area counts
app.get("/api/memories/stats", async (_req, res) => {
  try {
    const result = await query(
      `SELECT area, count(*)::int AS count, avg(confidence)::float AS avg_confidence
       FROM memories
       WHERE superseded_by IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
         AND confidence > 0.05
         AND area = ANY($1::text[])
       GROUP BY area
       ORDER BY area`,
      [["knowledge", "solutions", "episodes"]],
    );
    res.json({ stats: result.rows });
  } catch {
    res.json({ stats: [] });
  }
});

// POST /api/memories/search — hybrid search across memories
app.post("/api/memories/search", async (req, res) => {
  try {
    const { query: searchQuery, areas, scope, tags, visibility, limit } = req.body as {
      query: string;
      areas?: string[];
      scope?: string | string[];
      tags?: string[];
      visibility?: string;
      limit?: number;
    };
    if (!searchQuery) {
      res.status(400).json({ error: "query is required" });
      return;
    }
    const results = await searchMemories(
      {
        query: searchQuery,
        areas: areas as any,
        scope: scope || undefined,
        tags: tags || undefined,
        visibility: (visibility as any) || undefined,
        limit: limit || 10,
      },
      config,
    );
    res.json({
      results: results.map((r) => ({
        id: r.memory.id,
        area: r.matchedArea,
        content: r.memory.content,
        summary: r.memory.summary,
        tags: r.memory.tags,
        confidence: r.memory.confidence,
        scope: r.memory.scope,
        visibility: r.memory.visibility,
        score: Math.round(r.score * 1000) / 1000,
        source: r.memory.source,
        createdAt: r.memory.createdAt,
      })),
    });
  } catch (err) {
    console.error("Memory search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

// GET /api/documents/search — search indexed documents
app.get("/api/documents/search", async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q) {
      res.status(400).json({ error: "q parameter required" });
      return;
    }
    const limit = Number(req.query.limit) || 10;
    const result = await query(
      `SELECT d.id, d.title, d.path, d.source, c.content, c.chunk_index,
              ts_rank(c.fts, websearch_to_tsquery('english', $1)) AS rank
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.fts @@ websearch_to_tsquery('english', $1)
       ORDER BY rank DESC
       LIMIT $2`,
      [q, limit],
    );
    res.json({ results: result.rows });
  } catch (err) {
    console.error("Document search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

// ─── Obsidian Sync API ───

app.get("/api/obsidian/status", (_req, res) => {
  res.json({
    syncActive: isSyncActive(),
    vaultPath: config.obsidian.vaultPath || null,
    syncEnabled: config.obsidian.syncEnabled,
  });
});

app.post("/api/obsidian/sync", async (_req, res) => {
  try {
    if (!config.obsidian.vaultPath) {
      res.status(400).json({ error: "No vault path configured. Set it in Settings." });
      return;
    }
    const result = await fullSync(config);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/obsidian/watch/start", (_req, res) => {
  try {
    startWatching(config);
    res.json({ watching: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/obsidian/watch/stop", (_req, res) => {
  stopWatching();
  res.json({ watching: false });
});

// ─── Outline Sync API ───

app.use("/api/webhooks", createMediaWebhookRouter(config));
app.use("/api/webhooks/outline", createOutlineWebhookRouter(config));

app.get("/api/outline/status", async (_req, res) => {
  try {
    const status = await getSyncStatus();
    res.json({ ...status, syncEnabled: config.outline.syncEnabled });
  } catch {
    res.json({ total: 0, synced: 0, conflicted: 0, deleted: 0, lastSyncAt: null, syncEnabled: config.outline.syncEnabled });
  }
});

app.post("/api/outline/sync", async (_req, res) => {
  try {
    const result = await fullOutlineSync(config);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/outline/scan", async (_req, res) => {
  try {
    const result = await scanObsidianToOutline(config);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get("/api/outline/conflicts", async (_req, res) => {
  try {
    const conflicts = await getConflicts();
    res.json({ conflicts });
  } catch {
    res.json({ conflicts: [] });
  }
});

app.post("/api/outline/conflicts/:id/resolve", async (req, res) => {
  try {
    const { resolution } = req.body as { resolution: "keep_obsidian" | "keep_outline" };
    if (!resolution || !["keep_obsidian", "keep_outline"].includes(resolution)) {
      res.status(400).json({ error: "resolution must be 'keep_obsidian' or 'keep_outline'" });
      return;
    }
    await resolveConflict(req.params.id, resolution, config);
    res.json({ resolved: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// GET /api/memories/flushes — list context flush events
app.get("/api/memories/flushes", async (_req, res) => {
  try {
    const result = await query(
      `SELECT m.id, m.area, m.content, m.summary, m.confidence, m.conversation_id,
              m.created_at, c.title AS conversation_title
       FROM memories m
       LEFT JOIN conversations c ON c.id = m.conversation_id
       WHERE m.source = 'flush'
       ORDER BY m.created_at DESC
       LIMIT 50`,
    );

    const stats = await query<{
      total_flushes: number;
      conversations_flushed: number;
      last_flush_at: string | null;
    }>(
      `SELECT count(*)::int AS total_flushes,
              count(DISTINCT conversation_id)::int AS conversations_flushed,
              max(created_at) AS last_flush_at
       FROM memories WHERE source = 'flush'`,
    );

    res.json({ flushes: result.rows, stats: stats.rows[0] });
  } catch (err) {
    console.error("Failed to list flushes:", err);
    res.status(500).json({ error: "Failed to list flushes" });
  }
});

// GET /api/documents — list indexed documents
app.get("/api/documents", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 1000, 5000);
    const countOnly = req.query.count === "true";

    if (countOnly) {
      const result = await query<{ source: string; count: number }>(
        "SELECT source, count(*)::int AS count FROM documents GROUP BY source",
      );
      const total = result.rows.reduce((sum, r) => sum + r.count, 0);
      res.json({ total, bySource: Object.fromEntries(result.rows.map(r => [r.source, r.count])) });
      return;
    }

    const result = await query(
      `SELECT id, source, path, title, embedded_at, created_at, updated_at,
              (SELECT count(*) FROM chunks c WHERE c.document_id = d.id)::int AS chunk_count
       FROM documents d
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit],
    );
    res.json({ documents: result.rows, total: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to list documents" });
  }
});

// GET /api/documents/:id — single document with chunks
app.get("/api/documents/:id", async (req, res) => {
  try {
    const docId = Number(req.params.id);
    const docResult = await query(
      "SELECT id, source, path, title, content, embedded_at, created_at, updated_at FROM documents WHERE id = $1",
      [docId],
    );
    if (docResult.rows.length === 0) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const doc = docResult.rows[0];
    const chunksResult = await query(
      `SELECT id, chunk_index, content, start_line, end_line,
              (embedding IS NOT NULL) AS has_embedding
       FROM chunks WHERE document_id = $1 ORDER BY chunk_index`,
      [docId],
    );
    res.json({ document: doc, chunks: chunksResult.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to load document" });
  }
});

// POST /api/documents/ingest — manually ingest a document
app.post("/api/documents/ingest", async (req, res) => {
  try {
    const { title, content, source, path: docPath } = req.body;
    if (!title || !content) {
      res.status(400).json({ error: "title and content required" });
      return;
    }
    const result = await ingestDocument({
      source: source || "manual",
      path: docPath,
      title,
      content,
      config,
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Google OAuth API (multi-account) ───

import {
  getAuthUrl, handleCallback, isAuthenticated, setPublicUrl,
  listGoogleAccounts, createGoogleAccount, updateGoogleAccount,
  deleteGoogleAccount, migrateFileTokensToDb,
} from "./google/auth.js";

// Configure Google OAuth with public URL if set
setPublicUrl(config.gateway.publicUrl);

// Legacy compat: GET /api/google/status
app.get("/api/google/status", async (_req, res) => {
  try {
    res.json({ authenticated: await isAuthenticated() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// List all Google accounts
app.get("/api/google/accounts", async (_req, res) => {
  try {
    const accounts = await listGoogleAccounts();
    res.json({ accounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Create a new Google account entry (status: pending)
app.post("/api/google/accounts", async (req, res) => {
  try {
    const { id, display_name } = req.body as { id?: string; display_name?: string };
    if (!display_name) {
      res.status(400).json({ error: "display_name is required" });
      return;
    }
    const slug = (id || display_name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!slug) {
      res.status(400).json({ error: "Invalid id/display_name" });
      return;
    }
    const account = await createGoogleAccount(slug, display_name);
    res.json(account);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("duplicate key") ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

// Update a Google account (display_name, is_default)
app.put("/api/google/accounts/:id", async (req, res) => {
  try {
    const { display_name, is_default } = req.body as {
      display_name?: string;
      is_default?: boolean;
    };
    const account = await updateGoogleAccount(req.params.id, { display_name, is_default });
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    broadcast("google.status", { accountId: account.id, status: account.status, account });
    res.json(account);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Delete a Google account
app.delete("/api/google/accounts/:id", async (req, res) => {
  try {
    await deleteGoogleAccount(req.params.id);
    broadcast("google.status", { accountId: req.params.id, status: "deleted" });
    res.json({ deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Start OAuth flow for a specific account
app.get("/api/google/accounts/:id/auth", (req, res) => {
  try {
    const url = getAuthUrl(req.params.id);
    res.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// OAuth callback — reads account ID from state parameter
app.get("/api/google/callback", async (req, res) => {
  try {
    const code = req.query.code as string;
    const accountId = req.query.state as string;
    if (!code) {
      res.status(400).json({ error: "Missing code parameter" });
      return;
    }
    if (!accountId) {
      res.status(400).json({ error: "Missing state parameter (account ID)" });
      return;
    }
    const account = await handleCallback(code, accountId);
    broadcast("google.status", { accountId: account.id, status: account.status, account });
    res.send(`<html><body><h1>Google Authentication Successful</h1><p>${account.email || account.display_name} connected. You can close this window.</p></body></html>`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Inbox Rules API ───

app.get("/api/inbox/rules/summary", async (_req, res) => {
  try {
    const result = await query<{
      total_active: number;
      auto_approve_active: number;
      channel_scoped: number;
      sender_scoped: number;
      keyword_scoped: number;
      semantic_only: number;
      total_hits: number;
      last_hit_at: string | null;
    }>(
      `WITH rules AS (
         SELECT o.data
         FROM store_objects o
         WHERE o.collection_id = (
           SELECT id FROM store_collections WHERE name = 'Inbox Rules' LIMIT 1
         )
           AND o.status = 'active'
       )
       SELECT
         count(*)::int AS total_active,
         count(*) FILTER (
           WHERE COALESCE((data->>'auto_approve')::boolean, false)
         )::int AS auto_approve_active,
         count(*) FILTER (
           WHERE COALESCE(NULLIF(BTRIM(data->>'match_channel'), ''), 'any') <> 'any'
         )::int AS channel_scoped,
         count(*) FILTER (
           WHERE COALESCE(NULLIF(BTRIM(data->>'match_sender'), ''), '') <> ''
         )::int AS sender_scoped,
         count(*) FILTER (
           WHERE COALESCE(NULLIF(BTRIM(data->>'match_keywords'), ''), '') <> ''
         )::int AS keyword_scoped,
         count(*) FILTER (
           WHERE COALESCE(NULLIF(BTRIM(data->>'match_sender'), ''), '') = ''
             AND COALESCE(NULLIF(BTRIM(data->>'match_keywords'), ''), '') = ''
             AND COALESCE(NULLIF(BTRIM(data->>'match_channel'), ''), 'any') = 'any'
         )::int AS semantic_only,
         COALESCE(
           sum(
             CASE
               WHEN COALESCE(data->>'hit_count', '') ~ '^[0-9]+$'
                 THEN (data->>'hit_count')::int
               ELSE 0
             END
           ),
           0
         )::int AS total_hits,
         max(
           CASE
             WHEN COALESCE(data->>'last_hit_at', '') <> ''
               THEN (data->>'last_hit_at')::timestamptz
             ELSE NULL
           END
         )::text AS last_hit_at
       FROM rules`,
    );

    const row = result.rows[0] || {
      total_active: 0,
      auto_approve_active: 0,
      channel_scoped: 0,
      sender_scoped: 0,
      keyword_scoped: 0,
      semantic_only: 0,
      total_hits: 0,
      last_hit_at: null,
    };
    res.json(row);
  } catch (err) {
    console.error("Failed to load inbox rules summary:", err);
    res.status(500).json({
      total_active: 0,
      auto_approve_active: 0,
      channel_scoped: 0,
      sender_scoped: 0,
      keyword_scoped: 0,
      semantic_only: 0,
      total_hits: 0,
      last_hit_at: null,
    });
  }
});

// ─── Review Queue API ───

app.get("/api/reviews", async (req, res) => {
  try {
    const status = (req.query.status as string | undefined) || "pending";
    const agentId = req.query.agent_id as string | undefined;
    const tag = req.query.tag as string | undefined;
    const type = req.query.type as string | undefined;
    const minPriorityRaw = Number(req.query.min_priority);
    const maxPriorityRaw = Number(req.query.max_priority);
    const minPriority = Number.isFinite(minPriorityRaw) ? Math.max(0, Math.min(10, Math.floor(minPriorityRaw))) : null;
    const maxPriority = Number.isFinite(maxPriorityRaw) ? Math.max(0, Math.min(10, Math.floor(maxPriorityRaw))) : null;
    const maxAgeDaysRaw = Number(req.query.max_age_days);
    const maxAgeDays = Number.isFinite(maxAgeDaysRaw) && maxAgeDaysRaw > 0 ? Math.min(maxAgeDaysRaw, 365) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (status && status !== "all") {
      if (status === "approved") {
        conditions.push(`status IN ('approved', 'modified')`);
      } else {
        conditions.push(`status = $${idx++}`);
        params.push(status);
      }
    }
    if (agentId) {
      conditions.push(`agent_id = $${idx++}`);
      params.push(agentId);
    }
    if (type) {
      conditions.push(`type = $${idx++}`);
      params.push(type);
    }
    if (tag) {
      conditions.push(`$${idx++} = ANY(tags)`);
      params.push(tag);
    }
    if (minPriority !== null) {
      conditions.push(`priority >= $${idx++}`);
      params.push(minPriority);
    }
    if (maxPriority !== null) {
      conditions.push(`priority <= $${idx++}`);
      params.push(maxPriority);
    }
    if (maxAgeDays !== null) {
      conditions.push(`created_at >= NOW() - make_interval(days := $${idx++}::int)`);
      params.push(Math.floor(maxAgeDays));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const limitParam = idx++;
    params.push(offset);
    const offsetParam = idx++;

    const result = await query(
      `SELECT id, agent_id, conversation_id, type, title, description,
              content, proposed_action, alternatives,
              status, resolution, resolved_by, resolved_at,
              priority, tags, batch_id, created_at
       FROM review_queue
       ${where}
       ORDER BY
         CASE status WHEN 'pending' THEN 0 ELSE 1 END,
         priority DESC,
         created_at DESC
       LIMIT $${limitParam}
       OFFSET $${offsetParam}`,
      params,
    );
    res.json({ reviews: result.rows });
  } catch (err) {
    console.error("Failed to list reviews:", err);
    res.status(500).json({ error: "Failed to list reviews" });
  }
});

app.get("/api/reviews/:id", async (req, res) => {
  try {
    const result = await query(
      "SELECT * FROM review_queue WHERE id = $1",
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Review not found" });
      return;
    }
    res.json({ review: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to get review" });
  }
});

app.put("/api/reviews/:id/resolve", async (req, res) => {
  try {
    const { status, resolution, resolved_by } = req.body as {
      status: "approved" | "rejected" | "modified";
      resolution?: unknown;
      resolved_by?: string;
    };

    if (!status || !["approved", "rejected", "modified"].includes(status)) {
      res.status(400).json({ error: "status must be 'approved', 'rejected', or 'modified'" });
      return;
    }

    // Fetch the review before updating (need type + conversation_id for triage handling + learning)
    const reviewResult = await query<{
      agent_id: string;
      type: string;
      conversation_id: string | null;
      proposed_action: unknown;
      title: string;
      description: string | null;
      content: unknown;
    }>(
      "SELECT agent_id, type, conversation_id, proposed_action, title, description, content FROM review_queue WHERE id = $1",
      [req.params.id],
    );
    const row = reviewResult.rows[0];
    if (!row) {
      res.status(404).json({ error: "Review not found" });
      return;
    }

    const resolvedBy = resolved_by || "human";
    const isFactVerify = isVerifyFactReview(row.type, row.proposed_action);
    const isSoulUpdate = isSoulUpdateReview(row.type, row.proposed_action);
    const effectiveResolution = status === "rejected"
      ? (resolution ?? null)
      : (resolution ?? row.proposed_action ?? null);
    const soulResult = isSoulUpdate && (status === "approved" || status === "modified")
      ? await applySoulReviewResolution({
          reviewId: req.params.id,
          status,
          resolution: effectiveResolution,
          proposedAction: row.proposed_action,
          resolvedBy,
          fallbackAgentId: row.agent_id,
        })
      : null;

    const persistedResolution = status === "rejected"
      ? (resolution ?? null)
      : (soulResult?.action ?? effectiveResolution ?? null);

    await query(
      `UPDATE review_queue
       SET status = $1, resolution = $2, resolved_by = $3, resolved_at = NOW()
       WHERE id = $4`,
      [status, persistedResolution ? JSON.stringify(persistedResolution) : null, resolvedBy, req.params.id],
    );

    // Broadcast resolution to agents waiting on it
    broadcast("review.resolved", {
      id: req.params.id,
      status,
      resolution: persistedResolution,
      resolvedBy,
      soul: soulResult
        ? {
            agentId: soulResult.agentId,
            versionId: soulResult.version?.id || null,
            rolloutId: soulResult.rollout?.id || null,
            rolloutMode: soulResult.rolloutMode,
            qualityStatus: soulResult.quality.status,
            qualityRunId: soulResult.quality.run?.id || null,
            qualitySuiteId: soulResult.quality.suiteId,
          }
        : null,
    });

    // Handle triage review actions
    if (row?.type === "triage" && row.conversation_id) {
      if (status === "approved" || status === "modified") {
        const actions = (persistedResolution || row.proposed_action) as import("./channels/triage.js").TriageAction[] | null;
        if (actions && Array.isArray(actions)) {
          executeTriageActions(req.params.id, row.conversation_id, actions, broadcast)
            .catch((err) => console.error("[Reviews] Triage action execution failed:", err));
        }
      } else if (status === "rejected") {
        handleTriageRejection(req.params.id, row.conversation_id)
          .catch((err) => console.error("[Reviews] Triage rejection handling failed:", err));
      }
    }

    if (isFactVerify) {
      applyFactReviewResolution({
        status,
        resolution: persistedResolution,
        proposedAction: row.proposed_action,
        resolvedBy,
      }).catch((err) => console.warn("[Reviews] Fact verification apply failed:", err));
    }

    // Fire-and-forget: learning pipeline
    if (row && !isFactVerify) {
      processFeedback(
        {
          reviewId: req.params.id,
          signal: status,
          domain: row.type || "other",
          conversationId: row.conversation_id,
          title: row.title,
          description: row.description,
          contentBlocks: row.content,
          proposedAction: row.proposed_action,
          resolution: persistedResolution,
        },
        config,
      ).catch((err) => console.warn("[Learner]", err));
    }

    res.json({
      resolved: true,
      soul: soulResult
        ? {
            applied: true,
            agentId: soulResult.agentId,
            versionId: soulResult.version?.id || null,
            rolloutId: soulResult.rollout?.id || null,
            rolloutStatus: soulResult.rollout?.status || null,
            rolloutMode: soulResult.rolloutMode,
            validation: soulResult.validation,
            quality: {
              status: soulResult.quality.status,
              suiteId: soulResult.quality.suiteId,
              runId: soulResult.quality.run?.id || null,
              failed: soulResult.quality.run?.failed ?? null,
              errored: soulResult.quality.run?.errored ?? null,
              skippedReason: soulResult.quality.skippedReason,
            },
          }
        : null,
    });
  } catch (err) {
    console.error("Failed to resolve review:", err);
    const message = err instanceof Error ? err.message : "Failed to resolve review";
    const isUserInputError = err instanceof Error
      && /(validation|quality|must include|not found|does not belong|disabled|failed)/i.test(err.message);
    res.status(isUserInputError ? 400 : 500).json({ error: message });
  }
});

app.get("/api/reviews/stats/summary", async (_req, res) => {
  try {
    const result = await query(
      `SELECT status, count(*)::int AS count
       FROM review_queue
       GROUP BY status
       ORDER BY status`,
    );
    res.json({ stats: result.rows });
  } catch {
    res.json({ stats: [] });
  }
});

// ─── Cron API ───

app.get("/api/cron", async (_req, res) => {
  try {
    const jobs = await listJobs();
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ error: "Failed to list cron jobs" });
  }
});

app.post("/api/cron", async (req, res) => {
  try {
    const job = await createJob(req.body);
    res.json({ job });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

app.put("/api/cron/:id", async (req, res) => {
  try {
    const job = await updateJob(req.params.id, req.body);
    res.json({ job });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.put("/api/cron/:id/toggle", async (req, res) => {
  try {
    const { enabled } = req.body;
    await toggleJob(req.params.id, enabled);
    res.json({ toggled: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to toggle job" });
  }
});

app.get("/api/cron/:id/runs", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const runs = await listJobRuns(req.params.id, limit);
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: "Failed to list job runs" });
  }
});

app.post("/api/cron/:id/run", async (req, res) => {
  try {
    const jobs = await listJobs();
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }
    // Run in background, don't await
    executeJobNow(job).catch((err: unknown) => console.error("[Cron] Manual run failed:", err));
    res.json({ triggered: true, name: job.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Self-Repair API ───

app.get("/api/self-repair/reports", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const statusFilter = req.query.status as string | undefined;
    const where = statusFilter ? "WHERE status = $2" : "";
    const params: unknown[] = [limit];
    if (statusFilter) params.push(statusFilter);
    const result = await query(
      `SELECT * FROM self_repair_runs ${where} ORDER BY created_at DESC LIMIT $1`,
      params,
    );
    res.json({ reports: result.rows });
  } catch {
    res.json({ reports: [] });
  }
});

app.post("/api/self-repair/run", async (_req, res) => {
  try {
    runSelfRepair(config).catch((err: unknown) => console.error("[SelfRepair] Manual run failed:", err));
    res.json({ triggered: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Skills API ───

app.get("/api/skills", async (_req, res) => {
  try {
    const result = await query<RegistrySkillRow>(
      "SELECT id, name, description, source, path, enabled, agent_ids, created_at FROM skills_registry ORDER BY source, name",
    );
    const dbSkills = mapRegistryRowsToCatalog(result.rows);
    const dbNames = new Set(result.rows.map((s) => s.name));
    const externalSkills = listExternalSkillCatalog({ excludeNames: dbNames });
    const skills = [...dbSkills, ...externalSkills];
    res.json({ skills, summary: summarizeSkillCatalog(skills) });
  } catch {
    res.json({
      skills: [],
      summary: { total: 0, byKind: {}, bySource: {}, byRuntime: {}, byScope: {} },
    });
  }
});

app.put("/api/skills/:id/toggle", async (req, res) => {
  try {
    const { enabled } = req.body;
    await query("UPDATE skills_registry SET enabled = $1, updated_at = NOW() WHERE id = $2", [enabled, req.params.id]);
    res.json({ toggled: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to toggle skill" });
  }
});

// ─── Skill Content API ───

app.get("/api/skills/:name/content", async (req, res) => {
  try {
    const skillName = req.params.name;
    const source = typeof req.query.source === "string" ? req.query.source : undefined;
    const externalSourceRequested = source === "claude-code" || source === "gemini" || source?.startsWith("codex");

    const externalSkillPath = resolveSkillPathByName(skillName, source);
    if (externalSkillPath && fs.existsSync(externalSkillPath)) {
      const content = fs.readFileSync(externalSkillPath, "utf-8");
      res.json({ content, path: externalSkillPath });
      return;
    }

    if (externalSourceRequested) {
      res.status(404).json({ error: `No SKILL.md found for '${skillName}' in source '${source}'` });
      return;
    }

    // Check if the skill has a path stored in the DB
    const dbResult = await query<{ path: string | null }>(
      "SELECT path FROM skills_registry WHERE name = $1 LIMIT 1", [skillName],
    );
    const dbPath = dbResult.rows[0]?.path;
    if (dbPath && fs.existsSync(dbPath)) {
      const content = fs.readFileSync(dbPath, "utf-8");
      res.json({ content, path: dbPath });
      return;
    }

    res.status(404).json({ error: "No SKILL.md found — this is a built-in gateway tool" });
  } catch (err) {
    res.status(500).json({ error: "Failed to read skill content" });
  }
});

app.put("/api/skills/:name/content", async (req, res) => {
  try {
    const skillName = req.params.name;
    const { content } = req.body;
    if (typeof content !== "string") {
      res.status(400).json({ error: "content is required" });
      return;
    }
    const source = typeof req.query.source === "string" ? req.query.source : undefined;
    const externalSourceRequested = source === "claude-code" || source === "gemini" || source?.startsWith("codex");

    const externalSkillPath = resolveSkillPathByName(skillName, source);
    if (externalSkillPath && fs.existsSync(externalSkillPath)) {
      fs.writeFileSync(externalSkillPath, content, "utf-8");
      res.json({ saved: true, path: externalSkillPath });
      return;
    }

    if (externalSourceRequested) {
      res.status(404).json({ error: `No SKILL.md found for '${skillName}' in source '${source}'` });
      return;
    }

    // Check DB path
    const dbResult = await query<{ path: string | null }>(
      "SELECT path FROM skills_registry WHERE name = $1 LIMIT 1", [skillName],
    );
    const dbPath = dbResult.rows[0]?.path;
    if (dbPath && fs.existsSync(dbPath)) {
      fs.writeFileSync(dbPath, content, "utf-8");
      res.json({ saved: true, path: dbPath });
      return;
    }

    res.status(404).json({ error: "No SKILL.md found to write to" });
  } catch (err) {
    res.status(500).json({ error: "Failed to save skill content" });
  }
});

// ─── Claude Code Skills (on disk) ───

app.get("/api/claude-skills", (_req, res) => {
  try {
    const home = process.env.HOME || "/tmp";
    const skillsDir = path.resolve(home, ".claude/skills");
    if (!fs.existsSync(skillsDir)) {
      res.json({ skills: [] });
      return;
    }
    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => {
        if (d.isDirectory()) return true;
        if (d.isSymbolicLink()) {
          try { return fs.statSync(path.join(skillsDir, d.name)).isDirectory(); } catch { return false; }
        }
        return false;
      })
      .map((d) => {
        const mdPath = path.join(skillsDir, d.name, "SKILL.md");
        const hasMd = fs.existsSync(mdPath);
        return { name: d.name, path: mdPath, hasContent: hasMd };
      });
    res.json({ skills: dirs });
  } catch {
    res.json({ skills: [] });
  }
});

app.get("/api/codex-skills", (_req, res) => {
  try {
    const skills = listExternalSkillCatalog()
      .filter((entry) => entry.source.startsWith("codex"))
      .map((entry) => ({
        name: entry.name,
        source: entry.source,
        scope: entry.scope,
        path: entry.path,
        hasContent: Boolean(entry.path),
      }));
    res.json({ skills });
  } catch {
    res.json({ skills: [] });
  }
});

app.get("/api/gemini-skills", (_req, res) => {
  try {
    const skills = listExternalSkillCatalog()
      .filter((entry) => entry.source === "gemini")
      .map((entry) => ({
        name: entry.name,
        source: entry.source,
        scope: entry.scope,
        path: entry.path,
        hasContent: Boolean(entry.path),
      }));
    res.json({ skills });
  } catch {
    res.json({ skills: [] });
  }
});

// ─── Soul Document API ───

app.get("/api/soul/schema", (_req, res) => {
  res.json(getSoulSpecSummary());
});

app.get("/api/soul/policy", (_req, res) => {
  res.json({ policy: SOUL_ROLLOUT_POLICY });
});

app.get("/api/soul/governance/summary", async (_req, res) => {
  try {
    const summary = await getSoulGovernanceSummary();
    res.json({ summary, policy: SOUL_ROLLOUT_POLICY });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load soul governance summary.";
    res.status(500).json({ error: message });
  }
});

app.get("/api/soul/rollouts", async (req, res) => {
  try {
    const agentId = normalizeOptionalString(req.query.agentId);
    const status = normalizeOptionalString(req.query.status);
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    const rollouts = await listSoulRollouts({
      agentId,
      status: status as SoulRolloutStatus | "all" | null,
      limit,
    });
    res.json({ rollouts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list soul rollouts.";
    res.status(500).json({ error: message });
  }
});

app.post("/api/soul/rollouts/:rolloutId/evaluate", async (req, res) => {
  try {
    const rolloutId = String(req.params.rolloutId || "").trim();
    if (!rolloutId) {
      return res.status(400).json({ error: "rolloutId is required" });
    }
    const applyDecision = req.body?.applyDecision !== false;
    const evaluation = await evaluateSoulRollout(rolloutId, { applyDecision });
    const rollout = await getSoulRollout(rolloutId);
    res.json({
      ok: true,
      evaluation,
      rollout,
      policy: SOUL_ROLLOUT_POLICY,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to evaluate soul rollout.";
    const isUserInputError = err instanceof Error
      && /(not found|not active|must|without)/i.test(err.message);
    res.status(isUserInputError ? 400 : 500).json({ error: message });
  }
});

app.post("/api/soul/rollouts/:rolloutId/promote", async (req, res) => {
  try {
    const rolloutId = String(req.params.rolloutId || "").trim();
    if (!rolloutId) {
      return res.status(400).json({ error: "rolloutId is required" });
    }
    const reason = normalizeOptionalString(req.body?.reason) || "Manual promotion";
    const rollout = await promoteSoulRollout(rolloutId, reason);
    res.json({ ok: true, rollout });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to promote soul rollout.";
    const isUserInputError = err instanceof Error && /(not found|not active)/i.test(err.message);
    res.status(isUserInputError ? 400 : 500).json({ error: message });
  }
});

app.post("/api/soul/rollouts/:rolloutId/rollback", async (req, res) => {
  try {
    const rolloutId = String(req.params.rolloutId || "").trim();
    if (!rolloutId) {
      return res.status(400).json({ error: "rolloutId is required" });
    }
    const reason = normalizeOptionalString(req.body?.reason) || "Manual rollback";
    const rollout = await rollbackSoulRollout(rolloutId, reason);
    res.json({ ok: true, rollout });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to rollback soul rollout.";
    const isUserInputError = err instanceof Error && /(not found|not active)/i.test(err.message);
    res.status(isUserInputError ? 400 : 500).json({ error: message });
  }
});

app.post("/api/soul/rollouts/:rolloutId/cancel", async (req, res) => {
  try {
    const rolloutId = String(req.params.rolloutId || "").trim();
    if (!rolloutId) {
      return res.status(400).json({ error: "rolloutId is required" });
    }
    const rollout = await getSoulRollout(rolloutId);
    if (!rollout) {
      return res.status(404).json({ error: `Soul rollout "${rolloutId}" not found.` });
    }
    if (rollout.status !== "canary_active") {
      return res.status(409).json({ error: `Soul rollout "${rolloutId}" is not active (status=${rollout.status}).` });
    }
    const reason = normalizeOptionalString(req.body?.reason) || "Manual cancellation";
    await cancelActiveSoulRolloutForAgent(rollout.agent_id, reason);
    const refreshed = await getSoulRollout(rolloutId);
    res.json({ ok: true, rollout: refreshed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to cancel soul rollout.";
    res.status(500).json({ error: message });
  }
});

app.post("/api/soul/rollouts/evaluate-all", async (req, res) => {
  try {
    const applyDecision = req.body?.applyDecision !== false;
    const limit = Math.max(1, Math.min(Number(req.body?.limit) || 100, 300));
    const evaluations = await evaluateAllActiveSoulRollouts({ applyDecision, limit });
    res.json({
      ok: true,
      count: evaluations.length,
      evaluations,
      policy: SOUL_ROLLOUT_POLICY,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to evaluate active soul rollouts.";
    res.status(500).json({ error: message });
  }
});

app.post("/api/soul/validate", (req, res) => {
  const content = String(req.body?.content || "");
  const validation = validateSoulDocument(content);
  res.json({ validation });
});

app.get("/api/soul", (_req, res) => {
  try {
    const soul = readGlobalSoulDocument();
    const validation = validateSoulDocument(soul.content);
    res.json({
      content: soul.content,
      path: soul.path,
      source: soul.source,
      validation,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to read soul.md" });
  }
});

app.put("/api/soul", (req, res) => {
  try {
    const content = String(req.body?.content || "").trim();
    const enforceValidation = req.body?.enforceValidation !== false;
    if (!content) {
      return res.status(400).json({ error: "content is required" });
    }

    const validation = validateSoulDocument(content);
    if (enforceValidation && !validation.valid) {
      return res.status(400).json({
        error: "Global soul document failed validation.",
        validation,
      });
    }

    const soulPath = getGlobalSoulPath();
    fs.writeFileSync(soulPath, `${content}\n`, "utf-8");
    res.json({
      ok: true,
      path: soulPath,
      content: `${content}\n`,
      validation,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to write soul.md" });
  }
});

app.get("/api/souls", async (_req, res) => {
  try {
    const { rows } = await query<AgentSoulRecord>(
      "SELECT id, name, description, model, skills FROM agents ORDER BY name",
    );

    const souls: Record<string, {
      content: string;
      path: string;
      created: boolean;
      validation: ReturnType<typeof validateSoulDocument>;
      activeVersionId: string | null;
      activeRolloutId: string | null;
    }> = {};
    for (const agent of rows) {
      const soul = ensureAgentSoulDocument({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        model: agent.model,
        skills: agent.skills,
      });
      const validation = validateSoulDocument(soul.content);
      const activeVersion = await ensureSoulVersion(agent.id, soul.content);
      const activeRollout = await getActiveSoulRolloutForAgent(agent.id);

      souls[agent.id] = {
        ...soul,
        validation,
        activeVersionId: activeVersion?.id || null,
        activeRolloutId: activeRollout?.id || null,
      };
    }

    res.json({ souls });
  } catch {
    res.status(500).json({ error: "Failed to load agent soul documents." });
  }
});

app.get("/api/soul/:agentId", async (req, res) => {
  try {
    const agentId = String(req.params.agentId || "").trim();
    if (!agentId) {
      return res.status(400).json({ error: "agentId is required" });
    }

    const agent = await loadAgentSoulRecord(agentId);
    if (!agent) {
      return res.status(404).json({ error: `Agent "${agentId}" not found.` });
    }

    const soul = ensureAgentSoulDocument({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      model: agent.model,
      skills: agent.skills,
    });
    const validation = validateSoulDocument(soul.content);
    const activeVersion = await ensureSoulVersion(agent.id, soul.content);
    const activeRollout = await getActiveSoulRolloutForAgent(agent.id);

    res.json({
      agentId: agent.id,
      content: soul.content,
      path: soul.path,
      created: soul.created,
      validation,
      activeVersion,
      activeRollout,
    });
  } catch (err) {
    console.error("Failed to load agent soul document:", err);
    res.status(500).json({ error: "Failed to load agent soul document." });
  }
});

app.put("/api/soul/:agentId", async (req, res) => {
  try {
    const agentId = String(req.params.agentId || "").trim();
    if (!agentId) {
      return res.status(400).json({ error: "agentId is required" });
    }
    const content = String(req.body?.content || "").trim();
    if (!content) {
      return res.status(400).json({ error: "content is required" });
    }

    const agent = await loadAgentSoulRecord(agentId);
    if (!agent) {
      return res.status(404).json({ error: `Agent "${agentId}" not found.` });
    }

    const validation = validateSoulDocument(content);
    const enforceValidation = req.body?.enforceValidation !== false;
    if (enforceValidation && !validation.valid) {
      return res.status(400).json({
        error: "Soul document failed validation.",
        validation,
      });
    }

    const requestedSuiteId = normalizeOptionalString(req.body?.qualitySuiteId);
    const runQualityGate = req.body?.runQualityGate === true;
    const quality = await runSoulQualityGate({
      agentId,
      requestedSuiteId,
      runQualityGate,
      triggeredBy: `soul:manual:${agentId}`,
    });
    if (runQualityGate && quality.status !== "passed") {
      return res.status(409).json({
        error: quality.skippedReason || "Soul quality gate failed.",
        validation,
        quality,
      });
    }

    const currentSoul = ensureAgentSoulDocument(agent);
    let activeVersion = await getActiveSoulVersion(agent.id);
    if (!activeVersion) {
      activeVersion = await ensureSoulVersion(agent.id, currentSoul.content);
    }

    const saved = writeAgentSoulDocument(agentId, content);
    const source = normalizeOptionalString(req.body?.source) || "manual";
    const author = normalizeOptionalString(req.body?.author) || "human";
    const reviewId = normalizeOptionalString(req.body?.reviewId);
    const changeSummary = normalizeOptionalString(req.body?.changeSummary)
      || normalizeOptionalString(req.body?.summary);
    const metadata = asRecord(req.body?.metadata);
    await cancelActiveSoulRolloutForAgent(agentId, "Cancelled by manual soul update");

    const version = await createSoulVersion({
      agentId,
      content: saved.content,
      source,
      author,
      reviewId,
      qualityRunId: quality.run?.id || null,
      qualityStatus: quality.status,
      changeSummary,
      parentVersionId: activeVersion?.id || null,
      metadata: {
        ...(metadata || {}),
        runQualityGate,
        qualitySuiteId: quality.suiteId,
      },
      activate: true,
    });

    res.json({
      ok: true,
      agentId,
      content: saved.content,
      path: saved.path,
      validation,
      quality,
      version,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to write agent soul document.";
    res.status(500).json({ error: message });
  }
});

app.get("/api/soul/:agentId/versions", async (req, res) => {
  try {
    const agentId = String(req.params.agentId || "").trim();
    if (!agentId) {
      return res.status(400).json({ error: "agentId is required" });
    }

    const agent = await loadAgentSoulRecord(agentId);
    if (!agent) {
      return res.status(404).json({ error: `Agent "${agentId}" not found.` });
    }

    const limit = Math.max(1, Math.min(Number(req.query.limit) || 25, 200));
    const soul = ensureAgentSoulDocument(agent);
    await ensureSoulVersion(agentId, soul.content);
    const versions = await listSoulVersions(agentId, limit);
    const activeVersion = versions.find((version) => version.is_active) || null;
    const activeRollout = await getActiveSoulRolloutForAgent(agentId);
    res.json({ agentId, activeVersionId: activeVersion?.id || null, activeRollout, versions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load soul versions.";
    res.status(500).json({ error: message });
  }
});

app.post("/api/soul/:agentId/rollback", async (req, res) => {
  try {
    const agentId = String(req.params.agentId || "").trim();
    const versionId = normalizeOptionalString(req.body?.versionId);
    if (!agentId) return res.status(400).json({ error: "agentId is required" });
    if (!versionId) return res.status(400).json({ error: "versionId is required" });

    const agent = await loadAgentSoulRecord(agentId);
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found.` });

    const currentSoul = ensureAgentSoulDocument(agent);
    let activeVersion = await getActiveSoulVersion(agent.id);
    if (!activeVersion) {
      activeVersion = await ensureSoulVersion(agent.id, currentSoul.content);
    }

    const targetVersion = await getSoulVersionById(agentId, versionId);
    if (!targetVersion) {
      return res.status(404).json({ error: `Soul version "${versionId}" not found for agent "${agentId}".` });
    }

    const validation = validateSoulDocument(targetVersion.content);
    if (!validation.valid) {
      return res.status(409).json({
        error: "Cannot rollback to an invalid soul version.",
        validation,
      });
    }

    const requestedSuiteId = normalizeOptionalString(req.body?.qualitySuiteId);
    const runQualityGate = req.body?.runQualityGate === true;
    const quality = await runSoulQualityGate({
      agentId,
      requestedSuiteId,
      runQualityGate,
      triggeredBy: `soul:rollback:${agentId}:${versionId}`,
    });
    if (runQualityGate && quality.status !== "passed") {
      return res.status(409).json({
        error: quality.skippedReason || "Rollback quality gate failed.",
        validation,
        quality,
      });
    }

    await cancelActiveSoulRolloutForAgent(agentId, `Cancelled due to rollback to version ${versionId}`);
    const saved = writeAgentSoulDocument(agentId, targetVersion.content);
    const version = await createSoulVersion({
      agentId,
      content: saved.content,
      source: normalizeOptionalString(req.body?.source) || "rollback",
      author: normalizeOptionalString(req.body?.author) || "human",
      qualityRunId: quality.run?.id || null,
      qualityStatus: quality.status,
      changeSummary: normalizeOptionalString(req.body?.summary) || `Rollback to soul version ${versionId}`,
      parentVersionId: activeVersion?.id || null,
      metadata: {
        rollbackToVersionId: versionId,
        rollbackFromVersionId: activeVersion?.id || null,
        runQualityGate,
        qualitySuiteId: quality.suiteId,
      },
      activate: true,
    });

    res.json({
      ok: true,
      agentId,
      rolledBackToVersionId: versionId,
      validation,
      quality,
      version,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to rollback soul version.";
    res.status(500).json({ error: message });
  }
});

app.post("/api/soul/:agentId/propose", async (req, res) => {
  try {
    const agentId = String(req.params.agentId || "").trim();
    if (!agentId) return res.status(400).json({ error: "agentId is required" });

    const agent = await loadAgentSoulRecord(agentId);
    if (!agent) return res.status(404).json({ error: `Agent "${agentId}" not found.` });

    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(400).json({ error: "content is required" });

    const validation = validateSoulDocument(content);
    if (!validation.valid) {
      return res.status(400).json({
        error: "Proposed soul document failed validation.",
        validation,
      });
    }

    const currentSoul = ensureAgentSoulDocument(agent);
    const activeVersion = await ensureSoulVersion(agent.id, currentSoul.content);

    const requestedQualityGate = req.body?.runQualityGate !== false;
    const requestedSuiteId = normalizeOptionalString(req.body?.qualitySuiteId);
    const fallbackSuiteId = requestedQualityGate && !requestedSuiteId
      ? await findEnabledQualitySuiteForAgent(agentId)
      : null;
    const qualitySuiteId = requestedSuiteId || fallbackSuiteId;
    const rolloutTrafficPercent = normalizeOptionalNumber(req.body?.rolloutTrafficPercent);
    const rolloutMinimumSampleSize = normalizeOptionalNumber(req.body?.rolloutMinimumSampleSize);

    const action: ParsedSoulUpdateAction = {
      kind: "soul_update",
      agentId,
      content,
      summary: normalizeOptionalString(req.body?.summary),
      source: normalizeOptionalString(req.body?.source) || "proposal",
      author: normalizeOptionalString(req.body?.author) || "agent-social",
      runQualityGate: requestedQualityGate && Boolean(qualitySuiteId),
      qualitySuiteId: qualitySuiteId || null,
      metadata: asRecord(req.body?.metadata),
      baseVersionId: activeVersion?.id || null,
      rolloutTrafficPercent,
      rolloutMinimumSampleSize,
    };

    const qualityGateWarning = requestedQualityGate && !qualitySuiteId
      ? `No enabled quality suite found for "${agentId}", so this proposal will skip the quality gate unless a suite is set before approval.`
      : null;

    const tagsFromBody = Array.isArray(req.body?.tags)
      ? req.body.tags.filter((tag: unknown): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : [];
    const tags = Array.from(new Set(["soul", "governance", ...tagsFromBody]));
    const title = normalizeOptionalString(req.body?.title) || `Soul update proposal: ${agent.name || agent.id}`;
    const description = normalizeOptionalString(req.body?.description)
      || action.summary
      || qualityGateWarning
      || `Review and approve the proposed soul update for agent "${agent.id}".`;
    const priority = Number.isFinite(req.body?.priority) ? Number(req.body.priority) : 4;

    const reviewContent = [
      {
        type: "text",
        label: "Proposal Summary",
        content: description,
      },
      {
        type: "json",
        label: "Soul Validation",
        data: validation,
      },
      {
        type: "json",
        label: "Soul Proposal Metadata",
        data: {
          source: action.source,
          author: action.author,
          runQualityGate: action.runQualityGate,
          qualitySuiteId: action.qualitySuiteId,
          baseVersionId: action.baseVersionId,
          rolloutTrafficPercent: action.rolloutTrafficPercent ?? SOUL_ROLLOUT_POLICY.canary.defaultTrafficPercent,
          rolloutMinimumSampleSize: action.rolloutMinimumSampleSize ?? SOUL_ROLLOUT_POLICY.canary.minimumSampleSize,
          rolloutMode: SOUL_ROLLOUT_POLICY.canary.enabledByDefault ? "canary" : "direct",
          policyVersion: SOUL_ROLLOUT_POLICY.version,
        },
      },
      {
        type: "text",
        label: "Proposed Soul Document",
        content,
      },
    ];

    const review = await query<{ id: string }>(
      `INSERT INTO review_queue (
         agent_id, conversation_id, type, title, description,
         content, proposed_action, alternatives, priority, tags, batch_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9, $10)
       RETURNING id`,
      [
        agentId,
        null,
        "soul_update",
        title,
        description,
        JSON.stringify(reviewContent),
        JSON.stringify(action),
        priority,
        tags,
        normalizeOptionalString(req.body?.batch_id),
      ],
    );
    const reviewId = review.rows[0]?.id;

    if (reviewId) {
      broadcast("review.created", {
        id: reviewId,
        agentId,
        type: "soul_update",
        title,
        priority,
        tags,
      });
    }

    res.json({
      ok: true,
      reviewId,
      agentId,
      action,
      validation,
      policy: SOUL_ROLLOUT_POLICY,
      qualityGate: {
        requested: requestedQualityGate,
        runOnApprove: action.runQualityGate,
        qualitySuiteId: action.qualitySuiteId,
        warning: qualityGateWarning,
      },
      rollout: {
        mode: SOUL_ROLLOUT_POLICY.canary.enabledByDefault ? "canary" : "direct",
        trafficPercent: action.rolloutTrafficPercent ?? SOUL_ROLLOUT_POLICY.canary.defaultTrafficPercent,
        minimumSampleSize: action.rolloutMinimumSampleSize ?? SOUL_ROLLOUT_POLICY.canary.minimumSampleSize,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create soul proposal.";
    res.status(500).json({ error: message });
  }
});

// ─── Tasks API (Things3) ───

app.get("/api/tasks", (_req, res) => {
  try {
    const tasks = getActiveTasks();
    const grouped: Record<string, typeof tasks> = { inbox: [], today: [], upcoming: [], anytime: [], someday: [] };
    for (const t of tasks) {
      grouped[t.list].push(t);
    }
    // Sort today by todayIndex, others by index
    grouped.today.sort((a, b) => a.todayIndex - b.todayIndex);
    grouped.upcoming.sort((a, b) => (a.startDate || "").localeCompare(b.startDate || "") || a.index - b.index);
    const counts = Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, v.length]));
    res.json({ tasks: grouped, counts, total: tasks.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to load Things3 tasks:", message);
    res.status(500).json({ error: "Failed to load tasks", detail: message });
  }
});

app.get("/api/tasks/projects", (_req, res) => {
  try {
    res.json({ projects: getProjects() });
  } catch (err) {
    res.status(500).json({ error: "Failed to load projects" });
  }
});

app.get("/api/tasks/tags", (_req, res) => {
  try {
    res.json({ tags: getTags() });
  } catch (err) {
    res.status(500).json({ error: "Failed to load tags" });
  }
});

app.get("/api/tasks/areas", (_req, res) => {
  try {
    res.json({ areas: getAreas() });
  } catch (err) {
    res.status(500).json({ error: "Failed to load areas" });
  }
});

app.post("/api/tasks", async (req, res) => {
  try {
    const { title, when, list, tags, notes, listId, heading, headingId, checklistItems } = req.body;
    if (!title) { res.status(400).json({ error: "title is required" }); return; }
    await createTask(title, { when, list, tags, notes, listId, heading, headingId, checklistItems });
    res.json({ created: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.put("/api/tasks/:uuid/complete", async (req, res) => {
  try {
    await completeTask(req.params.uuid);
    res.json({ completed: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.put("/api/tasks/:uuid/uncomplete", async (req, res) => {
  try {
    await uncompleteTask(req.params.uuid);
    res.json({ uncompleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.put("/api/tasks/:uuid", async (req, res) => {
  try {
    const { title, notes, deadline, when, tags, addTags, listId, headingId } = req.body as {
      title?: string; notes?: string; deadline?: string; when?: string;
      tags?: string[]; addTags?: string[]; listId?: string; headingId?: string;
    };
    await updateTask(req.params.uuid, { title, notes, deadline, when, tags, addTags, listId, headingId });
    res.json({ updated: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.put("/api/tasks/:uuid/move", async (req, res) => {
  try {
    const { list } = req.body as { list: ThingsList };
    if (!list) { res.status(400).json({ error: "list is required" }); return; }
    await moveTask(req.params.uuid, list);
    res.json({ moved: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get("/api/tasks/logbook", (_req, res) => {
  try {
    const limit = Number(_req.query.limit) || 50;
    res.json({ tasks: getCompletedTasks(limit) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get("/api/tasks/logbook/project/:uuid", (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100;
    res.json({ tasks: getCompletedTasksByProject(req.params.uuid, limit) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/tasks/:uuid/duplicate", async (req, res) => {
  try {
    await duplicateTask(req.params.uuid);
    res.json({ duplicated: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/tasks/create-area", async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) { res.status(400).json({ error: "title is required" }); return; }
    await createArea(title);
    res.json({ created: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/tasks/create-project", async (req, res) => {
  try {
    const { title, notes, areaId, deadline, tags } = req.body;
    if (!title) { res.status(400).json({ error: "title is required" }); return; }
    await createProject(title, { notes, areaId, deadline, tags });
    res.json({ created: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.put("/api/tasks/projects/:uuid", async (req, res) => {
  try {
    const { notes } = req.body;
    // Projects use the same update URL scheme as tasks (by UUID)
    await updateTask(req.params.uuid, { notes });
    res.json({ updated: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.delete("/api/tasks/projects/:uuid", (req, res) => {
  try {
    deleteProject(req.params.uuid);
    res.json({ deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.put("/api/tasks/:uuid/checklist", async (req, res) => {
  try {
    const { items } = req.body as { items: string[] };
    if (!items?.length) { res.status(400).json({ error: "items array is required" }); return; }
    await appendChecklistItems(req.params.uuid, items);
    res.json({ appended: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get("/api/tasks/projects/:uuid/headings", (req, res) => {
  try {
    res.json({ headings: getProjectHeadings(req.params.uuid) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/tasks/:uuid/show", async (req, res) => {
  try {
    await showInThings(req.params.uuid);
    res.json({ shown: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.put("/api/tasks/checklist-items/:uuid/toggle", (req, res) => {
  try {
    const { completed } = req.body as { completed: boolean };
    toggleChecklistItem(req.params.uuid, completed);
    res.json({ toggled: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.delete("/api/tasks/checklist-items/:uuid", (req, res) => {
  try {
    deleteChecklistItem(req.params.uuid);
    res.json({ deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.delete("/api/tasks/:uuid", (req, res) => {
  try {
    deleteTask(req.params.uuid);
    res.json({ deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get("/api/tasks/headings", (_req, res) => {
  try {
    const map = getAllHeadingsForProjects();
    const obj: Record<string, { uuid: string; title: string; projectUuid: string }[]> = {};
    for (const [k, v] of map) obj[k] = v;
    res.json({ headings: obj });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Tasks: Locked Projects & Conversation Map ───

app.get("/api/tasks/locked-projects", (_req, res) => {
  res.json({ lockedProjects: config.tasks?.lockedProjects || [] });
});

app.put("/api/tasks/locked-projects", (req, res) => {
  const { lockedProjects } = req.body;
  if (!Array.isArray(lockedProjects)) {
    res.status(400).json({ error: "lockedProjects must be an array" });
    return;
  }
  config.tasks = { ...config.tasks, lockedProjects };
  saveConfig(config);
  res.json({ lockedProjects });
});

app.get("/api/tasks/conversation-map", async (_req, res) => {
  try {
    const result = await query<{
      id: string;
      title: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, title, metadata FROM conversations
       WHERE metadata->>'taskUuid' IS NOT NULL`,
    );
    const map: Record<string, { conversationId: string; title: string }> = {};
    for (const row of result.rows) {
      const taskUuid = row.metadata?.taskUuid as string;
      if (taskUuid) {
        map[taskUuid] = { conversationId: row.id, title: row.title };
      }
    }
    res.json({ conversationMap: map });
  } catch (err) {
    console.error("Failed to load conversation map:", err);
    res.status(500).json({ error: "Failed to load conversation map" });
  }
});

// ─── AutoDev API ───

app.get("/api/autodev/status", (_req, res) => {
  res.json(autoDevProxy.getStatus());
});

app.get("/api/autodev/log", (_req, res) => {
  res.json({ log: autoDevProxy.getLog() });
});

// ─── Channels API ───

app.get("/api/channels", async (_req, res) => {
  try {
    const result = await query(
      `SELECT id, channel_type, config, enabled, status, display_name, error_message, last_connected_at,
              scope, scope_metadata, language, created_at, updated_at,
              CASE
                WHEN channel_type IN ('emby', 'jellyseerr', 'webhook')
                  THEN NULLIF(config->>'webhookSecret', '')
                ELSE NULL
              END AS webhook_secret
         FROM channel_configs
        ORDER BY created_at`,
    );
    // Merge live adapter statuses
    const liveStatuses = getAllStatuses();
    const statusMap = new Map(liveStatuses.map((s) => [s.channelId, s]));
    const channels = result.rows.map((row: any) => {
      const live = statusMap.get(row.id);
      return {
        ...row,
        config: undefined, // Don't expose secrets to frontend
        status: live?.status || row.status,
        error_message: live?.error || row.error_message,
        webhook_secret: row.webhook_secret || null,
      };
    });
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: "Failed to list channels" });
  }
});

app.post("/api/channels", async (req, res) => {
  try {
    const { id, channel_type, config: channelConfig, display_name, scope, scope_metadata, language } = req.body as {
      id: string;
      channel_type: string;
      config: Record<string, unknown>;
      display_name?: string;
      scope?: string;
      scope_metadata?: Record<string, unknown>;
      language?: string;
    };
    if (!id || !channel_type) {
      res.status(400).json({ error: "id and channel_type are required" });
      return;
    }
    await query(
      `INSERT INTO channel_configs (id, channel_type, config, display_name, scope, scope_metadata, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET config = $3, display_name = $4, scope = $5, scope_metadata = $6, language = $7, updated_at = NOW()`,
      [id, channel_type, JSON.stringify(channelConfig || {}), display_name || null, scope || null, scope_metadata ? JSON.stringify(scope_metadata) : "{}", language || "en"],
    );
    res.json({ created: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.put("/api/channels/:id", async (req, res) => {
  try {
    const { config: channelConfig, display_name, enabled, scope, scope_metadata, language } = req.body;
    const updates: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    let idx = 1;

    if (channelConfig !== undefined) {
      updates.push(`config = $${idx++}`);
      params.push(JSON.stringify(channelConfig));
    }
    if (display_name !== undefined) {
      updates.push(`display_name = $${idx++}`);
      params.push(display_name);
    }
    if (enabled !== undefined) {
      updates.push(`enabled = $${idx++}`);
      params.push(enabled);
    }
    if (scope !== undefined) {
      updates.push(`scope = $${idx++}`);
      params.push(scope || null);
    }
    if (scope_metadata !== undefined) {
      updates.push(`scope_metadata = $${idx++}`);
      params.push(JSON.stringify(scope_metadata));
    }
    if (language !== undefined) {
      updates.push(`language = $${idx++}`);
      params.push(language || "en");
    }

    params.push(req.params.id);
    await query(`UPDATE channel_configs SET ${updates.join(", ")} WHERE id = $${idx}`, params);
    res.json({ updated: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.delete("/api/channels/:id", async (req, res) => {
  try {
    await disconnectChannel(req.params.id);
    await query("DELETE FROM channel_configs WHERE id = $1", [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/channels/:id/connect", async (req, res) => {
  try {
    const status = await connectChannel(req.params.id);
    res.json({ status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/channels/:id/verify", async (req, res) => {
  try {
    const { code, password } = req.body as { code?: string; password?: string };
    const { submitTelegramCode, submitTelegramPassword } = await import("./channels/adapters/telegram.js");

    let submitted = false;
    if (code) {
      submitted = submitTelegramCode(req.params.id, code);
    } else if (password) {
      submitted = submitTelegramPassword(req.params.id, password);
    }

    if (!submitted) {
      res.status(400).json({ error: "No pending auth for this channel" });
      return;
    }
    res.json({ submitted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/channels/:id/disconnect", async (req, res) => {
  try {
    await disconnectChannel(req.params.id);
    res.json({ disconnected: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Push Notifications API ───

import { isAPNsConfigured } from "./notifications/apns.js";

// POST /api/push/register — register a device token for push notifications
app.post("/api/push/register", async (req, res) => {
  try {
    const { deviceToken, platform, deviceName, appVersion, environment } = req.body;
    if (!deviceToken) {
      res.status(400).json({ error: "deviceToken is required" });
      return;
    }
    await query(
      `INSERT INTO push_tokens (device_token, platform, device_name, app_version, environment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (device_token) DO UPDATE SET
         platform = EXCLUDED.platform,
         device_name = EXCLUDED.device_name,
         app_version = EXCLUDED.app_version,
         environment = EXCLUDED.environment,
         enabled = true,
         updated_at = NOW()`,
      [deviceToken, platform || "ios", deviceName || null, appVersion || null, environment || "development"],
    );
    res.json({ registered: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// DELETE /api/push/unregister — remove a device token
app.delete("/api/push/unregister", async (req, res) => {
  try {
    const { deviceToken } = req.body;
    if (!deviceToken) {
      res.status(400).json({ error: "deviceToken is required" });
      return;
    }
    await query("UPDATE push_tokens SET enabled = false, updated_at = NOW() WHERE device_token = $1", [deviceToken]);
    res.json({ unregistered: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// GET /api/push/status — push notification status
app.get("/api/push/status", async (_req, res) => {
  try {
    const deviceCount = await getDeviceCount();
    res.json({
      apnsConfigured: isAPNsConfigured(),
      registeredDevices: deviceCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// GET /api/push/log — recent notification delivery log
app.get("/api/push/log", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const log = await getNotificationLog(limit);
    res.json({ log });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Contacts CRM API ───

import { importAppleContacts } from "./contacts/import-apple-contacts.js";

// POST /api/contacts/import-apple — trigger Apple Contacts import
app.post("/api/contacts/import-apple", async (_req, res) => {
  try {
    const result = await importAppleContacts();
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Contacts] Import failed:", message);
    res.status(500).json({ error: message });
  }
});

// GET /api/contacts/stats — contact stats for dashboard
app.get("/api/contacts/stats", async (_req, res) => {
  try {
    const [contactCount, companyCount, statusBreakdown, recentlyAdded] = await Promise.all([
      query<{ count: number }>("SELECT count(*)::int AS count FROM contacts"),
      query<{ count: number }>("SELECT count(*)::int AS count FROM companies"),
      query<{ status: string; count: number }>("SELECT status, count(*)::int AS count FROM contacts GROUP BY status ORDER BY count DESC"),
      query<{ count: number }>("SELECT count(*)::int AS count FROM contacts WHERE created_at > NOW() - interval '7 days'"),
    ]);
    res.json({
      contacts: contactCount.rows[0]?.count || 0,
      companies: companyCount.rows[0]?.count || 0,
      statusBreakdown: statusBreakdown.rows,
      recentlyAdded: recentlyAdded.rows[0]?.count || 0,
    });
  } catch {
    res.json({ contacts: 0, companies: 0, statusBreakdown: [], recentlyAdded: 0 });
  }
});

// GET /api/contacts — list with search, filter, pagination
app.get("/api/contacts", async (req, res) => {
  try {
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;
    const tag = req.query.tag as string | undefined;
    const companyId = req.query.company_id as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (search) {
      conditions.push(
        `(c.first_name ILIKE $${idx} OR c.last_name ILIKE $${idx} OR $${idx + 1} = ANY(c.emails) OR comp.name ILIKE $${idx})`,
      );
      params.push(`%${search}%`, search);
      idx += 2;
    }
    if (status) {
      conditions.push(`c.status = $${idx++}`);
      params.push(status);
    }
    if (tag) {
      conditions.push(`$${idx++} = ANY(c.tags)`);
      params.push(tag);
    }
    if (companyId) {
      conditions.push(`c.company_id = $${idx++}`);
      params.push(companyId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count query for stats
    const countResult = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM contacts c LEFT JOIN companies comp ON comp.id = c.company_id ${where}`,
      params,
    );

    // Status counts
    const statusCounts = await query<{ status: string; count: number }>(
      `SELECT status, count(*)::int AS count FROM contacts GROUP BY status ORDER BY status`,
    );

    params.push(limit, offset);
    const result = await query(
      `SELECT c.id, c.apple_id, c.first_name, c.last_name, c.nickname, c.emails, c.phones,
              c.company_id, c.job_title, c.birthday, c.tags, c.status, c.notes,
              c.telegram_username, c.slack_handle, c.avatar_url, c.last_contacted_at,
              c.created_at, c.updated_at,
              comp.name AS company_name
       FROM contacts c
       LEFT JOIN companies comp ON comp.id = c.company_id
       ${where}
       ORDER BY c.last_name ASC NULLS LAST, c.first_name ASC NULLS LAST
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );

    res.json({
      contacts: result.rows,
      total: countResult.rows[0]?.count || 0,
      statusCounts: statusCounts.rows,
    });
  } catch (err) {
    console.error("Failed to list contacts:", err);
    res.status(500).json({ error: "Failed to list contacts" });
  }
});

// GET /api/contacts/:id — single contact detail
app.get("/api/contacts/:id", async (req, res) => {
  try {
    const result = await query(
      `SELECT c.*, comp.name AS company_name
       FROM contacts c
       LEFT JOIN companies comp ON comp.id = c.company_id
       WHERE c.id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    res.json({ contact: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to get contact" });
  }
});

// POST /api/contacts — create contact
app.post("/api/contacts", async (req, res) => {
  try {
    const {
      first_name, last_name, nickname, emails, phones, company_id,
      job_title, birthday, tags, status, telegram_username, slack_handle,
      notes, address, social_profiles,
    } = req.body;

    const result = await query<{ id: string }>(
      `INSERT INTO contacts (
        first_name, last_name, nickname, emails, phones, company_id,
        job_title, birthday, tags, status, telegram_username, slack_handle,
        notes, address, social_profiles
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id`,
      [
        first_name || null, last_name || null, nickname || null,
        emails || [], phones || [], company_id || null,
        job_title || null, birthday || null, tags || [],
        status || "active", telegram_username || null, slack_handle || null,
        notes || null,
        address ? JSON.stringify(address) : null,
        social_profiles ? JSON.stringify(social_profiles) : null,
      ],
    );
    res.json({ id: result.rows[0].id, created: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// PUT /api/contacts/:id — update contact
app.put("/api/contacts/:id", async (req, res) => {
  try {
    const updates: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    let idx = 1;

    const fields = [
      "first_name", "last_name", "nickname", "emails", "phones", "company_id",
      "job_title", "birthday", "tags", "status", "telegram_username", "telegram_id",
      "slack_handle", "notes", "obsidian_path", "avatar_url", "source", "last_contacted_at",
    ];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        params.push(req.body[field]);
      }
    }

    // Handle JSONB fields separately
    for (const field of ["address", "social_profiles", "extra"]) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        params.push(JSON.stringify(req.body[field]));
      }
    }

    params.push(req.params.id);
    await query(
      `UPDATE contacts SET ${updates.join(", ")} WHERE id = $${idx}`,
      params,
    );
    res.json({ updated: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// DELETE /api/contacts/:id
app.delete("/api/contacts/:id", async (req, res) => {
  try {
    await query("DELETE FROM contacts WHERE id = $1", [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete contact" });
  }
});

// GET /api/contacts/:id/interactions
app.get("/api/contacts/:id/interactions", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const result = await query(
      `SELECT id, platform, direction, summary, metadata, occurred_at, created_at
       FROM contact_interactions
       WHERE contact_id = $1
       ORDER BY occurred_at DESC
       LIMIT $2`,
      [req.params.id, limit],
    );
    res.json({ interactions: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to list interactions" });
  }
});

// POST /api/contacts/:id/interactions
app.post("/api/contacts/:id/interactions", async (req, res) => {
  try {
    const { platform, direction, summary, metadata, occurred_at } = req.body;
    if (!platform || !occurred_at) {
      res.status(400).json({ error: "platform and occurred_at are required" });
      return;
    }
    const result = await query<{ id: string }>(
      `INSERT INTO contact_interactions (contact_id, platform, direction, summary, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        req.params.id, platform, direction || null,
        summary || null, metadata ? JSON.stringify(metadata) : "{}",
        occurred_at,
      ],
    );
    // Update last_contacted_at on the contact
    await query(
      "UPDATE contacts SET last_contacted_at = GREATEST(last_contacted_at, $1), updated_at = NOW() WHERE id = $2",
      [occurred_at, req.params.id],
    );
    res.json({ id: result.rows[0].id, created: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// GET /api/companies — list companies
app.get("/api/companies", async (req, res) => {
  try {
    const search = req.query.search as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (search) {
      conditions.push(`name ILIKE $${idx++}`);
      params.push(`%${search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    const result = await query(
      `SELECT c.*, (SELECT count(*)::int FROM contacts ct WHERE ct.company_id = c.id) AS contact_count
       FROM companies c
       ${where}
       ORDER BY c.name
       LIMIT $${idx}`,
      params,
    );
    res.json({ companies: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to list companies" });
  }
});

// GET /api/companies/:id
app.get("/api/companies/:id", async (req, res) => {
  try {
    const result = await query(
      `SELECT c.*, (SELECT count(*)::int FROM contacts ct WHERE ct.company_id = c.id) AS contact_count
       FROM companies c WHERE c.id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json({ company: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to get company" });
  }
});

// POST /api/companies — create company
app.post("/api/companies", async (req, res) => {
  try {
    const { name, domain, industry, notes, tags } = req.body;
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const result = await query<{ id: string }>(
      `INSERT INTO companies (name, domain, industry, notes, tags)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [name, domain || null, industry || null, notes || null, tags || []],
    );
    res.json({ id: result.rows[0].id, created: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// PUT /api/companies/:id
app.put("/api/companies/:id", async (req, res) => {
  try {
    const updates: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    let idx = 1;

    for (const field of ["name", "domain", "industry", "notes", "tags", "obsidian_path"]) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        params.push(req.body[field]);
      }
    }

    params.push(req.params.id);
    await query(
      `UPDATE companies SET ${updates.join(", ")} WHERE id = $${idx}`,
      params,
    );
    res.json({ updated: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Contact Tasks (Things3) — explicit link table ───

// GET linked tasks
app.get("/api/contacts/:id/tasks", async (req, res) => {
  try {
    const linkResult = await query<{ things_task_uuid: string }>(
      "SELECT things_task_uuid FROM contact_task_links WHERE contact_id = $1",
      [req.params.id],
    );
    const linkedUuids = new Set(linkResult.rows.map((r) => r.things_task_uuid));

    const allTasks = getActiveTasks();
    const linked = allTasks.filter((t) => linkedUuids.has(t.uuid));

    res.json({ linked });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Search active tasks (for task picker modal)
app.get("/api/tasks/search", (req, res) => {
  try {
    const q = (typeof req.query.q === "string" ? req.query.q : "").trim().toLowerCase();
    const excludeRaw = typeof req.query.exclude === "string" ? req.query.exclude : "";
    const excludeSet = new Set(excludeRaw.split(",").filter(Boolean));

    let tasks = getActiveTasks().filter((t) => !excludeSet.has(t.uuid));

    if (q) {
      tasks = tasks.filter((t) => {
        const fields = [t.title, t.notes, t.projectTitle, t.areaTitle, t.headingTitle, ...t.tags];
        return fields.some((f) => f?.toLowerCase().includes(q));
      });
    }

    res.json({ tasks: tasks.slice(0, 50) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Link an existing Things3 task to a contact
app.post("/api/contacts/:id/tasks/link", async (req, res) => {
  try {
    const { taskUuid } = req.body;
    if (!taskUuid) return res.status(400).json({ error: "taskUuid is required" });

    await query(
      `INSERT INTO contact_task_links (contact_id, things_task_uuid)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, taskUuid],
    );
    res.json({ linked: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Unlink a Things3 task from a contact
app.delete("/api/contacts/:id/tasks/link/:taskUuid", async (req, res) => {
  try {
    await query(
      "DELETE FROM contact_task_links WHERE contact_id = $1 AND things_task_uuid = $2",
      [req.params.id, req.params.taskUuid],
    );
    res.json({ unlinked: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Create a new Things3 task AND link it to the contact
app.post("/api/contacts/:id/tasks", async (req, res) => {
  try {
    const result = await query<{ first_name: string | null; last_name: string | null }>(
      "SELECT first_name, last_name FROM contacts WHERE id = $1",
      [req.params.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Contact not found" });

    const { first_name, last_name } = result.rows[0];
    const fullName = [first_name, last_name].filter(Boolean).join(" ");
    const { title, notes, when, tags, listId } = req.body;

    await createTask(title, {
      notes: notes ? `${notes}\n\nContact: ${fullName}` : `Contact: ${fullName}`,
      when,
      tags,
      listId,
    });

    // Things3 URL scheme is async — wait for SQLite to be updated
    await new Promise((r) => setTimeout(r, 600));

    // Things3 URL scheme doesn't return the UUID, so we find the task we just created
    // by matching title in the active tasks list (best effort)
    const allTasks = getActiveTasks();
    const match = allTasks.find((t) => t.title === title);
    if (match) {
      await query(
        `INSERT INTO contact_task_links (contact_id, things_task_uuid)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.params.id, match.uuid],
      );
    }

    res.json({ created: true, linkedUuid: match?.uuid || null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Contact Obsidian Notes — linked by obsidian_path + frontmatter contact_id ───

app.get("/api/contacts/:id/obsidian", async (req, res) => {
  try {
    const result = await query<{ first_name: string | null; last_name: string | null; obsidian_path: string | null }>(
      "SELECT first_name, last_name, obsidian_path FROM contacts WHERE id = $1",
      [req.params.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Contact not found" });

    const { first_name, last_name, obsidian_path } = result.rows[0];
    const vaultPath = config.obsidian?.vaultPath?.replace(/^~/, process.env.HOME || "/root");
    if (!vaultPath) return res.status(400).json({ error: "Obsidian vault path not configured" });

    const fullName = [first_name, last_name].filter(Boolean).join(" ");
    const notePath = obsidian_path || `People/${fullName}.md`;
    const fullFilePath = path.resolve(vaultPath, notePath);

    if (!fullFilePath.startsWith(vaultPath)) {
      return res.status(400).json({ error: "Invalid path" });
    }

    if (!fs.existsSync(fullFilePath)) {
      return res.json({ exists: false, path: notePath, content: null });
    }

    const content = fs.readFileSync(fullFilePath, "utf-8");
    const stats = fs.statSync(fullFilePath);
    res.json({ exists: true, path: notePath, content, modifiedAt: stats.mtime.toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.put("/api/contacts/:id/obsidian", async (req, res) => {
  try {
    const result = await query<{
      first_name: string | null; last_name: string | null;
      obsidian_path: string | null; company_name?: string | null; job_title: string | null;
    }>(
      `SELECT c.first_name, c.last_name, c.obsidian_path, c.job_title, co.name AS company_name
       FROM contacts c LEFT JOIN companies co ON c.company_id = co.id
       WHERE c.id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Contact not found" });

    const { first_name, last_name, obsidian_path } = result.rows[0];
    const vaultPath = config.obsidian?.vaultPath?.replace(/^~/, process.env.HOME || "/root");
    if (!vaultPath) return res.status(400).json({ error: "Obsidian vault path not configured" });

    const fullName = [first_name, last_name].filter(Boolean).join(" ");
    const notePath = obsidian_path || `People/${fullName}.md`;
    const fullFilePath = path.resolve(vaultPath, notePath);

    if (!fullFilePath.startsWith(vaultPath)) {
      return res.status(400).json({ error: "Invalid path" });
    }

    const { content } = req.body;
    if (typeof content !== "string") return res.status(400).json({ error: "content is required" });

    // Ensure frontmatter includes contact_id for bidirectional linking
    let finalContent = content;
    const hasFrontmatter = content.startsWith("---\n");
    const contactIdLine = `contact_id: ${req.params.id}`;
    if (hasFrontmatter) {
      const endIdx = content.indexOf("\n---", 4);
      if (endIdx !== -1) {
        const fm = content.slice(4, endIdx);
        if (!fm.includes("contact_id:")) {
          finalContent = `---\n${contactIdLine}\n${fm}\n---${content.slice(endIdx + 4)}`;
        }
      }
    } else {
      // Prepend frontmatter block
      finalContent = `---\n${contactIdLine}\n---\n\n${content}`;
    }

    // Ensure directory exists
    const dir = path.dirname(fullFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(fullFilePath, finalContent, "utf-8");

    // Update obsidian_path on the contact if not already set
    if (!obsidian_path) {
      await query("UPDATE contacts SET obsidian_path = $1, updated_at = NOW() WHERE id = $2", [notePath, req.params.id]);
    }

    res.json({ saved: true, path: notePath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Contact Media API ───

app.get("/api/contacts/:id/media", async (req, res) => {
  try {
    const { limit = "50", offset = "0", type } = req.query as Record<string, string>;
    const lim = Math.min(Math.max(1, parseInt(limit) || 50), 200);
    const off = Math.max(0, parseInt(offset) || 0);

    const conditions = ["m.contact_id = $1", "m.status = 'ready'"];
    const params: unknown[] = [req.params.id];
    let idx = 2;

    if (type && type !== "all") {
      conditions.push(`m.media_type = $${idx++}`);
      params.push(type);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT m.id, m.media_type, m.filename, m.mime_type, m.size_bytes,
                m.thumbnail_path, m.width, m.height, m.channel_type, m.caption, m.created_at
         FROM media m ${where}
         ORDER BY m.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, lim, off],
      ),
      query(`SELECT COUNT(*)::int AS total FROM media m ${where}`, params),
    ]);

    res.json({ media: dataResult.rows, total: countResult.rows[0]?.total || 0 });
  } catch (err) {
    console.error("[Media] Contact media failed:", err);
    res.status(500).json({ error: "Failed to get contact media" });
  }
});

// ─── Knowledge Store API ───

app.get("/api/store/collections", async (_req, res) => {
  try {
    const result = await query(
      `SELECT c.*, count(o.id)::int AS object_count
       FROM store_collections c
       LEFT JOIN store_objects o ON o.collection_id = c.id AND o.status = 'active'
       GROUP BY c.id
       ORDER BY c.name`,
    );
    res.json({ collections: result.rows });
  } catch (err) {
    console.error("Failed to list collections:", err);
    res.status(500).json({ error: "Failed to list collections" });
  }
});

app.get("/api/store/collections/:id", async (req, res) => {
  try {
    const result = await query(
      `SELECT c.*, count(o.id)::int AS object_count
       FROM store_collections c
       LEFT JOIN store_objects o ON o.collection_id = c.id AND o.status = 'active'
       WHERE c.id = $1
       GROUP BY c.id`,
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Collection not found" });
      return;
    }
    res.json({ collection: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to get collection" });
  }
});

app.post("/api/store/collections", async (req, res) => {
  try {
    const { name, description, icon, schema, config: collConfig } = req.body;
    if (!name || !schema) {
      res.status(400).json({ error: "name and schema are required" });
      return;
    }
    const result = await query(
      `INSERT INTO store_collections (name, description, icon, schema, config)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, description || null, icon || null, JSON.stringify(schema), JSON.stringify(collConfig || {})],
    );
    res.json({ collection: result.rows[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("unique")) {
      res.status(409).json({ error: "Collection name already exists" });
      return;
    }
    res.status(500).json({ error: "Failed to create collection" });
  }
});

app.put("/api/store/collections/:id", async (req, res) => {
  try {
    const { name, description, icon, schema, config: collConfig } = req.body;
    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); params.push(name); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); params.push(description); }
    if (icon !== undefined) { fields.push(`icon = $${idx++}`); params.push(icon); }
    if (schema !== undefined) { fields.push(`schema = $${idx++}`); params.push(JSON.stringify(schema)); }
    if (collConfig !== undefined) { fields.push(`config = $${idx++}`); params.push(JSON.stringify(collConfig)); }

    if (fields.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    params.push(req.params.id);
    const result = await query(
      `UPDATE store_collections SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
      params,
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Collection not found" });
      return;
    }
    res.json({ collection: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update collection" });
  }
});

app.delete("/api/store/collections/:id", async (req, res) => {
  try {
    await query("DELETE FROM store_collections WHERE id = $1", [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete collection" });
  }
});

app.get("/api/store/objects", async (req, res) => {
  try {
    const collection = req.query.collection as string | undefined;
    const status = (req.query.status as string) || "active";
    const factStateRaw = (req.query.fact_state as string | undefined) || "non_outdated";
    const factState = ["all", "non_outdated", "outdated", "verified", "unverified", "disputed"].includes(factStateRaw)
      ? factStateRaw
      : "non_outdated";
    const sortBy = (req.query.sort_by as string) || "created_at";
    const sortOrder = (req.query.sort_order as string) === "asc" ? "ASC" : "DESC";
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const search = req.query.search as string | undefined;

    const conditions: string[] = [`o.status = $1`];
    const params: unknown[] = [status];
    let idx = 2;

    if (collection) {
      conditions.push(`(c.name = $${idx} OR c.id::text = $${idx})`);
      params.push(collection);
      idx++;
    }

    if (search) {
      conditions.push(`o.fts @@ websearch_to_tsquery('english', $${idx})`);
      params.push(search);
      idx++;
    }

    if (factState === "non_outdated") {
      conditions.push(`(c.name <> 'Facts' OR COALESCE(o.data->>'status', 'unverified') <> 'outdated')`);
    } else if (factState === "outdated") {
      conditions.push(`(c.name <> 'Facts' OR COALESCE(o.data->>'status', 'unverified') = 'outdated')`);
    } else if (factState !== "all") {
      conditions.push(`(c.name <> 'Facts' OR COALESCE(o.data->>'status', 'unverified') = $${idx})`);
      params.push(factState);
      idx++;
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const orderCol = sortBy === "title" ? "o.title" : sortBy === "updated_at" ? "o.updated_at" : "o.created_at";

    params.push(limit, offset);
    const result = await query(
      `SELECT o.id, o.collection_id, o.title, o.data, o.tags, o.status, o.created_by, o.created_at, o.updated_at,
              COALESCE(o.data->>'status', '') AS semantic_status,
              c.name AS collection_name, c.icon AS collection_icon
       FROM store_objects o
       JOIN store_collections c ON c.id = o.collection_id
       ${where}
       ORDER BY ${orderCol} ${sortOrder}
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );

    const countResult = await query(
      `SELECT count(*)::int AS total
       FROM store_objects o
       JOIN store_collections c ON c.id = o.collection_id
       ${where}`,
      params.slice(0, -2),
    );

    res.json({ objects: result.rows, total: countResult.rows[0]?.total || 0, limit, offset });
  } catch (err) {
    console.error("Failed to query objects:", err);
    res.status(500).json({ error: "Failed to query objects" });
  }
});

app.get("/api/store/objects/:id", async (req, res) => {
  try {
    const result = await query(
      `SELECT o.*, c.name AS collection_name, c.icon AS collection_icon, c.schema AS collection_schema
       FROM store_objects o
       JOIN store_collections c ON c.id = o.collection_id
       WHERE o.id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Object not found" });
      return;
    }

    // Fetch relations
    const relations = await query(
      `SELECT r.*,
              s.title AS source_title, sc.name AS source_collection,
              t.title AS target_title, tc.name AS target_collection
       FROM store_relations r
       JOIN store_objects s ON s.id = r.source_id
       JOIN store_collections sc ON sc.id = s.collection_id
       JOIN store_objects t ON t.id = r.target_id
       JOIN store_collections tc ON tc.id = t.collection_id
       WHERE r.source_id = $1 OR r.target_id = $1
       ORDER BY r.created_at DESC`,
      [req.params.id],
    );

    res.json({ object: result.rows[0], relations: relations.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to get object" });
  }
});

app.post("/api/store/objects", async (req, res) => {
  try {
    const { collection_id, title, data, tags } = req.body;
    if (!collection_id || !title) {
      res.status(400).json({ error: "collection_id and title are required" });
      return;
    }

    // Generate embedding
    let embeddingVal: string | null = null;
    try {
      const text = `${title} ${Object.values(data || {}).filter((v) => typeof v === "string").join(" ")} ${(tags || []).join(" ")}`.trim();
      const emb = await embed(text, config);
      embeddingVal = `[${emb.join(",")}]`;
    } catch { /* store without embedding */ }

    const result = await query(
      `INSERT INTO store_objects (collection_id, title, data, tags, embedding, created_by)
       VALUES ($1, $2, $3, $4, $5, 'user')
       RETURNING *`,
      [collection_id, title, JSON.stringify(data || {}), tags || [], embeddingVal],
    );
    res.json({ object: result.rows[0] });
  } catch (err) {
    console.error("Failed to create object:", err);
    res.status(500).json({ error: "Failed to create object" });
  }
});

app.put("/api/store/objects/:id", async (req, res) => {
  try {
    const { title, data, tags, status } = req.body;
    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (title !== undefined) { fields.push(`title = $${idx++}`); params.push(title); }
    if (data !== undefined) { fields.push(`data = $${idx++}`); params.push(JSON.stringify(data)); }
    if (tags !== undefined) { fields.push(`tags = $${idx++}`); params.push(tags); }
    if (status !== undefined) { fields.push(`status = $${idx++}`); params.push(status); }

    if (fields.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    params.push(req.params.id);
    const result = await query(
      `UPDATE store_objects SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
      params,
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    res.json({ object: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update object" });
  }
});

app.delete("/api/store/objects/:id", async (req, res) => {
  try {
    await query("UPDATE store_objects SET status = 'archived' WHERE id = $1", [req.params.id]);
    res.json({ archived: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to archive object" });
  }
});

app.post("/api/store/relations", async (req, res) => {
  try {
    const { source_id, target_id, relation, metadata } = req.body;
    if (!source_id || !target_id || !relation) {
      res.status(400).json({ error: "source_id, target_id, and relation are required" });
      return;
    }
    const result = await query(
      `INSERT INTO store_relations (source_id, target_id, relation, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source_id, target_id, relation) DO UPDATE SET metadata = $4
       RETURNING *`,
      [source_id, target_id, relation, JSON.stringify(metadata || {})],
    );
    res.json({ relation: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to create relation" });
  }
});

app.delete("/api/store/relations/:id", async (req, res) => {
  try {
    await query("DELETE FROM store_relations WHERE id = $1", [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete relation" });
  }
});

app.post("/api/store/search", async (req, res) => {
  try {
    const { query: searchQuery, collection, limit: maxLimit, fact_state: factStateRaw } = req.body;
    if (!searchQuery) {
      res.status(400).json({ error: "query is required" });
      return;
    }

    const maxResults = Math.min(maxLimit || 20, 100);
    const factState = ["all", "non_outdated", "outdated", "verified", "unverified", "disputed"].includes(factStateRaw)
      ? factStateRaw
      : "non_outdated";
    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await embed(searchQuery, config);
    } catch { /* FTS only */ }

    const conditions: string[] = ["o.status = 'active'"];
    const params: unknown[] = [];
    let idx = 1;

    if (collection) {
      conditions.push(`(c.name = $${idx} OR c.id::text = $${idx})`);
      params.push(collection);
      idx++;
    }

    if (factState === "non_outdated") {
      conditions.push(`(c.name <> 'Facts' OR COALESCE(o.data->>'status', 'unverified') <> 'outdated')`);
    } else if (factState === "outdated") {
      conditions.push(`(c.name <> 'Facts' OR COALESCE(o.data->>'status', 'unverified') = 'outdated')`);
    } else if (factState !== "all") {
      conditions.push(`(c.name <> 'Facts' OR COALESCE(o.data->>'status', 'unverified') = $${idx})`);
      params.push(factState);
      idx++;
    }

    let sql: string;
    if (queryEmbedding) {
      params.push(`[${queryEmbedding.join(",")}]`);
      const embIdx = idx++;
      params.push(searchQuery);
      const qIdx = idx++;
      params.push(maxResults);
      const limIdx = idx++;

      sql = `
        SELECT o.id, o.title, o.data, o.tags, o.created_at, o.updated_at,
               COALESCE(o.data->>'status', '') AS semantic_status,
               c.name AS collection_name, c.icon AS collection_icon,
               CASE WHEN o.embedding IS NOT NULL
                 THEN 1 - (o.embedding <=> $${embIdx}::vector)
                 ELSE 0
               END AS vector_score,
               ts_rank(o.fts, websearch_to_tsquery('english', $${qIdx})) AS text_score
        FROM store_objects o
        JOIN store_collections c ON c.id = o.collection_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY
          (CASE WHEN o.embedding IS NOT NULL
            THEN 1 - (o.embedding <=> $${embIdx}::vector)
            ELSE 0
          END) * 0.7 +
          ts_rank(o.fts, websearch_to_tsquery('english', $${qIdx})) * 0.3
          DESC
        LIMIT $${limIdx}`;
    } else {
      params.push(searchQuery);
      const qIdx = idx++;
      params.push(maxResults);
      const limIdx = idx++;

      sql = `
        SELECT o.id, o.title, o.data, o.tags, o.created_at, o.updated_at,
               COALESCE(o.data->>'status', '') AS semantic_status,
               c.name AS collection_name, c.icon AS collection_icon,
               0 AS vector_score,
               ts_rank(o.fts, websearch_to_tsquery('english', $${qIdx})) AS text_score
        FROM store_objects o
        JOIN store_collections c ON c.id = o.collection_id
        WHERE ${conditions.join(" AND ")}
          AND o.fts @@ websearch_to_tsquery('english', $${qIdx})
        ORDER BY text_score DESC
        LIMIT $${limIdx}`;
    }

    const result = await query(sql, params);
    res.json({
      results: result.rows.map((r) => ({
        ...r,
        score: Number(r.vector_score) * 0.7 + Number(r.text_score) * 0.3,
      })),
      total: result.rows.length,
      mode: queryEmbedding ? "hybrid" : "text_only",
    });
  } catch (err) {
    console.error("Store search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

app.get("/api/store/stats", async (_req, res) => {
  try {
    const [collections, objects, relations] = await Promise.all([
      query("SELECT count(*)::int AS count FROM store_collections"),
      query("SELECT count(*)::int AS count FROM store_objects WHERE status = 'active'"),
      query("SELECT count(*)::int AS count FROM store_relations"),
    ]);
    res.json({
      collections: collections.rows[0].count,
      objects: objects.rows[0].count,
      relations: relations.rows[0].count,
    });
  } catch {
    res.json({ collections: 0, objects: 0, relations: 0 });
  }
});

// ─── OKR Things3 Sync ───

app.post("/api/okr/sync-things3", async (_req, res) => {
  try {
    const result = await syncToThings3();
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get("/api/okr/things3-progress", async (_req, res) => {
  try {
    const progress = readThings3Progress();
    res.json(progress);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── YouTube API ───

app.post("/api/youtube/transcribe", async (req, res) => {
  try {
    const { url, language } = req.body;
    if (!url) return res.status(400).json({ error: "url is required" });
    const result = await transcribeYouTube(url, language || "en");
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post("/api/audio/transcribe", async (req, res) => {
  try {
    const { filePath, language } = req.body;
    if (!filePath) return res.status(400).json({ error: "filePath is required" });
    const result = await transcribeAudioFile(filePath, language || "auto");
    res.json({ ...result, method: "mlx-whisper", segmentCount: result.segments.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── Logs API ───

app.get("/api/logs", async (req, res) => {
  try {
    const level = req.query.level as string | undefined;
    const source = req.query.source as string | undefined;
    const limit = Number(req.query.limit) || 200;

    // Use in-memory buffer for speed (last 500 entries)
    const logs = getRecentLogs({ limit, level: level as any, source: source as any });
    res.json({ logs });
  } catch {
    res.json({ logs: [] });
  }
});

app.get("/api/logs/history", async (req, res) => {
  try {
    const level = req.query.level as string | undefined;
    const source = req.query.source as string | undefined;
    const since = req.query.since as string | undefined;
    const limit = Number(req.query.limit) || 200;

    const logs = await queryLogs({ limit, level: level as any, source: source as any, since });
    res.json({ logs });
  } catch {
    res.json({ logs: [] });
  }
});

app.delete("/api/logs", async (_req, res) => {
  try {
    const pruned = await pruneLogs(0); // prune all
    res.json({ pruned });
  } catch {
    res.json({ pruned: 0 });
  }
});

// ── Agent Social Avatar API ──

app.get("/api/agent-social/avatar-style", async (_req, res) => {
  try {
    const style = await ensureAvatarStyleGuide(config);
    res.json({
      source: style.source,
      notePath: style.notePath,
      created: style.created,
      content: style.content,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message || "Failed to load avatar style guide." });
  }
});

app.put("/api/agent-social/avatar-style", async (req, res) => {
  try {
    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(400).json({ error: "content is required" });

    const style = await saveAvatarStyleGuide(config, content);
    res.json({
      saved: true,
      source: style.source,
      notePath: style.notePath,
      content: style.content,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message || "Failed to save avatar style guide." });
  }
});

app.post("/api/agent-social/avatar-generate", async (req, res) => {
  try {
    const agentId = String(req.body?.agentId || "").trim();
    const agentName = String(req.body?.agentName || agentId).trim();
    const prompt = String(req.body?.prompt || "").trim();
    const soulDocument = req.body?.soulDocument ? String(req.body.soulDocument) : undefined;
    const modeRaw = String(req.body?.mode || "nano").trim().toLowerCase();
    const mode: AvatarRenderMode = modeRaw === "pro" ? "pro" : "nano";
    const model = req.body?.model ? String(req.body.model).trim() : undefined;

    if (!agentId) return res.status(400).json({ error: "agentId is required" });
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

    const result = await generateAvatarAndStore({
      config,
      agentId,
      agentName,
      prompt,
      soulDocument,
      mode,
      model,
      conversationId: null,
    });

    res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message || "Avatar generation failed." });
  }
});

app.post("/api/agent-social/avatar-generate-all", async (req, res) => {
  try {
    const prompt = req.body?.prompt ? String(req.body.prompt).trim() : undefined;
    const modeRaw = String(req.body?.mode || "nano").trim().toLowerCase();
    const mode: AvatarRenderMode = modeRaw === "pro" ? "pro" : "nano";
    const model = req.body?.model ? String(req.body.model).trim() : undefined;

    const results = await generateAvatarsForAllAgents({
      config,
      prompt,
      mode,
      model,
      conversationId: null,
    });

    const succeeded = results.filter((r) => r.result);
    const failed = results.filter((r) => r.error);

    res.json({
      ok: true,
      total: results.length,
      succeeded: succeeded.length,
      failed: failed.length,
      results: results.map((r) => ({
        agentId: r.agentId,
        agentName: r.agentName,
        fileUrl: r.result?.fileUrl || null,
        error: r.error || null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message || "Bulk avatar generation failed." });
  }
});

// ── Media API ──

app.get("/api/media", async (req, res) => {
  try {
    const { type, channel, q, sort = "created_at", dir = "DESC", limit = "50", offset = "0" } = req.query as Record<string, string>;
    const conditions: string[] = ["m.status != 'deleted'"];
    const params: unknown[] = [];
    let idx = 1;

    if (type && type !== "all") {
      conditions.push(`m.media_type = $${idx++}`);
      params.push(type);
    }
    if (channel && channel !== "all") {
      conditions.push(`m.channel_type = $${idx++}`);
      params.push(channel);
    }
    if (q) {
      conditions.push(`m.fts @@ plainto_tsquery('english', $${idx++})`);
      params.push(q);
    }

    const allowedSorts: Record<string, string> = {
      created_at: "m.created_at", date: "m.created_at", filename: "m.filename",
      size: "m.size_bytes", type: "m.media_type",
    };
    const sortCol = allowedSorts[sort] || "m.created_at";
    const sortDir = dir.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const lim = Math.min(Math.max(1, parseInt(limit) || 50), 200);
    const off = Math.max(0, parseInt(offset) || 0);

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT m.id, m.message_id, m.conversation_id, m.channel_type, m.channel_id, m.sender_id,
                m.sender_name, m.contact_id, m.media_type, m.filename, m.mime_type, m.size_bytes, m.storage_path,
                m.thumbnail_path, m.width, m.height, m.duration_seconds, m.status, m.caption, m.created_at,
                c.first_name AS contact_first_name, c.last_name AS contact_last_name,
                c.avatar_url AS contact_avatar_url
         FROM media m
         LEFT JOIN contacts c ON m.contact_id = c.id
         ${where}
         ORDER BY ${sortCol} ${sortDir}
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, lim, off],
      ),
      query(`SELECT COUNT(*)::int AS total FROM media m ${where}`, params),
    ]);

    res.json({ media: dataResult.rows, total: countResult.rows[0]?.total || 0 });
  } catch (err) {
    console.error("[Media] List failed:", err);
    res.status(500).json({ error: "Failed to list media" });
  }
});

app.get("/api/media/stats", async (_req, res) => {
  try {
    const [byType, byChannel, totals] = await Promise.all([
      query("SELECT media_type, COUNT(*)::int AS count FROM media WHERE status = 'ready' GROUP BY media_type ORDER BY count DESC"),
      query("SELECT channel_type, COUNT(*)::int AS count FROM media WHERE status = 'ready' GROUP BY channel_type ORDER BY count DESC"),
      query("SELECT COUNT(*)::int AS total, COALESCE(SUM(size_bytes), 0)::bigint AS total_bytes FROM media WHERE status = 'ready'"),
    ]);
    res.json({
      byType: byType.rows,
      byChannel: byChannel.rows,
      total: totals.rows[0]?.total || 0,
      totalBytes: parseInt(totals.rows[0]?.total_bytes || "0"),
    });
  } catch (err) {
    console.error("[Media] Stats failed:", err);
    res.status(500).json({ error: "Failed to get media stats" });
  }
});

app.get("/api/media/:id", async (req, res) => {
  try {
    const result = await query("SELECT * FROM media WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ media: result.rows[0] });
  } catch (err) {
    console.error("[Media] Get failed:", err);
    res.status(500).json({ error: "Failed to get media" });
  }
});

app.get("/api/media/:id/file", async (req, res) => {
  try {
    const result = await query("SELECT storage_path, mime_type, filename FROM media WHERE id = $1 AND status = 'ready'", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    const { storage_path, mime_type, filename } = result.rows[0];
    const filePath = path.join(config.media.storagePath, storage_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File missing on disk" });
    if (mime_type) res.type(mime_type);
    if (filename) res.set("Content-Disposition", `inline; filename="${filename}"`);
    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => {
      console.error("[Media] File stream failed:", err);
      if (!res.headersSent) res.status(500).json({ error: "Failed to stream file" });
      else res.end();
    });
    stream.pipe(res);
  } catch (err) {
    console.error("[Media] File serve failed:", err);
    res.status(500).json({ error: "Failed to serve file" });
  }
});

app.get("/api/media/:id/thumbnail", async (req, res) => {
  try {
    const result = await query("SELECT thumbnail_path, storage_path, mime_type FROM media WHERE id = $1 AND status = 'ready'", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    const { thumbnail_path, storage_path, mime_type } = result.rows[0];
    const thumbPath = thumbnail_path
      ? path.join(config.media.storagePath, thumbnail_path)
      : null;
    if (thumbPath && fs.existsSync(thumbPath)) {
      res.type("image/webp");
      const stream = fs.createReadStream(thumbPath);
      stream.on("error", (err) => {
        console.error("[Media] Thumbnail stream failed:", err);
        if (!res.headersSent) res.status(500).json({ error: "Failed to stream thumbnail" });
        else res.end();
      });
      stream.pipe(res);
    } else if (mime_type?.startsWith("image/")) {
      // Fallback to original for images without thumbnails
      const originalPath = path.join(config.media.storagePath, storage_path);
      if (!fs.existsSync(originalPath)) return res.status(404).json({ error: "File missing on disk" });
      res.type(mime_type);
      const stream = fs.createReadStream(originalPath);
      stream.on("error", (err) => {
        console.error("[Media] Thumbnail fallback stream failed:", err);
        if (!res.headersSent) res.status(500).json({ error: "Failed to stream file" });
        else res.end();
      });
      stream.pipe(res);
    } else {
      res.status(404).json({ error: "No thumbnail available" });
    }
  } catch (err) {
    console.error("[Media] Thumbnail serve failed:", err);
    res.status(500).json({ error: "Failed to serve thumbnail" });
  }
});

app.delete("/api/media/:id", async (req, res) => {
  try {
    const result = await query("SELECT storage_path, thumbnail_path FROM media WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    const { storage_path, thumbnail_path } = result.rows[0];

    // Remove files from disk
    try {
      const filePath = path.join(config.media.storagePath, storage_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (thumbnail_path) {
        const thumbPath = path.join(config.media.storagePath, thumbnail_path);
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      }
    } catch { /* file cleanup is best-effort */ }

    await query("UPDATE media SET status = 'deleted', updated_at = NOW() WHERE id = $1", [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    console.error("[Media] Delete failed:", err);
    res.status(500).json({ error: "Failed to delete media" });
  }
});

// ─── Quality Center API ───

// Suites
app.get("/api/quality/suites", async (_req, res) => {
  try {
    const result = await query<QATestSuite & { case_count: number; last_run_status: string | null; last_run_at: string | null }>(
      `SELECT s.*,
         (SELECT COUNT(*) FROM qa_test_cases WHERE suite_id = s.id)::int AS case_count,
         (SELECT status FROM qa_test_runs WHERE suite_id = s.id ORDER BY created_at DESC LIMIT 1) AS last_run_status,
         (SELECT created_at FROM qa_test_runs WHERE suite_id = s.id ORDER BY created_at DESC LIMIT 1) AS last_run_at
       FROM qa_test_suites s ORDER BY s.name`,
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/quality/suites", async (req, res) => {
  try {
    const { name, description, agent_id, config: suiteConfig, tags } = req.body;
    const result = await query<QATestSuite>(
      `INSERT INTO qa_test_suites (name, description, agent_id, config, tags)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description || null, agent_id || "personal", JSON.stringify(suiteConfig || {}), tags || []],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/quality/suites/:id", async (req, res) => {
  try {
    const suite = await query<QATestSuite>("SELECT * FROM qa_test_suites WHERE id = $1", [req.params.id]);
    if (suite.rows.length === 0) return res.status(404).json({ error: "Not found" });
    const cases = await query<QATestCase>(
      "SELECT * FROM qa_test_cases WHERE suite_id = $1 ORDER BY sort_order, created_at",
      [req.params.id],
    );
    res.json({ ...suite.rows[0], cases: cases.rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.put("/api/quality/suites/:id", async (req, res) => {
  try {
    const { name, description, agent_id, config: suiteConfig, tags, enabled } = req.body;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (name !== undefined) { sets.push(`name = $${idx++}`); vals.push(name); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push(description); }
    if (agent_id !== undefined) { sets.push(`agent_id = $${idx++}`); vals.push(agent_id); }
    if (suiteConfig !== undefined) { sets.push(`config = $${idx++}`); vals.push(JSON.stringify(suiteConfig)); }
    if (tags !== undefined) { sets.push(`tags = $${idx++}`); vals.push(tags); }
    if (enabled !== undefined) { sets.push(`enabled = $${idx++}`); vals.push(enabled); }
    sets.push("updated_at = NOW()");
    vals.push(req.params.id);
    const result = await query<QATestSuite>(
      `UPDATE qa_test_suites SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      vals,
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete("/api/quality/suites/:id", async (req, res) => {
  try {
    await query("DELETE FROM qa_test_suites WHERE id = $1", [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Cases
app.post("/api/quality/suites/:id/cases", async (req, res) => {
  try {
    const { name, description, input_message, expected_tools, unexpected_tools, expected_content_patterns, max_latency_ms, min_quality_score, turns, turn_count, category } = req.body;
    const result = await query<QATestCase>(
      `INSERT INTO qa_test_cases (suite_id, name, description, input_message, expected_tools, unexpected_tools, expected_content_patterns, max_latency_ms, min_quality_score, turns, turn_count, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [req.params.id, name, description || null, input_message || 'multi-turn', expected_tools || [], unexpected_tools || [], expected_content_patterns || [], max_latency_ms || null, min_quality_score || 0.5, turns ? JSON.stringify(turns) : null, turn_count || 1, category || 'single-turn'],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.put("/api/quality/cases/:id", async (req, res) => {
  try {
    const { name, description, input_message, expected_tools, unexpected_tools, expected_content_patterns, max_latency_ms, min_quality_score, enabled, turns, turn_count, category } = req.body;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (name !== undefined) { sets.push(`name = $${idx++}`); vals.push(name); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push(description); }
    if (input_message !== undefined) { sets.push(`input_message = $${idx++}`); vals.push(input_message); }
    if (expected_tools !== undefined) { sets.push(`expected_tools = $${idx++}`); vals.push(expected_tools); }
    if (unexpected_tools !== undefined) { sets.push(`unexpected_tools = $${idx++}`); vals.push(unexpected_tools); }
    if (expected_content_patterns !== undefined) { sets.push(`expected_content_patterns = $${idx++}`); vals.push(expected_content_patterns); }
    if (max_latency_ms !== undefined) { sets.push(`max_latency_ms = $${idx++}`); vals.push(max_latency_ms); }
    if (min_quality_score !== undefined) { sets.push(`min_quality_score = $${idx++}`); vals.push(min_quality_score); }
    if (enabled !== undefined) { sets.push(`enabled = $${idx++}`); vals.push(enabled); }
    if (turns !== undefined) { sets.push(`turns = $${idx++}`); vals.push(turns ? JSON.stringify(turns) : null); }
    if (turn_count !== undefined) { sets.push(`turn_count = $${idx++}`); vals.push(turn_count); }
    if (category !== undefined) { sets.push(`category = $${idx++}`); vals.push(category); }
    sets.push("updated_at = NOW()");
    vals.push(req.params.id);
    const result = await query<QATestCase>(
      `UPDATE qa_test_cases SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      vals,
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete("/api/quality/cases/:id", async (req, res) => {
  try {
    await query("DELETE FROM qa_test_cases WHERE id = $1", [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Runs
app.post("/api/quality/suites/:id/run", async (req, res) => {
  try {
    const { modelOverrides } = req.body || {};
    // Start run asynchronously, return the run ID immediately
    const suiteCheck = await query("SELECT id FROM qa_test_suites WHERE id = $1", [req.params.id]);
    if (suiteCheck.rows.length === 0) return res.status(404).json({ error: "Suite not found" });

    const runRow = await query<QATestRun>(
      `INSERT INTO qa_test_runs (suite_id, status, triggered_by, model_config, total_cases)
       VALUES ($1, 'running', 'manual', $2,
         (SELECT COUNT(*) FROM qa_test_cases WHERE suite_id = $1 AND enabled = true))
       RETURNING *`,
      [req.params.id, JSON.stringify(modelOverrides || {})],
    );
    const runId = runRow.rows[0].id;

    res.json({ runId, status: "running" });

    // Execute in background
    runTestSuite(req.params.id, config, {
      modelOverrides,
      triggeredBy: "manual",
      broadcast: wsBroadcast,
    }).then(async (completedRun) => {
      // Auto-create issues for failures
      await createIssuesFromRun(completedRun).catch((err) =>
        console.error("[QA] Issue creation failed:", err),
      );
    }).catch((err) => {
      console.error("[QA] Run failed:", err);
      query(
        "UPDATE qa_test_runs SET status = 'failed', completed_at = NOW() WHERE id = $1",
        [runId],
      ).catch(() => {});
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/quality/runs", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const suiteId = req.query.suiteId as string;

    const where = suiteId ? "WHERE tr.suite_id = $3" : "";
    const params: unknown[] = [limit, offset];
    if (suiteId) params.push(suiteId);

    const result = await query<QATestRun & { suite_name: string }>(
      `SELECT tr.*, s.name AS suite_name
       FROM qa_test_runs tr
       JOIN qa_test_suites s ON tr.suite_id = s.id
       ${where}
       ORDER BY tr.created_at DESC
       LIMIT $1 OFFSET $2`,
      params,
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/quality/runs/:id", async (req, res) => {
  try {
    const run = await query<QATestRun & { suite_name: string }>(
      `SELECT tr.*, s.name AS suite_name
       FROM qa_test_runs tr
       JOIN qa_test_suites s ON tr.suite_id = s.id
       WHERE tr.id = $1`,
      [req.params.id],
    );
    if (run.rows.length === 0) return res.status(404).json({ error: "Not found" });

    const results = await query<QATestResult & { case_name: string; input_message: string }>(
      `SELECT r.*, c.name AS case_name, c.input_message
       FROM qa_test_results r
       JOIN qa_test_cases c ON r.case_id = c.id
       WHERE r.run_id = $1
       ORDER BY c.sort_order, r.created_at`,
      [req.params.id],
    );

    res.json({ ...run.rows[0], results: results.rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Issues
app.get("/api/quality/issues", async (req, res) => {
  try {
    const { status, severity, category, limit, offset } = req.query as Record<string, string>;
    const result = await listIssues({
      status, severity, category,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.put("/api/quality/issues/:id", async (req, res) => {
  try {
    const issue = await updateIssue(req.params.id, req.body);
    res.json(issue);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/quality/issues/autodev", async (req, res) => {
  try {
    const error = String(req.body?.error || "").trim();
    if (!error) return res.status(400).json({ error: "error is required" });
    const taskUuid = req.body?.taskUuid ? String(req.body.taskUuid).trim() : null;
    const taskTitle = req.body?.taskTitle ? String(req.body.taskTitle).trim() : null;
    const taskNotes = req.body?.taskNotes ? String(req.body.taskNotes) : null;
    const projectTitle = req.body?.projectTitle ? String(req.body.projectTitle).trim() : null;
    const headingTitle = req.body?.headingTitle ? String(req.body.headingTitle).trim() : null;
    const tags = Array.isArray(req.body?.tags)
      ? req.body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean)
      : [];
    const executor = req.body?.executor ? String(req.body.executor).trim() : null;
    const agentId = req.body?.agentId ? String(req.body.agentId).trim() : null;
    const skill = req.body?.skill ? String(req.body.skill).trim() : null;
    const routeReason = req.body?.routeReason ? String(req.body.routeReason) : null;
    const strict = typeof req.body?.strict === "boolean" ? req.body.strict : undefined;
    const logExcerpt = req.body?.logExcerpt ? String(req.body.logExcerpt) : null;

    const result = await createAutoDevRuntimeIssue({
      error,
      taskUuid,
      taskTitle,
      taskNotes,
      projectTitle,
      headingTitle,
      tags,
      executor,
      agentId,
      skill,
      routeReason,
      strict,
      logExcerpt,
    });

    res.json({ created: result.created, issue: result.issue });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/quality/issues/:id/autodev", async (req, res) => {
  try {
    const issue = await pushToAutodev(req.params.id);
    res.json({ pushed: true, issue });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Stats (dashboard aggregates)
app.get("/api/quality/stats", async (_req, res) => {
  try {
    const [suites, cases, runs, issues, criticalIssues, lastRun] = await Promise.all([
      query<{ count: string }>("SELECT COUNT(*) FROM qa_test_suites"),
      query<{ count: string }>("SELECT COUNT(*) FROM qa_test_cases"),
      query<{ count: string }>("SELECT COUNT(*) FROM qa_test_runs"),
      query<{ count: string }>("SELECT COUNT(*) FROM qa_issues WHERE status NOT IN ('closed', 'verified')"),
      query<{ count: string }>("SELECT COUNT(*) FROM qa_issues WHERE severity = 'critical' AND status NOT IN ('closed', 'verified')"),
      query<QATestRun>("SELECT * FROM qa_test_runs ORDER BY created_at DESC LIMIT 1"),
    ]);

    const totalRuns = parseInt(runs.rows[0].count);
    let passRate: number | null = null;
    if (totalRuns > 0) {
      const passResult = await query<{ total_passed: string; total_cases: string }>(
        "SELECT SUM(passed) AS total_passed, SUM(total_cases) AS total_cases FROM qa_test_runs WHERE status = 'completed'",
      );
      const { total_passed, total_cases } = passResult.rows[0];
      if (parseInt(total_cases) > 0) {
        passRate = parseInt(total_passed) / parseInt(total_cases);
      }
    }

    const stats: QAStats = {
      total_suites: parseInt(suites.rows[0].count),
      total_cases: parseInt(cases.rows[0].count),
      total_runs: totalRuns,
      last_run: lastRun.rows[0] || null,
      pass_rate: passRate,
      open_issues: parseInt(issues.rows[0].count),
      critical_issues: parseInt(criticalIssues.rows[0].count),
    };

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Prompt optimization
app.post("/api/quality/runs/:id/optimize", async (req, res) => {
  try {
    const candidate = await generatePromptCandidate(config, req.params.id);
    if (!candidate) return res.status(400).json({ error: "No failures to optimize or optimization failed" });
    res.json(candidate);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/quality/prompt-versions/:id/ab-test", async (req, res) => {
  try {
    const { suiteId } = req.body;
    if (!suiteId) return res.status(400).json({ error: "suiteId required" });
    const result = await abTestPrompt(config, req.params.id, suiteId, wsBroadcast);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/quality/prompt-versions/:id/submit-review", async (req, res) => {
  try {
    const reviewId = await submitForReview(req.params.id);
    res.json({ reviewId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/quality/prompt-versions/:id/activate", async (req, res) => {
  try {
    await activatePromptVersion(req.params.id);
    res.json({ activated: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Bookmarks API ───

import {
  listBookmarks, getBookmark, createBookmark, updateBookmark, deleteBookmark,
  listFolders as listBookmarkFolders, moveBookmarks, bulkDelete, bulkSetStatus,
  deleteFolder as deleteBookmarkFolder, findSemanticDuplicates, getBookmarkStats,
  syncFromChrome, exportToChrome, findDuplicates, removeDuplicates,
  listSuggestions, approveSuggestion, rejectSuggestion, suggestBookmark,
  markReadLater, markRead, getReadLaterQueue, getSyncState as getBookmarkSyncState,
} from "./sync/bookmarks-sync.js";

app.get("/api/bookmarks", async (req, res) => {
  try {
    const opts = {
      folder: req.query.folder as string | undefined,
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
      domain: req.query.domain as string | undefined,
      source: req.query.source as string | undefined,
      tag: req.query.tag as string | undefined,
      limit: Number(req.query.limit) || 100,
      offset: Number(req.query.offset) || 0,
    };
    const result = await listBookmarks(opts);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/bookmarks/stats", async (_req, res) => {
  try {
    const stats = await getBookmarkStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/bookmarks/folders", async (_req, res) => {
  try {
    const folders = await listBookmarkFolders();
    res.json({ folders });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/bookmarks/suggestions", async (_req, res) => {
  try {
    const suggestions = await listSuggestions();
    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/bookmarks/read-later", async (_req, res) => {
  try {
    const queue = await getReadLaterQueue();
    res.json({ bookmarks: queue });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/bookmarks/duplicates", async (_req, res) => {
  try {
    const dupes = await findDuplicates();
    res.json({ duplicates: dupes });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/bookmarks/sync-state", async (_req, res) => {
  try {
    const state = await getBookmarkSyncState();
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/bookmarks/:id", async (req, res) => {
  try {
    const bm = await getBookmark(req.params.id);
    if (!bm) { res.status(404).json({ error: "Bookmark not found" }); return; }
    res.json(bm);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/bookmarks", async (req, res) => {
  try {
    const bm = await createBookmark(req.body);
    res.json({ bookmark: bm });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.put("/api/bookmarks/:id", async (req, res) => {
  try {
    const bm = await updateBookmark(req.params.id, req.body);
    res.json({ bookmark: bm });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete("/api/bookmarks/:id", async (req, res) => {
  try {
    await deleteBookmark(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/bookmarks/bulk-delete", async (req, res) => {
  try {
    const { ids } = req.body;
    const count = await bulkDelete(ids);
    res.json({ deleted: count });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.post("/api/bookmarks/bulk-status", async (req, res) => {
  try {
    const { ids, status } = req.body;
    const count = await bulkSetStatus(ids, status);
    res.json({ updated: count });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.post("/api/bookmarks/move", async (req, res) => {
  try {
    const { ids, folder_path } = req.body;
    const count = await moveBookmarks(ids, folder_path);
    res.json({ moved: count });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.post("/api/bookmarks/:id/read-later", async (req, res) => {
  try {
    const bm = await markReadLater(req.params.id);
    res.json({ bookmark: bm });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/bookmarks/:id/mark-read", async (req, res) => {
  try {
    const bm = await markRead(req.params.id);
    res.json({ bookmark: bm });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/bookmarks/suggestions/:id/approve", async (req, res) => {
  try {
    const bm = await approveSuggestion(req.params.id);
    res.json({ bookmark: bm });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/bookmarks/suggestions/:id/reject", async (req, res) => {
  try {
    await rejectSuggestion(req.params.id);
    res.json({ rejected: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/bookmarks/sync/pull", async (_req, res) => {
  try {
    const result = await syncFromChrome();
    broadcast("bookmarks.synced", result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/bookmarks/sync/push", async (_req, res) => {
  try {
    const result = await exportToChrome();
    broadcast("bookmarks.exported", result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/bookmarks/deduplicate", async (_req, res) => {
  try {
    const removed = await removeDuplicates();
    res.json({ removed });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete("/api/bookmarks/folders/:path(*)", async (req, res) => {
  try {
    const rawPath = typeof req.params["path(*)"] === "string"
      ? req.params["path(*)"]
      : "";
    const count = await deleteBookmarkFolder(rawPath);
    res.json({ deleted: count });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/bookmarks/smart-duplicates", async (_req, res) => {
  try {
    const groups = await findSemanticDuplicates();
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Cloud Sync API ───

import {
  listProviders, getProvider, createProvider, updateProvider, deleteProvider, checkProvider,
  listPairs, getPair, createPair, updatePair, deletePair,
  browse, executeSyncPair, listRuns, getSyncStats, listRcloneRemotes, isRcloneInstalled,
  startSyncScheduler, stopSyncScheduler,
} from "./sync/cloud-sync.js";

app.get("/api/cloud-sync/stats", async (_req, res) => {
  try {
    const [stats, rcloneOk] = await Promise.all([getSyncStats(), isRcloneInstalled()]);
    res.json({ ...stats, rclone_installed: rcloneOk });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/cloud-sync/providers", async (_req, res) => {
  try {
    const providers = await listProviders();
    res.json({ providers });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/cloud-sync/providers", async (req, res) => {
  try {
    const provider = await createProvider(req.body);
    res.json({ provider });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.put("/api/cloud-sync/providers/:id", async (req, res) => {
  try {
    const provider = await updateProvider(req.params.id, req.body);
    res.json({ provider });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete("/api/cloud-sync/providers/:id", async (req, res) => {
  try {
    await deleteProvider(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/cloud-sync/providers/:id/check", async (req, res) => {
  try {
    const provider = await getProvider(req.params.id);
    if (!provider) { res.status(404).json({ error: "Provider not found" }); return; }
    const result = await checkProvider(provider);
    await updateProvider(req.params.id, {
      status: result.ok ? "connected" : "error",
      status_message: result.message,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/cloud-sync/pairs", async (_req, res) => {
  try {
    const pairs = await listPairs();
    res.json({ pairs });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/cloud-sync/pairs", async (req, res) => {
  try {
    const pair = await createPair(req.body);
    res.json({ pair });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.put("/api/cloud-sync/pairs/:id", async (req, res) => {
  try {
    const pair = await updatePair(req.params.id, req.body);
    res.json({ pair });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete("/api/cloud-sync/pairs/:id", async (req, res) => {
  try {
    await deletePair(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/cloud-sync/pairs/:id/sync", async (req, res) => {
  try {
    const pair = await getPair(req.params.id);
    if (!pair) { res.status(404).json({ error: "Pair not found" }); return; }
    executeSyncPair(req.params.id)
      .then((run) => broadcast("cloud-sync.completed", { pairId: req.params.id, run }))
      .catch((err) => {
        console.error("[CloudSync] Sync failed:", err);
        broadcast("cloud-sync.error", { pairId: req.params.id, error: String(err) });
      });
    res.json({ triggered: true, pair_name: pair.name });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/cloud-sync/runs", async (req, res) => {
  try {
    const pairId = req.query.pair_id as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const runs = await listRuns(pairId, limit);
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/cloud-sync/browse", async (req, res) => {
  try {
    const providerId = req.query.provider as string;
    const path = (req.query.path as string) || "";
    if (!providerId) { res.status(400).json({ error: "provider query param required" }); return; }
    const entries = await browse(providerId, path);
    res.json({ entries, path });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/cloud-sync/remotes", async (_req, res) => {
  try {
    const [remotes, installed] = await Promise.all([listRcloneRemotes(), isRcloneInstalled()]);
    res.json({ remotes, rclone_installed: installed });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// WebSocket Server
const wss = new WebSocketServer({ noServer: true });

// WS auth: verify Bearer token on upgrade
server.on("upgrade", (req, socket, head) => {
  if (req.url && !req.url.startsWith("/ws")) {
    socket.destroy();
    return;
  }

  const secret = config.gateway.secret;
  if (secret) {
    // Check Authorization header first, then ?token= query param
    let token: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    } else {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      token = url.searchParams.get("token");
    }

    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(secret);
    if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`WS client connected (${clients.size} total)`);

  // Send welcome
  ws.send(frame("system.status", {
    status: "connected",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  }));

  // Send cached autodev state so reconnecting clients don't show stale data
  autoDevProxy.sendSyncToClient(ws);

  ws.on("message", async (raw) => {
    const msg = parseFrame(raw.toString());
    if (!msg) {
      ws.send(frame("chat.error", { error: "Invalid frame" }));
      return;
    }

    try {
      switch (msg.type) {
        case "chat.send": {
          const data = msg.data as ChatSendData;
          if (!data?.content) {
            ws.send(frame("chat.error", { error: "Missing content" }, msg.id));
            return;
          }

          // Proactive speaking — AI initiates with a short contextual greeting
          // Use utilityCall for lightweight, non-persisted response
          if (data.proactive) {
            const proactiveSystemPrompt = "You are JOI, a personal AI companion. Generate a brief, friendly, contextual greeting or conversation starter. Keep it to 1-2 short sentences. Be warm and natural — as if you just thought of something interesting to share or ask about. Do not use bracketed emotion markers.";
            const apiStartMs = Date.now();
            try {
              const content = await utilityCall(
                config,
                proactiveSystemPrompt,
                "Say something interesting to start a conversation.",
                { maxTokens: 256 },
              );
              // Stream the whole result as a single delta (utilityCall doesn't stream)
              ws.send(frame("chat.stream", { delta: content }, msg.id));
              ws.send(frame("chat.done", {
                messageId: "proactive",
                content,
                model: "utility",
                provider: "proactive",
                latencyMs: Date.now() - apiStartMs,
              }, msg.id));
            } catch (err) {
              ws.send(frame("chat.error", { error: (err as Error).message }, msg.id));
            }
            break;
          }

          const agentId = data.agentId || "personal";
          const conversationId = data.conversationId;
          const mode = data.mode || "api";
          const emittedToolUseIds = new Set<string>();

          if (mode === "claude-code") {
            // ── Claude Code CLI mode (uses subscription, not API) ──
            const convId = await ensureConversation(conversationId || undefined, agentId, !conversationId ? data.metadata : undefined);

            // Save user message to DB
            await saveMessage(convId, "user", data.content, null, null, null, null);

            const startMs = Date.now();
            const result = await runClaudeCode({
              userMessage: data.content,
              onStream: (delta) => {
                ws.send(frame("chat.stream", {
                  conversationId: convId,
                  delta,
                }, msg.id));
              },
              onToolUse: (name, input, id) => {
                if (id && emittedToolUseIds.has(id)) return;
                if (id) emittedToolUseIds.add(id);
                const announcement = getToolAnnouncement(name, input);
                if (announcement) {
                  ws.send(frame("chat.stream", {
                    conversationId: convId,
                    delta: `${announcement} `,
                  }, msg.id));
                }
                ws.send(frame("chat.tool_use", {
                  conversationId: convId,
                  toolName: name,
                  toolInput: input,
                  toolUseId: id,
                }, msg.id));
              },
              onToolResult: (id, resultData) => {
                ws.send(frame("chat.tool_result", {
                  conversationId: convId,
                  toolUseId: id,
                  result: resultData,
                }, msg.id));
              },
            });
            const latencyMs = Date.now() - startMs;

            // Save assistant message to DB
            const messageId = await saveMessage(
              convId, "assistant", result.content, result.model,
              null, null, result.usage,
            );

            // Auto-set conversation title from first message
            const countResult = await query<{ count: number }>(
              "SELECT count(*)::int AS count FROM messages WHERE conversation_id = $1",
              [convId],
            );
            if (countResult.rows[0].count <= 3) {
              const title = data.content.slice(0, 80) + (data.content.length > 80 ? "..." : "");
              await query(
                "UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2",
                [title, convId],
              );
            } else {
              await query(
                "UPDATE conversations SET updated_at = NOW() WHERE id = $1",
                [convId],
              );
            }

            ws.send(frame("chat.done", {
              conversationId: convId,
              messageId,
              content: result.content,
              model: result.model,
              provider: "claude-code",
              usage: result.usage,
              latencyMs,
              costUsd: 0, // Claude Code uses subscription, not metered
            }, msg.id));
          } else {
            // ── API mode (OpenRouter / Anthropic) ──
            // Intent routing — try to route specialist queries to the right agent
            let effectiveAgentId = agentId;
            let routeDecision: RouteDecision | null = null;
            const routeResult = await routeIntent(data.content, agentId);
            if (routeResult.routed) {
              routeDecision = routeResult;
              effectiveAgentId = routeResult.agentId;
              console.log(`[chat.send] Intent router: ${agentId} → ${effectiveAgentId} (reason=${routeResult.reason}, confidence=${routeResult.confidence})`);
            }

            // Ensure conversation exists BEFORE runAgent so all events use the real ID
            const convId = await ensureConversation(conversationId || undefined, effectiveAgentId, !conversationId ? data.metadata : undefined);

            // Emit chat.routed event if intent router selected a different agent
            const agentVisibility = process.env.JOI_AGENT_VISIBILITY === "1";
            if (routeDecision && agentVisibility) {
              ws.send(frame("chat.routed", {
                conversationId: convId,
                agentId: routeDecision.agentId,
                agentName: routeDecision.agentName,
                reason: routeDecision.reason,
                confidence: routeDecision.confidence,
                matchedPattern: routeDecision.matchedPattern,
              }, msg.id));
            }

            const apiStartMs = Date.now();
            const runOptions: Parameters<typeof runAgent>[0] = {
              conversationId: convId,
              agentId: effectiveAgentId,
              userMessage: data.content,
              config,
              model: data.model,
              broadcast,
              onToolPlan: (toolCalls) => {
                const steps = toolCalls.map((tc) => getToolPlanStep(tc.name, tc.input));
                if (steps.length > 0) {
                  ws.send(frame("chat.plan", {
                    conversationId: convId,
                    steps,
                  }, msg.id));
                }
              },
              onStream: (delta) => {
                ws.send(frame("chat.stream", {
                  conversationId: convId,
                  delta,
                }, msg.id));
              },
              onToolUse: (name, input, id) => {
                if (id && emittedToolUseIds.has(id)) return;
                if (id) emittedToolUseIds.add(id);
                const announcement = getToolAnnouncement(name, input);
                if (announcement) {
                  ws.send(frame("chat.stream", {
                    conversationId: convId,
                    delta: `${announcement} `,
                  }, msg.id));
                }
                ws.send(frame("chat.tool_use", {
                  conversationId: convId,
                  toolName: name,
                  toolInput: input,
                  toolUseId: id,
                }, msg.id));
              },
              onToolResult: (id, resultData) => {
                ws.send(frame("chat.tool_result", {
                  conversationId: convId,
                  toolUseId: id,
                  result: resultData,
                }, msg.id));
              },
            };

            // Apply execution profile from router
            if (routeDecision) {
              const ep = routeDecision.executionProfile;
              runOptions.includeSkillsPrompt = ep.includeSkillsPrompt;
              runOptions.includeMemoryContext = ep.includeMemoryContext;
              runOptions.historyLimit = ep.historyLimit;
            }

            const result = await runAgent(runOptions);

            ws.send(frame("chat.done", {
              conversationId: convId,
              messageId: result.messageId,
              content: result.content,
              model: result.model,
              provider: result.provider,
              toolModel: result.toolModel,
              toolProvider: result.toolProvider,
              usage: result.usage,
              costUsd: result.costUsd,
              latencyMs: Date.now() - apiStartMs,
              timings: result.timings,
              ...(agentVisibility ? {
                agentId: result.agentId,
                agentName: result.agentName || routeDecision?.agentName,
                routeReason: routeDecision?.reason,
                routeConfidence: routeDecision?.confidence,
                delegations: result.delegations,
                cacheStats: result.usage.cacheReadTokens || result.usage.cacheWriteTokens ? {
                  cacheReadTokens: result.usage.cacheReadTokens || 0,
                  cacheWriteTokens: result.usage.cacheWriteTokens || 0,
                  cacheHitPercent: result.usage.inputTokens > 0
                    ? Math.round(((result.usage.cacheReadTokens || 0) / result.usage.inputTokens) * 100)
                    : 0,
                } : undefined,
              } : {}),
            }, msg.id));
          }

          break;
        }

        case "chat.interrupt": {
          // Voice interruption — truncate stored assistant message to what was spoken
          const interruptData = msg.data as { spokenText?: string; messageId?: string };
          if (interruptData?.messageId && interruptData?.spokenText) {
            const truncated = interruptData.spokenText + " [Interrupted by user]";
            await query(
              "UPDATE messages SET content = $1 WHERE id = $2",
              [truncated, interruptData.messageId],
            );
            console.log(`[chat.interrupt] Truncated message ${interruptData.messageId} to ${truncated.length} chars`);
          }
          break;
        }

        case "session.list": {
          const result = await query(
            `SELECT c.id, c.title, c.agent_id,
                    (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id)::int AS message_count,
                    (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
                    c.updated_at
             FROM conversations c
             ORDER BY c.updated_at DESC
             LIMIT 50`,
          );
          ws.send(frame("session.data", { sessions: result.rows }, msg.id));
          break;
        }

        case "session.load": {
          const loadData = msg.data as { conversationId: string };
          const result = await query(
            `SELECT id, role, content, tool_calls, tool_results, model, token_usage, created_at
             FROM messages
             WHERE conversation_id = $1
             ORDER BY created_at ASC`,
            [loadData.conversationId],
          );
          ws.send(frame("session.data", {
            conversationId: loadData.conversationId,
            messages: result.rows,
          }, msg.id));
          break;
        }

        case "session.create": {
          const createData = msg.data as { agentId?: string } | undefined;
          const result = await query<{ id: string }>(
            `INSERT INTO conversations (agent_id, title)
             VALUES ($1, 'New conversation')
             RETURNING id`,
            [createData?.agentId || "personal"],
          );
          ws.send(frame("session.data", {
            conversationId: result.rows[0].id,
          }, msg.id));
          break;
        }

        case "agent.list": {
          const result = await query(
            "SELECT id, name, description, model, enabled FROM agents ORDER BY id",
          );
          ws.send(frame("agent.data", { agents: result.rows }, msg.id));
          break;
        }

        case "review.resolve": {
          const data = msg.data as { id: string; status: string; resolution?: unknown; resolved_by?: string };
          if (!data?.id || !data?.status) {
            ws.send(frame("chat.error", { error: "Missing id or status" }, msg.id));
            break;
          }
          if (!["approved", "rejected", "modified"].includes(data.status)) {
            ws.send(frame("chat.error", { error: "status must be approved, rejected, or modified" }, msg.id));
            break;
          }
          // Fetch review for triage handling + learning
          const wsReviewResult = await query<{
            agent_id: string;
            type: string; conversation_id: string | null; proposed_action: unknown;
            title: string; description: string | null; content: unknown;
          }>(
            "SELECT agent_id, type, conversation_id, proposed_action, title, description, content FROM review_queue WHERE id = $1",
            [data.id],
          );
          const wsRow = wsReviewResult.rows[0];
          if (!wsRow) {
            ws.send(frame("chat.error", { error: "Review not found" }, msg.id));
            break;
          }
          const wsResolvedBy = data.resolved_by || "human";
          const wsIsFactVerify = isVerifyFactReview(wsRow.type, wsRow.proposed_action);
          const wsIsSoulUpdate = isSoulUpdateReview(wsRow.type, wsRow.proposed_action);
          const effectiveResolution = data.status === "rejected"
            ? (data.resolution ?? null)
            : (data.resolution ?? wsRow.proposed_action ?? null);
          const wsSoulResult = wsIsSoulUpdate && (data.status === "approved" || data.status === "modified")
            ? await applySoulReviewResolution({
                reviewId: data.id,
                status: data.status as ReviewResolutionStatus,
                resolution: effectiveResolution,
                proposedAction: wsRow.proposed_action,
                resolvedBy: wsResolvedBy,
                fallbackAgentId: wsRow.agent_id,
              })
            : null;
          const persistedResolution = data.status === "rejected"
            ? (data.resolution ?? null)
            : (wsSoulResult?.action ?? effectiveResolution ?? null);

          await query(
            `UPDATE review_queue
             SET status = $1, resolution = $2, resolved_by = $3, resolved_at = NOW()
             WHERE id = $4`,
            [data.status, persistedResolution ? JSON.stringify(persistedResolution) : null, wsResolvedBy, data.id],
          );
          broadcast("review.resolved", {
            id: data.id,
            status: data.status,
            resolution: persistedResolution,
            resolvedBy: wsResolvedBy,
            soul: wsSoulResult
              ? {
                  agentId: wsSoulResult.agentId,
                  versionId: wsSoulResult.version?.id || null,
                  rolloutId: wsSoulResult.rollout?.id || null,
                  rolloutMode: wsSoulResult.rolloutMode,
                  qualityStatus: wsSoulResult.quality.status,
                  qualityRunId: wsSoulResult.quality.run?.id || null,
                  qualitySuiteId: wsSoulResult.quality.suiteId,
                }
              : null,
          });
          // Handle triage actions (same as REST path)
          if (wsRow?.type === "triage" && wsRow.conversation_id) {
            if (data.status === "approved" || data.status === "modified") {
              const actions = (persistedResolution || wsRow.proposed_action) as import("./channels/triage.js").TriageAction[] | null;
              if (actions && Array.isArray(actions)) {
                executeTriageActions(data.id, wsRow.conversation_id, actions, broadcast)
                  .catch((err) => console.error("[Reviews] WS triage action execution failed:", err));
              }
            } else if (data.status === "rejected") {
              handleTriageRejection(data.id, wsRow.conversation_id)
                .catch((err) => console.error("[Reviews] WS triage rejection handling failed:", err));
            }
          }
          if (wsIsFactVerify) {
            applyFactReviewResolution({
              status: data.status as "approved" | "rejected" | "modified",
              resolution: persistedResolution,
              proposedAction: wsRow.proposed_action,
              resolvedBy: wsResolvedBy,
            }).catch((err) => console.warn("[Reviews] WS fact verification apply failed:", err));
          }
          // Fire-and-forget: learning pipeline
          if (wsRow && !wsIsFactVerify) {
            processFeedback(
              {
                reviewId: data.id,
                signal: data.status as "approved" | "rejected" | "modified",
                domain: wsRow.type || "other",
                conversationId: wsRow.conversation_id,
                title: wsRow.title,
                description: wsRow.description,
                contentBlocks: wsRow.content,
                proposedAction: wsRow.proposed_action,
                resolution: persistedResolution,
              },
              config,
            ).catch((err) => console.warn("[Learner]", err));
          }
          break;
        }

        case "system.ping": {
          ws.send(frame("system.pong", { timestamp: Date.now() }, msg.id));
          break;
        }

        // ─── PTY (Claude Code Terminal) ───

        case "pty.spawn": {
          const data = msg.data as PtySpawnData | undefined;
          const session = spawnSession({
            sessionId: data?.sessionId,
            cwd: data?.cwd,
            cols: data?.cols,
            rows: data?.rows,
          });

          // Wire output → this WebSocket client
          const removeDataListener = addListener(session.id, (output) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(frame("pty.output", { sessionId: session.id, data: output }));
            }
          });

          // Wire exit → this WebSocket client
          const removeExitListener = addExitListener(session.id, (exitCode) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(frame("pty.exit", { sessionId: session.id, exitCode }));
            }
          });

          // Clean up listeners when WS disconnects
          ws.on("close", () => {
            removeDataListener();
            removeExitListener();
          });

          // Send session info + scrollback for reattach
          const scrollback = getScrollback(session.id);
          ws.send(frame("pty.data", {
            sessionId: session.id,
            cwd: session.cwd,
            createdAt: session.createdAt,
            scrollback: scrollback || undefined,
          }, msg.id));
          break;
        }

        case "pty.input": {
          const data = msg.data as PtyInputData;
          if (!data?.sessionId || data.data === undefined) {
            ws.send(frame("chat.error", { error: "Missing sessionId or data" }, msg.id));
            break;
          }
          writeInput(data.sessionId, data.data);
          break;
        }

        case "pty.resize": {
          const data = msg.data as PtyResizeData;
          if (!data?.sessionId || !data.cols || !data.rows) break;
          resizeSession(data.sessionId, data.cols, data.rows);
          break;
        }

        case "pty.kill": {
          const data = msg.data as PtyKillData;
          if (!data?.sessionId) break;
          killSession(data.sessionId);
          ws.send(frame("pty.exit", { sessionId: data.sessionId, exitCode: 0 }, msg.id));
          break;
        }

        case "pty.list": {
          ws.send(frame("pty.data", { sessions: listSessions() }, msg.id));
          break;
        }

        case "autodev.pause": {
          autoDevProxy.sendToWorker("autodev.pause");
          break;
        }

        case "autodev.resume": {
          autoDevProxy.sendToWorker("autodev.resume");
          break;
        }

        case "autodev.stop-current": {
          autoDevProxy.sendToWorker("autodev.stop-current");
          break;
        }

        case "autodev.worker_hello": {
          // Worker identifying itself — register this WS as the worker connection
          autoDevProxy.setWorkerSocket(ws);
          autoDevProxy.handleWorkerMessage(msg);
          break;
        }

        case "autodev.status":
        case "autodev.log":
        case "autodev.task_complete":
        case "autodev.error": {
          // Forward worker events through proxy to web clients
          autoDevProxy.handleWorkerMessage(msg);
          break;
        }

        default:
          ws.send(frame("chat.error", {
            error: `Unknown frame type: ${msg.type}`,
          }, msg.id));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error handling ${msg.type}:`, message);
      ws.send(frame("chat.error", { error: message }, msg.id));
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`WS client disconnected (${clients.size} total)`);
  });

  ws.on("error", (err) => {
    console.error("WS error:", err);
    clients.delete(ws);
  });
});

// Broadcast to all connected WebSocket clients
function wsBroadcast(type: string, data: unknown): void {
  const msg = frame(type as any, data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// Wrap broadcast with push notification dispatcher (WebSocket + APNs)
export const broadcast = createPushDispatcher(wsBroadcast);

// Wire log broadcast to WebSocket clients (logs only go to WS, not push)
setLogBroadcast(wsBroadcast);

// AutoDev proxy — relays between worker process and web clients
const autoDevProxy = new AutoDevProxy(wsBroadcast);

// Register built-in system cron jobs on startup (idempotent)
async function registerBuiltInJobs(): Promise<void> {
  // Episode summarizer — every 15 minutes
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_every_ms,
       session_target, payload_kind, payload_text, enabled)
     VALUES ('system', 'summarize_idle_sessions', 'Summarize idle conversation sessions into episode memories',
       'every', $1, 'isolated', 'system_event', 'summarize_idle_sessions', true)
     ON CONFLICT (name) DO NOTHING`,
    [15 * 60 * 1000],
  );

  // Nightly memory consolidation — 3 AM daily
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('system', 'consolidate_memories', 'Nightly memory maintenance: merge duplicates, decay stale, GC expired',
       'cron', '0 3 * * *', 'Europe/Vienna', 'isolated', 'system_event', 'consolidate_memories', true)
     ON CONFLICT (name) DO NOTHING`,
  );

  // Outline <-> Obsidian bidirectional sync — every 5 minutes
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_every_ms,
       session_target, payload_kind, payload_text, enabled)
     VALUES ('system', 'sync_outline', 'Bidirectional Outline <-> Obsidian sync: pull from Outline then push local edits',
       'every', $1, 'isolated', 'system_event', 'sync_outline', true)
     ON CONFLICT (name) DO NOTHING`,
    [5 * 60 * 1000],
  );

  // Clean up old separate job if it exists
  await query("DELETE FROM cron_jobs WHERE name = 'sync_outline_full'").catch(() => {});

  // ─── Security Officer Agent + Cron Job ───

  // Upsert the security-officer agent
  await query(
    `INSERT INTO agents (id, name, description, system_prompt, model, enabled, skills)
     VALUES (
       'security-officer',
       'Security Officer',
       'Analyzes gateway access logs and system logs for security anomalies, suspicious patterns, and potential threats.',
       'You are the JOI Security Officer. Your job is to analyze gateway access logs and system logs for security anomalies, suspicious patterns, and potential threats. You are thorough but avoid false positives. Only flag genuinely concerning patterns.',
       'claude-sonnet-4-20250514',
       true,
       '{}'
     )
     ON CONFLICT (id) DO NOTHING`,
  );

  // Security audit — every 6 hours
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('security-officer', 'security_audit', 'Periodic security audit of gateway access logs and system events',
       'cron', '0 */6 * * *', 'Europe/Vienna', 'isolated', 'agent_turn',
       $1, true)
     ON CONFLICT (name) DO NOTHING`,
    [`Analyze the JOI gateway logs from the last 6 hours. Use the query_gateway_logs tool to:

1. Check for authentication failures (401 status codes) — report if more than 5 in the period
2. Check for unusual error spikes (error-level logs)
3. Check for requests from unexpected sources or user agents
4. Check for unusual API patterns (high request volume, unusual endpoints)
5. Check for any access without authentication

If you find anything concerning, use review_request to create a review item with:
- type: "verify"
- title: "Security Alert: <brief description>"
- tags: ["security"]
- priority: based on severity (0=info, 5=warning, 10=critical)
- content: include the relevant log entries as evidence

If everything looks normal, do NOT create a review item.`],
  );

  // Accounting pipeline — 1st of each month at 8 AM (orchestrator scans Gmail, processes invoices)
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('accounting-orchestrator', 'accounting_monthly', 'Monthly accounting pipeline: collect invoices, classify, reconcile',
       'cron', '0 8 1 * *', 'Europe/Vienna', 'isolated', 'agent_turn',
       'Run the monthly accounting pipeline for the previous month. Collect invoices from Gmail, classify into BMD folders, and prepare for reconciliation.', true)
     ON CONFLICT (name) DO NOTHING`,
  );

  // Invoice collection — daily at 9 AM (catch new invoices)
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('invoice-collector', 'collect_invoices_daily', 'Daily Gmail scan for new invoices',
       'cron', '0 9 * * 1-5', 'Europe/Vienna', 'isolated', 'agent_turn',
       'Scan Gmail for new invoice emails and download any PDF attachments to Google Drive.', true)
     ON CONFLICT (name) DO NOTHING`,
  );

  // Apple Contacts sync — every 30 minutes
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_every_ms,
       session_target, payload_kind, payload_text, enabled)
     VALUES ('system', 'sync_contacts', 'Sync Apple Contacts to CRM database (upsert changed contacts)',
       'every', $1, 'isolated', 'system_event', 'sync_contacts', true)
     ON CONFLICT (name) DO NOTHING`,
    [30 * 60 * 1000],
  );

  // ─── Relationship Intelligence Cron Jobs ───

  // Channel scanner — every 6 hours (captures sent + received messages from all channels)
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('system', 'scan_channels', 'Scan all connected channels for sent and received messages',
       'cron', '0 */6 * * *', 'Europe/Vienna', 'isolated', 'system_event', 'scan_channels', true)
     ON CONFLICT (name) DO NOTHING`,
  );

  // Birthday checker — daily at 8 AM
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('system', 'check_birthdays', 'Check for upcoming birthdays and create Things tasks',
       'cron', '0 8 * * *', 'Europe/Vienna', 'isolated', 'system_event', 'check_birthdays', true)
     ON CONFLICT (name) DO NOTHING`,
  );

  // Relationship analysis — Radar agent, Sunday 9 AM
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('radar', 'analyze_relationships_weekly', 'Weekly relationship analysis across all contacts',
       'cron', '0 9 * * 0', 'Europe/Vienna', 'isolated', 'agent_turn',
       $1, true)
     ON CONFLICT (name) DO NOTHING`,
    [`Analyze my relationships for this week.

1. Use contacts_interactions_list to get all interactions from the past 7 days.
2. For each contact with interactions this week, build a relationship profile:
   - Relationship type: close_friend / friend / acquaintance / business / family
   - Communication patterns: frequency, preferred channels, typical times
   - Recent topics discussed (from interaction summaries)
   - Sentiment and engagement level
3. For each active contact, use obsidian_write to create or update their People note at "People/{FirstName} {LastName}.md":
   - Use obsidian_read first to check if the note already exists
   - If it exists, preserve ALL existing content (especially ## About and ## Notes sections written by Marcus)
   - Only add/update the ## Relationship and ## Recent Activity sections
   - Keep the existing frontmatter (contact_id) and add relationship_type + analyzed_at
   - For new notes, use this structure:
     ---
     contact_id: {id}
     relationship_type: {type}
     analyzed_at: {ISO date}
     ---
     # {Name}

     ## About
     {role, company, context}

     ## Relationship
     {type, how connected, communication style}

     ## Recent Activity
     {last 7 days: channels used, topics discussed, frequency}

     ## Notes
     {empty — for Marcus to fill in manually}
4. Use contacts_update_extra to store computed metadata on each contact:
   { relationship_type, frequency_score, last_topic, primary_channel, analyzed_at }
   This enables quick filtering/sorting without reading Obsidian.
5. For significant relationship changes or insights that span multiple people,
   use memory_store with tag "relationships" (e.g. "Marcus reconnected with Alex after 3 months").
6. Check for contacts with last_contacted_at > 30 days ago — list any that might need follow-up.
7. Summarize findings for Marcus: who was most active, any dormant relationships to revive, upcoming context to be aware of.`],
  );

  // Weekly store audit — Sunday 10 AM
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('store-auditor', 'weekly-store-audit', 'Weekly audit of the knowledge store for stale, duplicate, or low-quality entries',
       'cron', '0 10 * * 0', 'Europe/Vienna', 'isolated', 'agent_turn',
       'Audit the JOI knowledge store. Check for stale entries, duplicates, low-quality or orphaned items. Summarize findings and clean up where appropriate.', true)
     ON CONFLICT (name) DO NOTHING`,
  );

  // Weekly skill audit — Monday 9 AM
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('skill-scout', 'weekly-skill-audit', 'Weekly audit of skills and skill suggestions',
       'cron', '0 9 * * 1', 'Europe/Vienna', 'isolated', 'agent_turn',
       'Audit JOI and Claude Code skills. Check for outdated skills, missing capabilities, and suggest improvements or new skills based on recent usage patterns.', true)
     ON CONFLICT (name) DO NOTHING`,
  );

  // Daily knowledge sync — daily 8 AM
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('knowledge-sync', 'daily-knowledge-sync', 'Daily sync and maintenance of knowledge base across all sources',
       'cron', '0 8 * * *', 'Europe/Vienna', 'isolated', 'agent_turn',
       'Sync and maintain the knowledge base. Check for new content across connected sources, update stale entries, and ensure consistency between Obsidian, Outline, and the store.', true)
     ON CONFLICT (name) DO NOTHING`,
  );

  // ─── OKR Coach Cron Jobs ───

  // Monday morning OKR check-in — 8:30 AM Vienna time
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('okr-coach', 'okr_monday_checkin', 'Monday OKR check-in: review KR progress and set weekly priorities',
       'cron', '30 8 * * 1', 'Europe/Vienna', 'isolated', 'agent_turn',
       $1, true)
     ON CONFLICT (name) DO NOTHING`,
    [`It's Monday morning — time for the weekly OKR check-in.

1. Use okr_score_all to recalculate all scores from current values.
2. Use okr_report to generate the current quarter's status report.
3. For any KRs that are RED (score < 0.4), highlight them prominently and suggest what might help.
4. For any KRs that moved from green to yellow, flag them as early warnings.
5. Use okr_sync_things3 to push updated progress to Things3.
6. Create a review item summarizing the weekly OKR status with:
   - type: "info"
   - title: "Weekly OKR Check-in: [date]"
   - tags: ["okr", "weekly"]
   - Include the full report in the content.`],
  );

  // Friday afternoon OKR scorecard — 5:00 PM Vienna time
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('okr-coach', 'okr_friday_scorecard', 'Friday OKR scorecard: end-of-week progress summary',
       'cron', '0 17 * * 5', 'Europe/Vienna', 'isolated', 'agent_turn',
       $1, true)
     ON CONFLICT (name) DO NOTHING`,
    [`It's Friday evening — generate the weekly OKR scorecard.

1. Use okr_score_all to ensure all scores are current.
2. Use okr_report to generate the status report.
3. Compare this week's scores against last week (check the most recent check-ins for each KR using store_query on "OKR Check-ins").
4. Highlight wins: any KRs that improved significantly this week.
5. Use okr_sync_things3 to update Things3 with final weekly state.
6. Create a review item with the weekly scorecard:
   - type: "info"
   - title: "Friday OKR Scorecard: [date]"
   - tags: ["okr", "weekly", "scorecard"]
   - Include score changes, wins, and areas needing attention.`],
  );

  // ─── Quality Center nightly test runs ───
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('system', 'run_qa_tests', 'Nightly QA test suite execution across all enabled suites',
       'cron', '0 3 * * *', 'Europe/Vienna', 'isolated', 'system_event', 'run_qa_tests', true)
     ON CONFLICT (name) DO NOTHING`,
  );

  // Weekly soul rollout evaluation — Sunday 7 AM
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('system', 'evaluate_soul_rollouts_weekly', 'Weekly evaluation/promotion/rollback pass for active soul canaries',
       'cron', '0 7 * * 0', 'Europe/Vienna', 'isolated', 'system_event', 'evaluate_soul_rollouts', true)
     ON CONFLICT (name) DO NOTHING`,
  );

  // Monthly soul governance review — first day of month at 9 AM
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('system', 'soul_governance_monthly_review', 'Monthly governance summary and review item for soul lifecycle quality',
       'cron', '0 9 1 * *', 'Europe/Vienna', 'isolated', 'system_event', 'soul_governance_review', true)
     ON CONFLICT (name) DO NOTHING`,
  );

  // ─── Bookmark sync — every 30 minutes ───
  await query(
    `INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
       schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
     VALUES ('system', 'sync_bookmarks', 'Sync bookmarks from Chrome browser',
       'cron', '*/30 * * * *', 'Europe/Vienna', 'isolated', 'system_event', 'sync_bookmarks', true)
     ON CONFLICT (name) DO NOTHING`,
  );

  console.log("[Server] Built-in cron jobs registered");
}

// Start
const port = config.gateway.port;
const host = config.gateway.host;

server.listen(port, host, () => {
  console.log(`
╔═══════════════════════════════════════╗
║         JOI Gateway v0.1.0            ║
║                                       ║
║  HTTP:  http://${host}:${port}           ║
║  WS:    ws://${host}:${port}/ws          ║
╚═══════════════════════════════════════╝
  `);

  // Start cron scheduler
  startScheduler(config);

  // Register built-in system cron jobs (idempotent)
  registerBuiltInJobs().catch((err) =>
    console.warn("[Server] Failed to register built-in cron jobs:", err),
  );

  // Start Obsidian vault watcher if configured
  if (config.obsidian.syncEnabled && config.obsidian.vaultPath) {
    startWatching(config);
  }

  // Migrate legacy Google token file to DB (one-time, idempotent)
  migrateFileTokensToDb().catch((err) =>
    console.warn("[Server] Failed to migrate Google tokens:", err),
  );

  // Init channel manager (auto-connects enabled channels)
  initChannelManager(config, broadcast).catch((err) =>
    console.warn("[Server] Failed to init channel manager:", err),
  );

  // Start cloud sync scheduler
  startSyncScheduler((pairId, run) => {
    broadcast("cloud-sync.completed", { pairId, run });
  });
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await shutdownAllChannels();
  killAllSessions();
  stopScheduler();
  stopSyncScheduler();
  stopWatching();
  wss.close();
  server.close();
  process.exit(0);
});
