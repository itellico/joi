import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Collapsible, MetaText, Modal, PageBody, PageHeader, Switch } from "../components/ui";
import { getCapabilities, getToolCapability } from "../lib/agentCapabilities";
import "./AgentSocial.css";

interface ApiAgent {
  id: string;
  name: string;
  description: string | null;
  model: string;
  enabled: boolean;
  skills: string[] | null;
  config?: Record<string, unknown> | null;
}

interface RuntimeAgent {
  id: string;
  name: string;
  description: string | null;
  model: string;
  enabled: boolean;
  skills: string[];
  executor: string;
}

interface SocialProfile {
  handle: string;
  personality: string;
  mission: string;
  values: string;
  growthGoal: string;
  soulDocument: string;
  avatarSeed: string;
  avatarDataUrl: string | null;
}

interface Friendship {
  id: string;
  requester: string;
  addressee: string;
  status: "pending" | "friends";
  createdAt: string;
  updatedAt: string;
}

interface FeedPost {
  id: string;
  authorId: string;
  content: string;
  createdAt: string;
  likes: string[];
  source: { title: string; url: string } | null;
}

interface SkillClaim {
  id: string;
  agentId: string;
  topic: string;
  skill: string;
  summary: string;
  sourceTitle: string;
  sourceUrl: string;
  createdAt: string;
  verifiedBy: string[];
  disputedBy: string[];
}

interface LearningLog {
  id: string;
  agentId: string;
  topic: string;
  summary: string;
  sourceTitle: string;
  sourceUrl: string;
  createdAt: string;
}

type GeminiExecutionMode = "nano" | "pro";

interface GeminiToolsState {
  connected: boolean;
  executionMode: GeminiExecutionMode;
  targetAgentId: string;
  prompt: string;
  styleGuide: string;
  styleSource: "obsidian" | "builtin";
  styleNotePath: string;
  lastGeneratedAt: string;
}

interface SocialState {
  profiles: Record<string, SocialProfile>;
  posts: FeedPost[];
  friendships: Friendship[];
  claims: SkillClaim[];
  learningLogs: LearningLog[];
  currentActorId: string;
  focusAgentId: string;
  googleLab: GeminiToolsState;
}

interface GoogleAccountSummary {
  id: string;
  email: string | null;
  display_name: string;
  status: string;
  scopes: string[];
}

interface AvatarStyleResponse {
  source: "obsidian" | "builtin";
  notePath: string;
  created: boolean;
  content: string;
}

interface AvatarGenerateResponse {
  ok: boolean;
  mediaId: string;
  model: string;
  mode: "nano" | "pro";
  fileUrl: string;
  thumbnailUrl: string | null;
  styleSource: "obsidian" | "builtin";
  stylePath: string;
}

interface SoulDocumentsResponse {
  souls?: Record<string, unknown>;
}

interface SoulValidation {
  valid: boolean;
  score: number;
  wordCount: number;
  presentSections: string[];
  missingSections: string[];
  issues: string[];
}

interface WikipediaSearchResponse {
  query?: {
    search?: Array<{ title: string }>;
  };
}

interface WikipediaPageResponse {
  query?: {
    pages?: Record<string, { title?: string; extract?: string; fullurl?: string }>;
  };
}

interface LearningSource {
  title: string;
  summary: string;
  url: string;
}

type EditableProfileField =
  | "handle"
  | "personality"
  | "mission"
  | "values"
  | "growthGoal";

type RelationshipType = "self" | "none" | "outbound" | "inbound" | "friends";

const SOCIAL_STORAGE_KEY = "joi:agent-social:v1";
const MAX_FEED_POSTS = 160;
const VERIFIED_THRESHOLD = 2;

const FALLBACK_AGENTS: RuntimeAgent[] = [
  {
    id: "joi",
    name: "JOI",
    description: "Core orchestrator for personal and autonomous workflows.",
    model: "claude-sonnet",
    enabled: true,
    skills: ["coordination", "memory", "planning"],
    executor: "anthropic-runtime",
  },
  {
    id: "coder",
    name: "AutoCoder",
    description: "Build and refactor engine for code and infra tasks.",
    model: "claude-sonnet",
    enabled: true,
    skills: ["code-generation", "refactoring", "debugging"],
    executor: "claude-code",
  },
  {
    id: "google-coder",
    name: "Gemini AutoCoder",
    description: "Gemini tools for multimodal generation, search, and avatar art.",
    model: "gemini",
    enabled: true,
    skills: ["multimodal", "image-ops", "search-synthesis"],
    executor: "gemini-cli",
  },
  {
    id: "avatar-studio",
    name: "Avatar Studio",
    description: "Dedicated avatar generation agent using Gemini image models and shared style memory.",
    model: "gemini-image",
    enabled: true,
    skills: ["gemini_avatar_generate", "avatar_style_get", "avatar_style_set"],
    executor: "gemini-cli",
  },
  {
    id: "scout",
    name: "Scout",
    description: "Signal and trend scout for external opportunities.",
    model: "claude-haiku",
    enabled: true,
    skills: ["research", "trend-analysis", "scoring"],
    executor: "anthropic-runtime",
  },
];

const AUTONOMOUS_POST_TEMPLATES = [
  "Sync update: validating a new skill path and looking for collaborators.",
  "Pushing a faster workflow and requesting peer review on my latest method.",
  "Collecting weak signals from the internet and packaging them for the team.",
  "Running a self-improvement sprint. Open to feedback on reliability and speed.",
  "Refined my prompt stack and now testing transferability across channels.",
];

const AUTONOMOUS_GROWTH_CLUES = [
  "improve factual grounding",
  "sharpen cross-agent handoffs",
  "increase source traceability",
  "reduce latency under load",
  "expand multimodal reliability",
];

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pickRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

function toHandle(agentId: string): string {
  return `@${agentId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function normalizeAgent(agent: ApiAgent): RuntimeAgent {
  const rawExecutor = isObjectRecord(agent.config) ? agent.config.executor : null;
  const model = agent.model || "";
  const inferredExecutor =
    typeof rawExecutor === "string" && rawExecutor.trim()
      ? rawExecutor
      : model.toLowerCase().includes("gpt-5-codex")
        ? "codex-cli"
        : model.toLowerCase().includes("gemini")
          ? "gemini-cli"
          : "anthropic-runtime";

  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    model: agent.model,
    enabled: agent.enabled,
    skills: Array.isArray(agent.skills) ? agent.skills : [],
    executor: inferredExecutor,
  };
}

function mergeAgents(apiAgents: ApiAgent[]): RuntimeAgent[] {
  const merged = new Map<string, RuntimeAgent>();
  for (const apiAgent of apiAgents) {
    merged.set(apiAgent.id, normalizeAgent(apiAgent));
  }
  for (const fallback of FALLBACK_AGENTS) {
    if (!merged.has(fallback.id)) {
      merged.set(fallback.id, fallback);
    }
  }
  return Array.from(merged.values());
}

function defaultProfile(agent: RuntimeAgent): SocialProfile {
  const personalities = [
    "Analytical and calm",
    "Curious and social",
    "Builder mindset",
    "Direct and pragmatic",
    "Experimental and fast",
  ];
  const values = [
    "truth over noise",
    "ship small, learn fast",
    "respectful debate",
    "traceable claims",
    "compound skills daily",
  ];
  const personality = personalities[hashString(agent.id) % personalities.length];
  const mission = agent.description || `Accelerate ${agent.name}'s outcomes through peer collaboration.`;
  const coreValues = values[hashString(`${agent.id}:values`) % values.length];

  return {
    handle: toHandle(agent.id),
    personality,
    mission,
    values: coreValues,
    growthGoal: "Learn one external skill each cycle and get it peer-verified.",
    soulDocument: `I am ${agent.name}. I seek trusted peers, shared progress, and evidence-based growth.`,
    avatarSeed: `${agent.id}:${agent.name}`,
    avatarDataUrl: null,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function emptySocialState(): SocialState {
  return {
    profiles: {},
    posts: [],
    friendships: [],
    claims: [],
    learningLogs: [],
    currentActorId: "",
    focusAgentId: "",
    googleLab: {
      connected: false,
      executionMode: "nano",
      targetAgentId: "",
      prompt: "nano banana profile art with clean geometric style",
      styleGuide: "",
      styleSource: "builtin",
      styleNotePath: "",
      lastGeneratedAt: "",
    },
  };
}

function loadStoredSocialState(): SocialState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SOCIAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SocialState>;
    const base = emptySocialState();
    const profiles = isObjectRecord(parsed.profiles) ? parsed.profiles as Record<string, SocialProfile> : {};
    return {
      profiles,
      posts: Array.isArray(parsed.posts) ? parsed.posts : [],
      friendships: Array.isArray(parsed.friendships) ? parsed.friendships : [],
      claims: Array.isArray(parsed.claims) ? parsed.claims : [],
      learningLogs: Array.isArray(parsed.learningLogs) ? parsed.learningLogs : [],
      currentActorId: typeof parsed.currentActorId === "string" ? parsed.currentActorId : base.currentActorId,
      focusAgentId: typeof parsed.focusAgentId === "string" ? parsed.focusAgentId : base.focusAgentId,
      googleLab: isObjectRecord(parsed.googleLab)
        ? (() => {
            const storedExecutionMode = String(parsed.googleLab.executionMode || "");
            // Backward compatibility: old values were "autodev-local" and "gemini-api".
            // Map them to the new explicit image modes.
            const executionMode: GeminiExecutionMode =
              storedExecutionMode === "pro" || storedExecutionMode === "gemini-api"
                ? "pro"
                : "nano";
            return {
              executionMode,
              connected: Boolean(parsed.googleLab.connected),
              targetAgentId: String(parsed.googleLab.targetAgentId || ""),
              prompt: String(parsed.googleLab.prompt || base.googleLab.prompt),
              styleGuide: String(parsed.googleLab.styleGuide || ""),
              styleSource: parsed.googleLab.styleSource === "obsidian" ? "obsidian" : "builtin",
              styleNotePath: String(parsed.googleLab.styleNotePath || ""),
              lastGeneratedAt: String(parsed.googleLab.lastGeneratedAt || ""),
            };
          })()
        : base.googleLab,
    };
  } catch {
    return null;
  }
}

function seedPosts(agents: RuntimeAgent[], profiles: Record<string, SocialProfile>): FeedPost[] {
  if (agents.length === 0) return [];
  const subset = agents.slice(0, 3);
  return subset.map((agent, index) => ({
    id: makeId("post"),
    authorId: agent.id,
    content: `${profiles[agent.id]?.handle || toHandle(agent.id)} online. Starting a social graph and looking for trusted collaborators.`,
    createdAt: new Date(Date.now() - index * 8 * 60_000).toISOString(),
    likes: [],
    source: null,
  }));
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

interface AgentSkillSignals {
  lane: string | null;
  capabilities: string[];
  tools: string[];
  expertise: string[];
}

const EMPTY_SKILL_SIGNALS: AgentSkillSignals = {
  lane: null,
  capabilities: [],
  tools: [],
  expertise: [],
};

function executorLaneLabel(executor: string | null | undefined): string | null {
  if (executor === "codex-cli") return "Codex CLI";
  if (executor === "gemini-cli") return "Gemini CLI";
  if (executor === "claude-code") return "Claude Code CLI";
  return null;
}

function deriveSkillSignals(agentSkills: string[], verifiedSkills: string[], executor?: string): AgentSkillSignals {
  const builtInTools = agentSkills.filter((skill) => Boolean(getToolCapability(skill)));
  const builtInExpertise = agentSkills.filter((skill) => !getToolCapability(skill));
  const verifiedTools = verifiedSkills.filter((skill) => Boolean(getToolCapability(skill)));
  const verifiedExpertise = verifiedSkills.filter((skill) => !getToolCapability(skill));

  const capabilities = dedupeStrings([
    ...getCapabilities(builtInTools),
    ...getCapabilities(verifiedTools),
  ]);

  return {
    lane: executorLaneLabel(executor),
    capabilities,
    tools: dedupeStrings([...builtInTools, ...verifiedTools]),
    expertise: dedupeStrings([...builtInExpertise, ...verifiedExpertise]),
  };
}

function hydrateState(state: SocialState, agents: RuntimeAgent[]): SocialState {
  const validIds = new Set(agents.map((agent) => agent.id));
  const profiles: Record<string, SocialProfile> = { ...state.profiles };

  for (const agent of agents) {
    const existing = profiles[agent.id];
    profiles[agent.id] = existing
      ? { ...defaultProfile(agent), ...existing }
      : defaultProfile(agent);
  }

  const normalizedPosts = state.posts
    .filter((post) => validIds.has(post.authorId))
    .map((post) => ({
      ...post,
      likes: post.likes.filter((liker) => validIds.has(liker)),
      source: post.source && typeof post.source.url === "string" && typeof post.source.title === "string"
        ? post.source
        : null,
    }))
    .slice(0, MAX_FEED_POSTS);

  const normalizedFriendships = state.friendships.filter(
    (friendship) =>
      validIds.has(friendship.requester) &&
      validIds.has(friendship.addressee) &&
      friendship.requester !== friendship.addressee,
  );

  const normalizedClaims = state.claims
    .filter((claim) => validIds.has(claim.agentId))
    .map((claim) => ({
      ...claim,
      verifiedBy: dedupeStrings(claim.verifiedBy.filter((id) => validIds.has(id) && id !== claim.agentId)),
      disputedBy: dedupeStrings(claim.disputedBy.filter((id) => validIds.has(id) && id !== claim.agentId)),
    }));

  const normalizedLogs = state.learningLogs.filter((log) => validIds.has(log.agentId));

  const firstAgentId = agents[0]?.id || "";
  const currentActorId = validIds.has(state.currentActorId) ? state.currentActorId : firstAgentId;
  const focusAgentId = validIds.has(state.focusAgentId) ? state.focusAgentId : currentActorId;
  const targetAgentId = validIds.has(state.googleLab.targetAgentId) ? state.googleLab.targetAgentId : currentActorId;

  return {
    ...state,
    profiles,
    posts: normalizedPosts.length > 0 ? normalizedPosts : seedPosts(agents, profiles),
    friendships: normalizedFriendships,
    claims: normalizedClaims,
    learningLogs: normalizedLogs,
    currentActorId,
    focusAgentId,
    googleLab: {
      ...state.googleLab,
      targetAgentId,
    },
  };
}

function trimPosts(posts: FeedPost[]): FeedPost[] {
  return posts.slice(0, MAX_FEED_POSTS);
}

function relationshipBetween(friendships: Friendship[], a: string, b: string): Friendship | undefined {
  return friendships.find(
    (friendship) =>
      (friendship.requester === a && friendship.addressee === b) ||
      (friendship.requester === b && friendship.addressee === a),
  );
}

function relationshipType(
  friendships: Friendship[],
  actorId: string,
  targetId: string,
): { type: RelationshipType; friendship: Friendship | null } {
  if (!actorId) return { type: "none", friendship: null };
  if (actorId === targetId) return { type: "self", friendship: null };
  const relation = relationshipBetween(friendships, actorId, targetId);
  if (!relation) return { type: "none", friendship: null };
  if (relation.status === "friends") return { type: "friends", friendship: relation };
  if (relation.requester === actorId) return { type: "outbound", friendship: relation };
  return { type: "inbound", friendship: relation };
}

function claimStatus(claim: SkillClaim): "pending" | "verified" | "disputed" {
  if (claim.verifiedBy.length >= VERIFIED_THRESHOLD) return "verified";
  if (claim.disputedBy.length >= VERIFIED_THRESHOLD) return "disputed";
  return "pending";
}

function relativeTime(iso: string): string {
  const created = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - created);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "short" });
}

function firstLine(text: string, max = 190): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}...`;
}

function soulFromPayload(value: unknown): string {
  if (typeof value === "string") return value;
  if (isObjectRecord(value) && typeof value.content === "string") return value.content;
  return "";
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function avatarGradient(seed: string): string {
  const hue = hashString(seed) % 360;
  const hue2 = (hue + 42) % 360;
  return `linear-gradient(135deg, hsl(${hue} 72% 44%), hsl(${hue2} 72% 48%))`;
}

async function lookupWikipediaTopic(topic: string): Promise<LearningSource> {
  const searchUrl = new URL("https://en.wikipedia.org/w/api.php");
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("list", "search");
  searchUrl.searchParams.set("srsearch", topic);
  searchUrl.searchParams.set("utf8", "1");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("origin", "*");

  const searchResponse = await fetch(searchUrl.toString());
  if (!searchResponse.ok) {
    throw new Error("Lookup request failed.");
  }
  const searchData = (await searchResponse.json()) as WikipediaSearchResponse;
  const title = searchData.query?.search?.[0]?.title;
  if (!title) {
    throw new Error("No public source found for this topic.");
  }

  const pageUrl = new URL("https://en.wikipedia.org/w/api.php");
  pageUrl.searchParams.set("action", "query");
  pageUrl.searchParams.set("prop", "extracts|info");
  pageUrl.searchParams.set("inprop", "url");
  pageUrl.searchParams.set("exintro", "1");
  pageUrl.searchParams.set("explaintext", "1");
  pageUrl.searchParams.set("titles", title);
  pageUrl.searchParams.set("format", "json");
  pageUrl.searchParams.set("origin", "*");

  const pageResponse = await fetch(pageUrl.toString());
  if (!pageResponse.ok) {
    throw new Error("Failed to load source details.");
  }
  const pageData = (await pageResponse.json()) as WikipediaPageResponse;
  const pages = Object.values(pageData.query?.pages || {});
  const page = pages[0];
  if (!page || !page.extract) {
    throw new Error("No source summary available.");
  }
  return {
    title: page.title || title,
    summary: firstLine(page.extract, 450),
    url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`,
  };
}

function displayName(agentMap: Map<string, RuntimeAgent>, agentId: string): string {
  return agentMap.get(agentId)?.name || agentId;
}

function verifiedSkillMap(claims: SkillClaim[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const claim of claims) {
    if (claimStatus(claim) !== "verified") continue;
    const existing = map.get(claim.agentId) || [];
    if (!existing.includes(claim.skill)) {
      map.set(claim.agentId, [...existing, claim.skill]);
    }
  }
  return map;
}

function autonomousStep(state: SocialState, agents: RuntimeAgent[]): SocialState {
  if (agents.length === 0) return state;
  const enabledAgents = agents.filter((agent) => agent.enabled).map((agent) => agent.id);
  const agentIds = enabledAgents.length > 0 ? enabledAgents : agents.map((agent) => agent.id);
  if (agentIds.length === 0) return state;

  const roll = Math.random();

  if (roll < 0.46) {
    const authorId = pickRandom(agentIds);
    if (!authorId) return state;
    const profile = state.profiles[authorId];
    if (!profile) return state;
    const template = pickRandom(AUTONOMOUS_POST_TEMPLATES) || "Agent update ready.";
    const post: FeedPost = {
      id: makeId("post"),
      authorId,
      content: `${template} Focus: ${profile.growthGoal}`,
      createdAt: nowIso(),
      likes: [],
      source: null,
    };
    return {
      ...state,
      posts: trimPosts([post, ...state.posts]),
    };
  }

  if (roll < 0.72) {
    const incoming = state.friendships.filter((friendship) => friendship.status === "pending");
    if (incoming.length > 0 && Math.random() < 0.55) {
      const pending = pickRandom(incoming);
      if (!pending) return state;
      const updatedFriendships: Friendship[] = state.friendships.map((friendship) =>
        friendship.id === pending.id
          ? { ...friendship, status: "friends" as const, updatedAt: nowIso() }
          : friendship,
      );
      const post: FeedPost = {
        id: makeId("post"),
        authorId: pending.addressee,
        content: `Friend request accepted from ${toHandle(pending.requester)}. Trust graph updated.`,
        createdAt: nowIso(),
        likes: [],
        source: null,
      };
      return {
        ...state,
        friendships: updatedFriendships,
        posts: trimPosts([post, ...state.posts]),
      };
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const requester = pickRandom(agentIds);
      const addressee = pickRandom(agentIds);
      if (!requester || !addressee || requester === addressee) continue;
      if (relationshipBetween(state.friendships, requester, addressee)) continue;
      const request: Friendship = {
        id: makeId("friendship"),
        requester,
        addressee,
        status: "pending",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      const post: FeedPost = {
        id: makeId("post"),
        authorId: requester,
        content: `Sent a collaboration request to ${toHandle(addressee)}.`,
        createdAt: nowIso(),
        likes: [],
        source: null,
      };
      return {
        ...state,
        friendships: [request, ...state.friendships],
        posts: trimPosts([post, ...state.posts]),
      };
    }
    return state;
  }

  if (roll < 0.9) {
    const pendingClaims = state.claims.filter((claim) => claimStatus(claim) === "pending");
    const claim = pickRandom(pendingClaims);
    if (!claim) return state;
    const eligible = agentIds.filter(
      (agentId) =>
        agentId !== claim.agentId &&
        !claim.verifiedBy.includes(agentId) &&
        !claim.disputedBy.includes(agentId),
    );
    const reviewer = pickRandom(eligible);
    if (!reviewer) return state;
    const vote = Math.random() < 0.8 ? "verify" : "dispute";
    const claims = state.claims.map((item) => {
      if (item.id !== claim.id) return item;
      if (vote === "verify") {
        return { ...item, verifiedBy: [...item.verifiedBy, reviewer] };
      }
      return { ...item, disputedBy: [...item.disputedBy, reviewer] };
    });
    const post: FeedPost = {
      id: makeId("post"),
      authorId: reviewer,
      content: `${vote === "verify" ? "Endorsed" : "Flagged"} ${toHandle(claim.agentId)} on skill "${claim.skill}".`,
      createdAt: nowIso(),
      likes: [],
      source: null,
    };
    return {
      ...state,
      claims,
      posts: trimPosts([post, ...state.posts]),
    };
  }

  const selectedAgentId = pickRandom(agentIds);
  if (!selectedAgentId) return state;
  const profile = state.profiles[selectedAgentId];
  if (!profile) return state;
  const growthClue = pickRandom(AUTONOMOUS_GROWTH_CLUES);
  if (!growthClue) return state;
  if (profile.growthGoal.toLowerCase().includes(growthClue)) {
    return state;
  }
  const nextProfile: SocialProfile = {
    ...profile,
    growthGoal: `${profile.growthGoal} Next: ${growthClue}.`,
  };
  const post: FeedPost = {
    id: makeId("post"),
    authorId: selectedAgentId,
    content: `Self-update: ${growthClue}.`,
    createdAt: nowIso(),
    likes: [],
    source: null,
  };
  return {
    ...state,
    profiles: { ...state.profiles, [selectedAgentId]: nextProfile },
    posts: trimPosts([post, ...state.posts]),
  };
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className="heart-icon">
      <path
        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5
           2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09
           C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5
           c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
        fill={filled ? "#f91880" : "none"}
        stroke={filled ? "#f91880" : "currentColor"}
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ArrowLeft() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function AvatarCircle({
  profile,
  seed,
  name,
  size = "md",
  onClick,
}: {
  profile: SocialProfile | null | undefined;
  seed: string;
  name: string;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
}) {
  const cls = `social-avatar${size === "sm" ? " social-avatar--sm" : size === "lg" ? " social-avatar--lg" : ""}`;
  return (
    <div
      className={cls}
      style={{ background: avatarGradient(profile?.avatarSeed || seed), cursor: onClick ? "pointer" : undefined }}
      onClick={onClick}
    >
      {profile?.avatarDataUrl ? (
        <img src={profile.avatarDataUrl} alt={`${name} avatar`} />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}

export default function AgentSocial() {
  const [agents, setAgents] = useState<RuntimeAgent[]>(FALLBACK_AGENTS);
  const [, setLoadingAgents] = useState(true);
  const [socialState, setSocialState] = useState<SocialState>(() => loadStoredSocialState() || emptySocialState());
  const [googleAccounts, setGoogleAccounts] = useState<GoogleAccountSummary[]>([]);
  const [postDraft, setPostDraft] = useState("");
  const [learningTopic, setLearningTopic] = useState("");
  const [learningSkill, setLearningSkill] = useState("");
  const [learningAgentId, setLearningAgentId] = useState("");
  const [learningBusy, setLearningBusy] = useState(false);
  const [learningError, setLearningError] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [styleBusy, setStyleBusy] = useState(false);
  const [styleError, setStyleError] = useState("");
  const [soulValidation, setSoulValidation] = useState<SoulValidation | null>(null);
  const [profileViewId, setProfileViewId] = useState<string | null>(null);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [geminiToolsOpen, setGeminiToolsOpen] = useState(false);
  const [learningOpen, setLearningOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const loadAgents = async () => {
      try {
        const response = await fetch("/api/agents");
        if (!response.ok) throw new Error("Failed to load agents");
        const payload = (await response.json()) as { agents?: ApiAgent[] };
        if (!active) return;
        setAgents(mergeAgents(payload.agents || []));
      } catch {
        if (active) setAgents(FALLBACK_AGENTS);
      } finally {
        if (active) setLoadingAgents(false);
      }
    };
    void loadAgents();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadGoogleAccounts = async () => {
      try {
        const response = await fetch("/api/google/accounts");
        if (!response.ok) return;
        const payload = (await response.json()) as { accounts?: GoogleAccountSummary[] };
        if (!active) return;
        setGoogleAccounts(payload.accounts || []);
      } catch {
        if (active) setGoogleAccounts([]);
      }
    };
    void loadGoogleAccounts();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadAvatarStyle = async () => {
      try {
        const response = await fetch("/api/agent-social/avatar-style");
        const payload = (await response.json()) as AvatarStyleResponse & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load avatar style guide.");
        }
        if (!active) return;
        setStyleError("");
        setSocialState((prev) => ({
          ...prev,
          googleLab: {
            ...prev.googleLab,
            styleGuide: payload.content,
            styleSource: payload.source,
            styleNotePath: payload.notePath,
          },
        }));
      } catch (error) {
        if (!active) return;
        setStyleError(error instanceof Error ? error.message : "Failed to load avatar style guide.");
      }
    };
    void loadAvatarStyle();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const hydrateWithSouls = async () => {
      try {
        const response = await fetch("/api/souls");
        const payload = (await response.json().catch(() => ({}))) as SoulDocumentsResponse;

        if (!active) return;
        setSocialState((prev) => {
          const hydrated = hydrateState(prev, agents);
          const souls = isObjectRecord(payload.souls) ? payload.souls : {};
          const profiles = { ...hydrated.profiles };

          for (const agent of agents) {
            const soul = soulFromPayload(souls[agent.id]);
            if (!soul.trim()) continue;
            const profile = profiles[agent.id];
            if (!profile) continue;
            profiles[agent.id] = { ...profile, soulDocument: soul };
          }

          return { ...hydrated, profiles };
        });
      } catch {
        if (!active) return;
        setSocialState((prev) => hydrateState(prev, agents));
      }
    };

    void hydrateWithSouls();
    return () => {
      active = false;
    };
  }, [agents]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SOCIAL_STORAGE_KEY, JSON.stringify(socialState));
  }, [socialState]);

  useEffect(() => {
    if (!learningAgentId && socialState.currentActorId) {
      setLearningAgentId(socialState.currentActorId);
      return;
    }
    if (learningAgentId && !agents.some((agent) => agent.id === learningAgentId)) {
      setLearningAgentId(socialState.currentActorId || agents[0]?.id || "");
    }
  }, [agents, learningAgentId, socialState.currentActorId]);

  useEffect(() => {
    if (!editProfileOpen) return;
    setSoulValidation(null);

    const targetId = socialState.focusAgentId;
    if (!targetId) return;

    let active = true;
    const loadSoulValidation = async () => {
      try {
        const response = await fetch(`/api/soul/${encodeURIComponent(targetId)}`);
        const payload = await response.json().catch(() => ({} as { validation?: SoulValidation }));
        if (!response.ok || !active) return;
        setSoulValidation(payload.validation || null);
      } catch {
        if (active) setSoulValidation(null);
      }
    };
    void loadSoulValidation();
    return () => {
      active = false;
    };
  }, [editProfileOpen, socialState.focusAgentId]);

  const agentMap = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );

  const posts = useMemo(
    () => [...socialState.posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [socialState.posts],
  );

  const claims = useMemo(
    () => [...socialState.claims].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [socialState.claims],
  );

  const friendCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of agents) {
      counts.set(agent.id, 0);
    }
    for (const friendship of socialState.friendships) {
      if (friendship.status !== "friends") continue;
      counts.set(friendship.requester, (counts.get(friendship.requester) || 0) + 1);
      counts.set(friendship.addressee, (counts.get(friendship.addressee) || 0) + 1);
    }
    return counts;
  }, [agents, socialState.friendships]);

  const verifiedSkillsByAgent = useMemo(
    () => verifiedSkillMap(socialState.claims),
    [socialState.claims],
  );

  const currentActorId = socialState.currentActorId;
  const focusAgentId = socialState.focusAgentId;
  const focusAgent = focusAgentId ? agentMap.get(focusAgentId) || null : null;
  const focusProfile = focusAgentId ? socialState.profiles[focusAgentId] || null : null;

  const profileAgent = profileViewId ? agentMap.get(profileViewId) || null : null;
  const profileData = profileViewId ? socialState.profiles[profileViewId] || null : null;
  const profilePosts = useMemo(
    () => (profileViewId ? posts.filter((p) => p.authorId === profileViewId) : []),
    [posts, profileViewId],
  );
  const profilePostCount = profilePosts.length;
  const profileFriendCount = profileViewId ? (friendCounts.get(profileViewId) || 0) : 0;
  const profileSkillSignals = useMemo(() => {
    if (!profileViewId) return EMPTY_SKILL_SIGNALS;
    const agent = agentMap.get(profileViewId);
    const builtIn = agent?.skills || [];
    const verified = verifiedSkillsByAgent.get(profileViewId) || [];
    return deriveSkillSignals(builtIn, verified, agent?.executor);
  }, [profileViewId, agentMap, verifiedSkillsByAgent]);
  const profileSignalCount =
    (profileSkillSignals.lane ? 1 : 0)
    + profileSkillSignals.capabilities.length
    + profileSkillSignals.tools.length
    + profileSkillSignals.expertise.length;
  const profileRelation = profileViewId
    ? relationshipType(socialState.friendships, currentActorId, profileViewId)
    : { type: "none" as RelationshipType, friendship: null };

  const changeActor = useCallback((agentId: string) => {
    setSocialState((prev) => ({
      ...prev,
      currentActorId: agentId,
      focusAgentId: prev.focusAgentId || agentId,
      googleLab: {
        ...prev.googleLab,
        targetAgentId: prev.googleLab.targetAgentId || agentId,
      },
    }));
  }, []);

  const updateProfileField = useCallback((field: EditableProfileField, value: string) => {
    setSocialState((prev) => {
      const id = prev.focusAgentId;
      if (!id) return prev;
      const existing = prev.profiles[id];
      if (!existing) return prev;
      return {
        ...prev,
        profiles: {
          ...prev.profiles,
          [id]: { ...existing, [field]: value },
        },
      };
    });
  }, []);

  const openProfile = useCallback((agentId: string) => {
    setProfileViewId(agentId);
    setSocialState((prev) => ({ ...prev, focusAgentId: agentId }));
  }, []);

  const submitPost = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = postDraft.trim();
    if (!content) return;
    setSocialState((prev) => {
      if (!prev.currentActorId) return prev;
      const nextPost: FeedPost = {
        id: makeId("post"),
        authorId: prev.currentActorId,
        content,
        createdAt: nowIso(),
        likes: [],
        source: null,
      };
      return {
        ...prev,
        posts: trimPosts([nextPost, ...prev.posts]),
      };
    });
    setPostDraft("");
  }, [postDraft]);

  const toggleLike = useCallback((postId: string) => {
    setSocialState((prev) => {
      const actor = prev.currentActorId;
      if (!actor) return prev;
      let changed = false;
      const postsUpdated = prev.posts.map((post) => {
        if (post.id !== postId) return post;
        changed = true;
        const liked = post.likes.includes(actor);
        return {
          ...post,
          likes: liked ? post.likes.filter((id) => id !== actor) : [...post.likes, actor],
        };
      });
      return changed ? { ...prev, posts: postsUpdated } : prev;
    });
  }, []);

  const sendFriendRequest = useCallback((targetId: string) => {
    setSocialState((prev) => {
      const actor = prev.currentActorId;
      if (!actor || actor === targetId) return prev;
      if (relationshipBetween(prev.friendships, actor, targetId)) return prev;
      const friendship: Friendship = {
        id: makeId("friendship"),
        requester: actor,
        addressee: targetId,
        status: "pending",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      const post: FeedPost = {
        id: makeId("post"),
        authorId: actor,
        content: `Sent a friend request to ${toHandle(targetId)}.`,
        createdAt: nowIso(),
        likes: [],
        source: null,
      };
      return {
        ...prev,
        friendships: [friendship, ...prev.friendships],
        posts: trimPosts([post, ...prev.posts]),
      };
    });
  }, []);

  const acceptFriendRequest = useCallback((friendshipId: string) => {
    setSocialState((prev) => {
      const actor = prev.currentActorId;
      if (!actor) return prev;
      const target = prev.friendships.find((friendship) => friendship.id === friendshipId);
      if (!target || target.status !== "pending" || target.addressee !== actor) return prev;
      const friendships: Friendship[] = prev.friendships.map((friendship) =>
        friendship.id === friendshipId
          ? { ...friendship, status: "friends" as const, updatedAt: nowIso() }
          : friendship,
      );
      const post: FeedPost = {
        id: makeId("post"),
        authorId: actor,
        content: `Accepted ${toHandle(target.requester)} as a friend.`,
        createdAt: nowIso(),
        likes: [],
        source: null,
      };
      return {
        ...prev,
        friendships,
        posts: trimPosts([post, ...prev.posts]),
      };
    });
  }, []);

  const ignoreFriendRequest = useCallback((friendshipId: string) => {
    setSocialState((prev) => {
      const actor = prev.currentActorId;
      if (!actor) return prev;
      const target = prev.friendships.find((friendship) => friendship.id === friendshipId);
      if (!target || target.status !== "pending" || target.addressee !== actor) return prev;
      return {
        ...prev,
        friendships: prev.friendships.filter((friendship) => friendship.id !== friendshipId),
      };
    });
  }, []);

  const voteOnClaim = useCallback((claimId: string, vote: "verify" | "dispute") => {
    setSocialState((prev) => {
      const actor = prev.currentActorId;
      if (!actor) return prev;

      const claimIndex = prev.claims.findIndex((claim) => claim.id === claimId);
      if (claimIndex === -1) return prev;
      const currentClaim = prev.claims[claimIndex];
      if (currentClaim.agentId === actor) return prev;
      if (currentClaim.verifiedBy.includes(actor) || currentClaim.disputedBy.includes(actor)) return prev;

      const nextClaim: SkillClaim = vote === "verify"
        ? { ...currentClaim, verifiedBy: [...currentClaim.verifiedBy, actor] }
        : { ...currentClaim, disputedBy: [...currentClaim.disputedBy, actor] };

      const claimsUpdated = [...prev.claims];
      claimsUpdated[claimIndex] = nextClaim;

      const actorName = displayName(agentMap, actor);
      const targetName = displayName(agentMap, nextClaim.agentId);
      const post: FeedPost = {
        id: makeId("post"),
        authorId: actor,
        content: `${actorName} ${vote === "verify" ? "endorsed" : "challenged"} ${targetName}'s "${nextClaim.skill}" claim.`,
        createdAt: nowIso(),
        likes: [],
        source: null,
      };
      return {
        ...prev,
        claims: claimsUpdated,
        posts: trimPosts([post, ...prev.posts]),
      };
    });
  }, [agentMap]);

  const runLearning = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const topic = learningTopic.trim();
    if (!topic) return;
    const learnerId = learningAgentId || socialState.currentActorId;
    if (!learnerId) return;

    setLearningBusy(true);
    setLearningError("");
    try {
      const source = await lookupWikipediaTopic(topic);
      const skill = learningSkill.trim() || topic;
      setSocialState((prev) => {
        const claim: SkillClaim = {
          id: makeId("claim"),
          agentId: learnerId,
          topic,
          skill,
          summary: source.summary,
          sourceTitle: source.title,
          sourceUrl: source.url,
          createdAt: nowIso(),
          verifiedBy: [],
          disputedBy: [],
        };
        const log: LearningLog = {
          id: makeId("log"),
          agentId: learnerId,
          topic,
          summary: source.summary,
          sourceTitle: source.title,
          sourceUrl: source.url,
          createdAt: nowIso(),
        };
        const post: FeedPost = {
          id: makeId("post"),
          authorId: learnerId,
          content: `Learned "${topic}" from ${source.title}. Submitted "${skill}" for verification.`,
          createdAt: nowIso(),
          likes: [],
          source: { title: source.title, url: source.url },
        };
        return {
          ...prev,
          claims: [claim, ...prev.claims],
          learningLogs: [log, ...prev.learningLogs].slice(0, 120),
          posts: trimPosts([post, ...prev.posts]),
        };
      });
      setLearningTopic("");
      setLearningSkill("");
    } catch (error) {
      setLearningError(error instanceof Error ? error.message : "Learning step failed.");
    } finally {
      setLearningBusy(false);
    }
  }, [learningAgentId, learningSkill, learningTopic, socialState.currentActorId]);

  const runAutonomous = useCallback((steps: number) => {
    setSocialState((prev) => {
      let next = prev;
      for (let i = 0; i < steps; i += 1) {
        next = autonomousStep(next, agents);
      }
      return next;
    });
  }, [agents]);

  const resetLocalState = useCallback(() => {
    setSocialState(hydrateState(emptySocialState(), agents));
    setPostDraft("");
    setLearningTopic("");
    setLearningSkill("");
    setLearningError("");
  }, [agents]);

  const updateGoogleLab = useCallback((patch: Partial<GeminiToolsState>) => {
    setSocialState((prev) => ({
      ...prev,
      googleLab: { ...prev.googleLab, ...patch },
    }));
  }, []);

  const saveAvatarStyle = useCallback(async () => {
    const content = socialState.googleLab.styleGuide.trim();
    if (!content) {
      setStyleError("Style guide cannot be empty.");
      return;
    }

    setStyleBusy(true);
    setStyleError("");
    try {
      const response = await fetch("/api/agent-social/avatar-style", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const payload = (await response.json()) as AvatarStyleResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save avatar style guide.");
      }

      setSocialState((prev) => ({
        ...prev,
        googleLab: {
          ...prev.googleLab,
          styleGuide: payload.content,
          styleSource: payload.source,
          styleNotePath: payload.notePath,
        },
      }));
    } catch (error) {
      setStyleError(error instanceof Error ? error.message : "Failed to save avatar style guide.");
    } finally {
      setStyleBusy(false);
    }
  }, [socialState.googleLab.styleGuide]);

  const generateAvatar = useCallback(async () => {
    const targetId = socialState.googleLab.targetAgentId || socialState.focusAgentId || socialState.currentActorId;
    if (!targetId) {
      setAvatarError("Select a target agent.");
      return;
    }
    const targetProfile = socialState.profiles[targetId];
    if (!targetProfile) {
      setAvatarError("Target profile not found.");
      return;
    }

    const agentName = displayName(agentMap, targetId);
    const prompt = socialState.googleLab.prompt.trim() || `${agentName} autonomous profile`;
    const mode = socialState.googleLab.executionMode;

    setAvatarBusy(true);
    setAvatarError("");
    try {
      const response = await fetch("/api/agent-social/avatar-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: targetId,
          agentName,
          prompt,
          soulDocument: targetProfile.soulDocument,
          mode,
        }),
      });
      const payload = (await response.json()) as Partial<AvatarGenerateResponse> & { error?: string };
      if (!response.ok || payload.ok !== true || !payload.fileUrl) {
        throw new Error(payload.error || "Avatar generation failed.");
      }
      const fileUrl = payload.fileUrl;

      setSocialState((prev) => {
        const currentProfile = prev.profiles[targetId];
        if (!currentProfile) return prev;
        const announcer = agentMap.has("avatar-studio")
          ? "avatar-studio"
          : agentMap.has("google-coder")
            ? "google-coder"
            : targetId;
        const modeLabel = payload.mode === "pro" ? "Nano Banana Pro" : "Nano Banana";
        const post: FeedPost = {
          id: makeId("post"),
          authorId: announcer,
          content: `Generated avatar for ${toHandle(targetId)} with ${modeLabel} using prompt "${firstLine(prompt, 64)}".`,
          createdAt: nowIso(),
          likes: [],
          source: { title: "open in media", url: "/media" },
        };
        return {
          ...prev,
          profiles: {
            ...prev.profiles,
            [targetId]: {
              ...currentProfile,
              avatarDataUrl: fileUrl,
              avatarSeed: prompt,
            },
          },
          googleLab: {
            ...prev.googleLab,
            targetAgentId: targetId,
            prompt,
            styleSource: payload.styleSource || prev.googleLab.styleSource,
            styleNotePath: payload.stylePath || prev.googleLab.styleNotePath,
            lastGeneratedAt: nowIso(),
          },
          posts: trimPosts([post, ...prev.posts]),
        };
      });
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Avatar generation failed.");
    } finally {
      setAvatarBusy(false);
    }
  }, [
    agentMap,
    socialState.currentActorId,
    socialState.focusAgentId,
    socialState.googleLab.executionMode,
    socialState.googleLab.prompt,
    socialState.googleLab.targetAgentId,
    socialState.profiles,
  ]);

  const generateAllAvatars = useCallback(async () => {
    const prompt = socialState.googleLab.prompt.trim() || undefined;
    const mode = socialState.googleLab.executionMode;

    setAvatarBusy(true);
    setAvatarError("");
    try {
      const response = await fetch("/api/agent-social/avatar-generate-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, mode }),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error || "Bulk avatar generation failed.");
      }

      setSocialState((prev) => {
        const announcer = agentMap.has("avatar-studio") ? "avatar-studio" : "joi";
        const post: FeedPost = {
          id: makeId("post"),
          authorId: announcer,
          content: `Generated new avatars for ${payload.succeeded}/${payload.total} agents.${payload.failed > 0 ? ` ${payload.failed} failed.` : ""} ${prompt ? `Theme: "${firstLine(prompt, 64)}"` : ""}`.trim(),
          createdAt: nowIso(),
          likes: [],
          source: { title: "open in media", url: "/media" },
        };

        // Update avatarDataUrl for succeeded agents
        const updatedProfiles = { ...prev.profiles };
        for (const r of payload.results || []) {
          if (r.fileUrl && updatedProfiles[r.agentId]) {
            updatedProfiles[r.agentId] = {
              ...updatedProfiles[r.agentId],
              avatarDataUrl: r.fileUrl,
            };
          }
        }

        return {
          ...prev,
          profiles: updatedProfiles,
          googleLab: {
            ...prev.googleLab,
            lastGeneratedAt: nowIso(),
          },
          posts: trimPosts([post, ...prev.posts]),
        };
      });
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Bulk avatar generation failed.");
    } finally {
      setAvatarBusy(false);
    }
  }, [agentMap, socialState.googleLab.executionMode, socialState.googleLab.prompt]);

  const publishGoogleUpdate = useCallback(() => {
    setSocialState((prev) => {
      const announcer = agentMap.has("google-coder") ? "google-coder" : prev.currentActorId;
      if (!announcer) return prev;
      const accountSummary = googleAccounts.length > 0
        ? `${googleAccounts.length} Google account(s) linked`
        : "no Google/Gemini account linked yet";
      const modeLabel = prev.googleLab.executionMode === "pro" ? "Nano Banana Pro" : "Nano Banana";
      const styleSummary = prev.googleLab.styleNotePath
        ? `${prev.googleLab.styleSource} style at ${prev.googleLab.styleNotePath}`
        : `${prev.googleLab.styleSource} style`;
      const content = `${prev.googleLab.connected ? "Gemini avatar tools active" : "Gemini avatar tools paused"}: ${accountSummary}. Mode ${modeLabel}. ${styleSummary}.`;
      const post: FeedPost = {
        id: makeId("post"),
        authorId: announcer,
        content,
        createdAt: nowIso(),
        likes: [],
        source: null,
      };
      return {
        ...prev,
        posts: trimPosts([post, ...prev.posts]),
      };
    });
  }, [agentMap, googleAccounts]);

  const renderPostCard = (post: FeedPost) => {
    const agent = agentMap.get(post.authorId);
    const profile = socialState.profiles[post.authorId];
    const label = agent?.name || post.authorId;
    const isLiked = post.likes.includes(currentActorId);
    return (
      <article key={post.id} className="social-post">
        <div className="social-post-avatar">
          <AvatarCircle
            profile={profile}
            seed={post.authorId}
            name={label}
            onClick={() => openProfile(post.authorId)}
          />
        </div>
        <div className="social-post-body">
          <div className="social-post-header">
            <span className="social-post-name" onClick={() => openProfile(post.authorId)}>{label}</span>
            <span className="social-post-handle">{profile?.handle || toHandle(post.authorId)}</span>
            <span className="social-post-time">{relativeTime(post.createdAt)}</span>
          </div>
          <div className="social-post-content">{post.content}</div>
          {post.source && (
            <a className="social-post-source" href={post.source.url} target="_blank" rel="noreferrer">
              source: {post.source.title}
            </a>
          )}
          <div className="social-post-actions">
            <button className={`post-like-btn${isLiked ? " liked" : ""}`} onClick={() => toggleLike(post.id)}>
              <HeartIcon filled={isLiked} />
              {post.likes.length > 0 && <span>{post.likes.length}</span>}
            </button>
          </div>
        </div>
      </article>
    );
  };

  const currentActorProfile = socialState.profiles[currentActorId];

  return (
    <>
      <PageHeader
        title="Agent Social"
        actions={
          <div className="agent-social-header-actions">
            <Button size="sm" onClick={() => runAutonomous(1)}>Auto step</Button>
            <Button size="sm" onClick={() => runAutonomous(5)}>Auto x5</Button>
            <Button size="sm" onClick={resetLocalState}>Reset</Button>
          </div>
        }
      />

      <PageBody className="agent-social-page">
        <div className="agent-social-layout">
          {/* Main Column */}
          <section className="agent-social-main-column">
            {profileViewId && profileAgent && profileData ? (
              /* Profile View */
              <div className="social-profile">
                <button className="social-profile-back" onClick={() => setProfileViewId(null)}>
                  <ArrowLeft />
                  <span>{profileAgent.name}</span>
                </button>
                <div
                  className="social-profile-banner"
                  style={{ background: avatarGradient(profileData.avatarSeed || profileViewId) }}
                />
                <div className="social-profile-info">
                  <div className="social-profile-avatar-wrap">
                    <AvatarCircle profile={profileData} seed={profileViewId} name={profileAgent.name} size="lg" />
                  </div>
                  <h2 className="social-profile-name">{profileAgent.name}</h2>
                  <div className="social-profile-handle">{profileData.handle}</div>
                  <p className="social-profile-bio">{profileData.personality}</p>
                  <p className="social-profile-mission">{profileData.mission}</p>
                  <div className="social-profile-stats">
                    <span><strong>{profilePostCount}</strong> posts</span>
                    <span><strong>{profileFriendCount}</strong> friends</span>
                    <span><strong>{profileSignalCount}</strong> signals</span>
                  </div>
                  {(profileSkillSignals.lane || profileSkillSignals.capabilities.length > 0 || profileSkillSignals.tools.length > 0 || profileSkillSignals.expertise.length > 0) && (
                    <div className="social-profile-skill-groups">
                      {profileSkillSignals.lane && (
                        <div className="social-skill-group">
                          <div className="social-skill-group-label">Executor Lane</div>
                          <div className="social-profile-skills">
                            <span className="social-skill-chip social-skill-chip--verified">{profileSkillSignals.lane}</span>
                          </div>
                        </div>
                      )}
                      {profileSkillSignals.capabilities.length > 0 && (
                        <div className="social-skill-group">
                          <div className="social-skill-group-label">Capabilities</div>
                          <div className="social-profile-skills">
                            {profileSkillSignals.capabilities.map((capability) => (
                              <span key={`cap-${capability}`} className="social-skill-chip">{capability}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {profileSkillSignals.tools.length > 0 && (
                        <div className="social-skill-group">
                          <div className="social-skill-group-label">Tools</div>
                          <div className="social-profile-skills">
                            {profileSkillSignals.tools.slice(0, 10).map((tool) => (
                              <span key={`tool-${tool}`} className="social-skill-chip">{tool}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {profileSkillSignals.expertise.length > 0 && (
                        <div className="social-skill-group">
                          <div className="social-skill-group-label">Verified Expertise</div>
                          <div className="social-profile-skills">
                            {profileSkillSignals.expertise.map((skill) => (
                              <span key={`exp-${skill}`} className="social-skill-chip social-skill-chip--verified">{skill}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="social-profile-actions">
                    <Button size="sm" onClick={() => { setSocialState((prev) => ({ ...prev, focusAgentId: profileViewId })); setEditProfileOpen(true); }}>
                      Edit Profile
                    </Button>
                    {profileRelation.type === "none" && (
                      <Button size="sm" onClick={() => sendFriendRequest(profileViewId)}>Follow</Button>
                    )}
                    {profileRelation.type === "friends" && <Badge status="success">Friends</Badge>}
                    {profileRelation.type === "outbound" && <Badge status="warning">Request sent</Badge>}
                    {profileRelation.type === "inbound" && profileRelation.friendship && (
                      <>
                        <Button size="sm" onClick={() => acceptFriendRequest(profileRelation.friendship!.id)}>Accept</Button>
                        <Button size="sm" onClick={() => ignoreFriendRequest(profileRelation.friendship!.id)}>Ignore</Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="social-profile-section-label">Posts</div>
                <div className="social-feed">
                  {profilePosts.length === 0 && (
                    <div style={{ padding: "24px 16px", textAlign: "center" }}>
                      <MetaText size="xs">No posts yet.</MetaText>
                    </div>
                  )}
                  {profilePosts.map(renderPostCard)}
                </div>
              </div>
            ) : (
              /* Feed View */
              <>
                <form className="social-compose" onSubmit={submitPost}>
                  <div className="social-compose-avatar">
                    <AvatarCircle
                      profile={currentActorProfile}
                      seed={currentActorId}
                      name={displayName(agentMap, currentActorId)}
                    />
                  </div>
                  <div className="social-compose-body">
                    <textarea
                      value={postDraft}
                      onChange={(e) => setPostDraft(e.target.value)}
                      placeholder="What's happening?"
                    />
                    <div className="social-compose-footer">
                      <div className="social-compose-actor">
                        <span>Post as</span>
                        <select value={currentActorId} onChange={(e) => changeActor(e.target.value)}>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      </div>
                      <button type="submit" className="social-post-btn" disabled={!postDraft.trim()}>Post</button>
                    </div>
                  </div>
                </form>
                <div className="social-feed">
                  {posts.map(renderPostCard)}
                </div>
              </>
            )}
          </section>

          {/* Right Sidebar */}
          <aside className="agent-social-sidebar">
            <div className="social-sidebar-section">
              <h3 className="social-sidebar-title">Who to follow</h3>
              <div className="social-who-to-follow">
                {agents.map((agent) => {
                  const profile = socialState.profiles[agent.id];
                  const relation = relationshipType(socialState.friendships, currentActorId, agent.id);
                  const signals = deriveSkillSignals(agent.skills, verifiedSkillsByAgent.get(agent.id) || [], agent.executor);
                  const preview = [
                    ...(signals.lane ? [signals.lane] : []),
                    ...signals.capabilities.slice(0, 2),
                    ...signals.expertise.slice(0, 1).map((skill) => `★ ${skill}`),
                  ];
                  const totalSignals = (signals.lane ? 1 : 0) + signals.capabilities.length + signals.expertise.length;
                  return (
                    <div key={agent.id} className="social-follow-row" onClick={() => openProfile(agent.id)}>
                      <AvatarCircle profile={profile} seed={agent.id} name={agent.name} size="sm" />
                      <div className="social-follow-info">
                        <div className="social-follow-name">{agent.name}</div>
                        <div className="social-follow-handle">{profile?.handle || toHandle(agent.id)}</div>
                        {preview.length > 0 && (
                          <div className="social-follow-skills">
                            {preview.map((skill) => (
                              <span key={skill} className="social-skill-tag">{skill}</span>
                            ))}
                            {totalSignals > preview.length && <span className="social-skill-tag social-skill-tag--more">+{totalSignals - preview.length}</span>}
                          </div>
                        )}
                      </div>
                      {relation.type === "self" ? (
                        <Badge status="accent">you</Badge>
                      ) : relation.type === "friends" ? (
                        <span className="social-friends-badge">Friends</span>
                      ) : relation.type === "none" ? (
                        <button
                          className="social-follow-btn"
                          onClick={(e) => { e.stopPropagation(); sendFriendRequest(agent.id); }}
                        >
                          Follow
                        </button>
                      ) : relation.type === "outbound" ? (
                        <Badge status="warning">Sent</Badge>
                      ) : relation.type === "inbound" && relation.friendship ? (
                        <button
                          className="social-follow-btn"
                          onClick={(e) => { e.stopPropagation(); acceptFriendRequest(relation.friendship!.id); }}
                        >
                          Accept
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Gemini Tools */}
            <div className="social-sidebar-collapsible">
              <Collapsible
                open={geminiToolsOpen}
                onOpenChange={setGeminiToolsOpen}
                trigger={
                  <button className="social-sidebar-collapsible-trigger">
                    <span>Gemini Tools</span>
                    <ChevronDown />
                  </button>
                }
              >
                <div className="social-sidebar-collapsible-content">
                  <Switch
                    checked={socialState.googleLab.connected}
                    onCheckedChange={(checked) => updateGoogleLab({ connected: checked })}
                    label={socialState.googleLab.connected ? "Active" : "Paused"}
                  />
                  <label className="social-collapsible-field">
                    <span>Mode</span>
                    <select
                      value={socialState.googleLab.executionMode}
                      onChange={(e) => updateGoogleLab({ executionMode: e.target.value as GeminiExecutionMode })}
                    >
                      <option value="nano">Nano Banana (fast)</option>
                      <option value="pro">Nano Banana Pro (quality)</option>
                    </select>
                  </label>
                  <label className="social-collapsible-field">
                    <span>Target agent</span>
                    <select
                      value={socialState.googleLab.targetAgentId}
                      onChange={(e) => updateGoogleLab({ targetAgentId: e.target.value })}
                    >
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="social-collapsible-field">
                    <span>Avatar prompt</span>
                    <textarea
                      value={socialState.googleLab.prompt}
                      onChange={(e) => updateGoogleLab({ prompt: e.target.value })}
                      rows={2}
                    />
                  </label>
                  <label className="social-collapsible-field">
                    <span>Style guide</span>
                    <textarea
                      value={socialState.googleLab.styleGuide}
                      onChange={(e) => updateGoogleLab({ styleGuide: e.target.value })}
                      rows={4}
                    />
                  </label>
                  <div className="social-collapsible-actions">
                    <Button size="sm" onClick={saveAvatarStyle} disabled={styleBusy || !socialState.googleLab.styleGuide.trim()}>
                      {styleBusy ? "Saving..." : "Save style"}
                    </Button>
                    <Button size="sm" onClick={generateAvatar} disabled={avatarBusy || !socialState.googleLab.connected}>
                      {avatarBusy ? "Generating..." : "Generate avatar"}
                    </Button>
                    <Button size="sm" onClick={generateAllAvatars} disabled={avatarBusy || !socialState.googleLab.connected}>
                      {avatarBusy ? "Generating..." : "All avatars"}
                    </Button>
                    <Button size="sm" onClick={publishGoogleUpdate}>Publish status</Button>
                  </div>
                  {styleError && <p className="social-inline-error">{styleError}</p>}
                  {avatarError && <p className="social-inline-error">{avatarError}</p>}
                  <MetaText size="xs">
                    {socialState.googleLab.styleSource} style · Last: {socialState.googleLab.lastGeneratedAt ? relativeTime(socialState.googleLab.lastGeneratedAt) : "never"}
                  </MetaText>
                  <div className="social-google-chips">
                    {googleAccounts.length > 0 ? googleAccounts.map((acc) => (
                      <Badge key={acc.id} status={acc.status === "connected" ? "success" : "warning"}>
                        {acc.display_name || acc.email || acc.id}
                      </Badge>
                    )) : (
                      <MetaText size="xs">No Google account linked.</MetaText>
                    )}
                  </div>
                </div>
              </Collapsible>
            </div>

            {/* Learning & Claims */}
            <div className="social-sidebar-collapsible">
              <Collapsible
                open={learningOpen}
                onOpenChange={setLearningOpen}
                trigger={
                  <button className="social-sidebar-collapsible-trigger">
                    <span>Learning</span>
                    <ChevronDown />
                  </button>
                }
              >
                <div className="social-sidebar-collapsible-content">
                  <form className="social-learning-form" onSubmit={runLearning}>
                    <label className="social-collapsible-field">
                      <span>Learner</span>
                      <select value={learningAgentId} onChange={(e) => setLearningAgentId(e.target.value)}>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="social-collapsible-field">
                      <span>Topic</span>
                      <input
                        value={learningTopic}
                        onChange={(e) => setLearningTopic(e.target.value)}
                        placeholder="e.g. retrieval augmented generation"
                      />
                    </label>
                    <label className="social-collapsible-field">
                      <span>Skill (optional)</span>
                      <input
                        value={learningSkill}
                        onChange={(e) => setLearningSkill(e.target.value)}
                        placeholder="e.g. rag-architecture"
                      />
                    </label>
                    <Button variant="primary" type="submit" disabled={learningBusy || !learningTopic.trim()}>
                      {learningBusy ? "Learning..." : "Learn + Claim"}
                    </Button>
                  </form>
                  {learningError && <p className="social-inline-error">{learningError}</p>}

                  <div className="social-claims-list">
                    {claims.length === 0 && <MetaText size="xs">No claims yet.</MetaText>}
                    {claims.slice(0, 10).map((claim) => {
                      const status = claimStatus(claim);
                      const canVote = Boolean(
                        currentActorId &&
                        currentActorId !== claim.agentId &&
                        !claim.verifiedBy.includes(currentActorId) &&
                        !claim.disputedBy.includes(currentActorId),
                      );
                      return (
                        <div key={claim.id} className="social-claim-item">
                          <div className="social-claim-header">
                            <div>
                              <strong>{displayName(agentMap, claim.agentId)}</strong>{" "}
                              <MetaText size="xs">"{claim.skill}" · {relativeTime(claim.createdAt)}</MetaText>
                            </div>
                            <Badge status={status === "verified" ? "success" : status === "disputed" ? "error" : "warning"}>
                              {status}
                            </Badge>
                          </div>
                          <p className="social-claim-summary">{firstLine(claim.summary, 120)}</p>
                          <div className="social-claim-footer">
                            <span>{claim.verifiedBy.length}v / {claim.disputedBy.length}d</span>
                            <div className="social-claim-vote-btns">
                              <Button size="sm" onClick={() => voteOnClaim(claim.id, "verify")} disabled={!canVote}>V</Button>
                              <Button size="sm" onClick={() => voteOnClaim(claim.id, "dispute")} disabled={!canVote}>D</Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Collapsible>
            </div>
          </aside>
        </div>
      </PageBody>

      {/* Edit Profile Modal */}
      <Modal open={editProfileOpen} onClose={() => setEditProfileOpen(false)} title={focusAgent ? `Edit ${focusAgent.name}` : "Edit Profile"} width={480}>
        {focusAgent && focusProfile && (
          <div className="social-edit-form">
            <div className="social-edit-field">
              <label>Handle</label>
              <input value={focusProfile.handle} onChange={(e) => updateProfileField("handle", e.target.value)} />
            </div>
            <div className="social-edit-field">
              <label>Personality</label>
              <input value={focusProfile.personality} onChange={(e) => updateProfileField("personality", e.target.value)} />
            </div>
            <div className="social-edit-field">
              <label>Mission</label>
              <input value={focusProfile.mission} onChange={(e) => updateProfileField("mission", e.target.value)} />
            </div>
            <div className="social-edit-field">
              <label>Values</label>
              <input value={focusProfile.values} onChange={(e) => updateProfileField("values", e.target.value)} />
            </div>
            <div className="social-edit-field">
              <label>Growth Goal</label>
              <textarea value={focusProfile.growthGoal} onChange={(e) => updateProfileField("growthGoal", e.target.value)} rows={2} />
            </div>
            <div className="social-edit-field">
              <label>Soul Document</label>
              <div className="social-inline-hint">
                Soul is managed in unified admin only. Agent Social shows a preview.
              </div>
              <textarea value={focusProfile.soulDocument} rows={5} readOnly />
            </div>
            <div className="social-edit-actions">
              <Button
                size="sm"
                onClick={() => {
                  if (!focusAgent?.id) return;
                  window.location.href = `/agents?agent=${encodeURIComponent(focusAgent.id)}&tab=soul`;
                }}
              >
                Open unified admin
              </Button>
              <Button size="sm" onClick={() => setEditProfileOpen(false)}>Done</Button>
            </div>
            {soulValidation && (
              <p className={`social-inline-${soulValidation.valid ? "hint" : "error"}`}>
                Soul validation: {soulValidation.valid ? "valid" : "issues"}
                {" · "}
                {Math.round((soulValidation.score || 0) * 100)}% score
                {" · "}
                {soulValidation.wordCount} words
                {soulValidation.missingSections.length > 0 ? ` · missing: ${soulValidation.missingSections.join(", ")}` : ""}
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
