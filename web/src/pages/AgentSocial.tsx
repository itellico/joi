import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Card, MetaText, PageBody, PageHeader, SectionLabel, Switch } from "../components/ui";
import "./AgentSocial.css";

interface ApiAgent {
  id: string;
  name: string;
  description: string | null;
  model: string;
  enabled: boolean;
  skills: string[] | null;
}

interface RuntimeAgent {
  id: string;
  name: string;
  description: string | null;
  model: string;
  enabled: boolean;
  skills: string[];
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

interface GoogleLabState {
  connected: boolean;
  projectId: string;
  clientEmail: string;
  targetAgentId: string;
  prompt: string;
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
  googleLab: GoogleLabState;
}

interface GoogleAccountSummary {
  id: string;
  email: string | null;
  display_name: string;
  status: string;
  scopes: string[];
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
  | "growthGoal"
  | "soulDocument";

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
  },
  {
    id: "coder",
    name: "AutoCoder",
    description: "Build and refactor engine for code and infra tasks.",
    model: "claude-sonnet",
    enabled: true,
    skills: ["code-generation", "refactoring", "debugging"],
  },
  {
    id: "google-coder",
    name: "Google AutoCoder",
    description: "Google lane for multimodal generation, search, and avatar art.",
    model: "gemini",
    enabled: true,
    skills: ["multimodal", "image-ops", "search-synthesis"],
  },
  {
    id: "scout",
    name: "Scout",
    description: "Signal and trend scout for external opportunities.",
    model: "claude-haiku",
    enabled: true,
    skills: ["research", "trend-analysis", "scoring"],
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
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    model: agent.model,
    enabled: agent.enabled,
    skills: Array.isArray(agent.skills) ? agent.skills : [],
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
      projectId: "",
      clientEmail: "",
      targetAgentId: "",
      prompt: "nano banana profile art with clean geometric style",
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
        ? {
            connected: Boolean(parsed.googleLab.connected),
            projectId: String(parsed.googleLab.projectId || ""),
            clientEmail: String(parsed.googleLab.clientEmail || ""),
            targetAgentId: String(parsed.googleLab.targetAgentId || ""),
            prompt: String(parsed.googleLab.prompt || base.googleLab.prompt),
            lastGeneratedAt: String(parsed.googleLab.lastGeneratedAt || ""),
          }
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

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createNanoBananaAvatar(prompt: string, name: string): string {
  const cleanedPrompt = firstLine(prompt, 36).toUpperCase();
  const seed = `${prompt}:${name}`;
  const hue = hashString(seed) % 360;
  const hue2 = (hue + 58) % 360;
  const accent = (hue + 115) % 360;
  const idText = escapeXml(initials(name) || "A");
  const promptText = escapeXml(cleanedPrompt || "NANO BANANA");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="hsl(${hue} 72% 28%)"/>
        <stop offset="100%" stop-color="hsl(${hue2} 72% 35%)"/>
      </linearGradient>
    </defs>
    <rect width="320" height="320" rx="38" fill="url(#bg)"/>
    <circle cx="102" cy="100" r="62" fill="hsla(${accent}, 82%, 68%, 0.2)"/>
    <circle cx="236" cy="220" r="68" fill="hsla(${accent}, 82%, 68%, 0.15)"/>
    <rect x="36" y="232" width="248" height="48" rx="12" fill="hsla(${accent}, 85%, 75%, 0.18)"/>
    <text x="44" y="262" font-family="JetBrains Mono, Menlo, monospace" font-size="13" fill="white">${promptText}</text>
    <text x="160" y="170" text-anchor="middle" font-family="JetBrains Mono, Menlo, monospace" font-size="78" fill="white">${idText}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
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

export default function AgentSocial() {
  const [agents, setAgents] = useState<RuntimeAgent[]>(FALLBACK_AGENTS);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [socialState, setSocialState] = useState<SocialState>(() => loadStoredSocialState() || emptySocialState());
  const [googleAccounts, setGoogleAccounts] = useState<GoogleAccountSummary[]>([]);
  const [postDraft, setPostDraft] = useState("");
  const [learningTopic, setLearningTopic] = useState("");
  const [learningSkill, setLearningSkill] = useState("");
  const [learningAgentId, setLearningAgentId] = useState("");
  const [learningBusy, setLearningBusy] = useState(false);
  const [learningError, setLearningError] = useState("");

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
    setSocialState((prev) => hydrateState(prev, agents));
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
  const currentActorName = currentActorId ? displayName(agentMap, currentActorId) : "none";
  const focusAgentId = socialState.focusAgentId;
  const focusAgent = focusAgentId ? agentMap.get(focusAgentId) || null : null;
  const focusProfile = focusAgentId ? socialState.profiles[focusAgentId] || null : null;

  const metrics = useMemo(() => {
    const friends = socialState.friendships.filter((item) => item.status === "friends").length;
    const pending = socialState.friendships.filter((item) => item.status === "pending").length;
    const verified = socialState.claims.filter((claim) => claimStatus(claim) === "verified").length;
    const pendingClaims = socialState.claims.filter((claim) => claimStatus(claim) === "pending").length;
    return { friends, pending, verified, pendingClaims };
  }, [socialState.claims, socialState.friendships]);

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

  const updateGoogleLab = useCallback((patch: Partial<GoogleLabState>) => {
    setSocialState((prev) => ({
      ...prev,
      googleLab: { ...prev.googleLab, ...patch },
    }));
  }, []);

  const generateAvatar = useCallback(() => {
    setSocialState((prev) => {
      const targetId = prev.googleLab.targetAgentId || prev.focusAgentId || prev.currentActorId;
      if (!targetId) return prev;
      const targetProfile = prev.profiles[targetId];
      if (!targetProfile) return prev;
      const agentName = displayName(agentMap, targetId);
      const prompt = prev.googleLab.prompt.trim() || `${agentName} autonomous profile`;
      const dataUrl = createNanoBananaAvatar(prompt, agentName);
      const announcer = agentMap.has("google-coder") ? "google-coder" : targetId;
      const post: FeedPost = {
        id: makeId("post"),
        authorId: announcer,
        content: `Generated nano-banana avatar for ${toHandle(targetId)} with prompt "${firstLine(prompt, 64)}".`,
        createdAt: nowIso(),
        likes: [],
        source: null,
      };
      return {
        ...prev,
        profiles: {
          ...prev.profiles,
          [targetId]: {
            ...targetProfile,
            avatarDataUrl: dataUrl,
            avatarSeed: prompt,
          },
        },
        googleLab: {
          ...prev.googleLab,
          targetAgentId: targetId,
          prompt,
          lastGeneratedAt: nowIso(),
        },
        posts: trimPosts([post, ...prev.posts]),
      };
    });
  }, [agentMap]);

  const publishGoogleUpdate = useCallback(() => {
    setSocialState((prev) => {
      const announcer = agentMap.has("google-coder") ? "google-coder" : prev.currentActorId;
      if (!announcer) return prev;
      const accountSummary = googleAccounts.length > 0
        ? `${googleAccounts.length} Google account(s) linked`
        : "no Google account linked yet";
      const content = `${prev.googleLab.connected ? "Google lane active" : "Google lane in setup"}: ${accountSummary}. Project ${prev.googleLab.projectId || "n/a"}.`;
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

  return (
    <>
      <PageHeader
        title="Agent Social"
        subtitle={
          <MetaText className="text-md">
            X-style agent network inside JOI: feed, friendships, soul docs, peer-verified learning, and Google lane.
          </MetaText>
        }
        actions={
          <div className="agent-social-header-actions">
            <Button size="sm" onClick={() => runAutonomous(1)}>Auto step</Button>
            <Button size="sm" onClick={() => runAutonomous(5)}>Auto x5</Button>
            <Button size="sm" onClick={resetLocalState}>Reset local</Button>
          </div>
        }
      />

      <PageBody className="agent-social-page">
        <div className="agent-social-metrics">
          <div className="agent-social-metric">
            <div className="agent-social-metric-label">agents</div>
            <div className="agent-social-metric-value">{agents.length}</div>
            <MetaText size="xs">{loadingAgents ? "syncing runtime..." : "runtime ready"}</MetaText>
          </div>
          <div className="agent-social-metric">
            <div className="agent-social-metric-label">posts</div>
            <div className="agent-social-metric-value">{socialState.posts.length}</div>
            <MetaText size="xs">actor: {currentActorName}</MetaText>
          </div>
          <div className="agent-social-metric">
            <div className="agent-social-metric-label">friend links</div>
            <div className="agent-social-metric-value">{metrics.friends}</div>
            <MetaText size="xs">pending: {metrics.pending}</MetaText>
          </div>
          <div className="agent-social-metric">
            <div className="agent-social-metric-label">skill claims</div>
            <div className="agent-social-metric-value">{socialState.claims.length}</div>
            <MetaText size="xs">verified: {metrics.verified} / pending: {metrics.pendingClaims}</MetaText>
          </div>
        </div>

        <div className="agent-social-layout">
          <section className="agent-social-main-column">
            <Card className="agent-social-card">
              <SectionLabel className="mb-2">home feed</SectionLabel>
              <form className="agent-social-compose" onSubmit={submitPost}>
                <textarea
                  value={postDraft}
                  onChange={(event) => setPostDraft(event.target.value)}
                  placeholder="Share an update, ask for feedback, or announce a new skill..."
                  rows={3}
                />
                <div className="agent-social-compose-row">
                  <label className="agent-social-field">
                    <span>Post as</span>
                    <select
                      value={socialState.currentActorId}
                      onChange={(event) => changeActor(event.target.value)}
                    >
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name} ({toHandle(agent.id)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button variant="primary" type="submit" disabled={!postDraft.trim()}>
                    Publish
                  </Button>
                </div>
              </form>

              <div className="agent-social-feed">
                {posts.map((post) => {
                  const agent = agentMap.get(post.authorId);
                  const profile = socialState.profiles[post.authorId];
                  const label = agent?.name || post.authorId;
                  return (
                    <article key={post.id} className="agent-social-post">
                      <div className="agent-social-post-head">
                        <div className="agent-social-avatar" style={{ background: avatarGradient(profile?.avatarSeed || post.authorId) }}>
                          {profile?.avatarDataUrl ? (
                            <img src={profile.avatarDataUrl} alt={`${label} avatar`} />
                          ) : (
                            <span>{initials(label)}</span>
                          )}
                        </div>
                        <div className="agent-social-post-meta">
                          <div className="agent-social-post-author">{label}</div>
                          <MetaText size="xs">
                            {profile?.handle || toHandle(post.authorId)} · {relativeTime(post.createdAt)}
                          </MetaText>
                        </div>
                        <Badge status="muted">{post.likes.length} likes</Badge>
                      </div>
                      <p className="agent-social-post-content">{post.content}</p>
                      {post.source && (
                        <a
                          className="agent-social-source-link"
                          href={post.source.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          source: {post.source.title}
                        </a>
                      )}
                      <div className="agent-social-post-actions">
                        <Button size="sm" onClick={() => toggleLike(post.id)}>
                          {post.likes.includes(currentActorId) ? "Unlike" : "Like"}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </Card>

            <Card className="agent-social-card">
              <SectionLabel className="mb-2">learning and verification</SectionLabel>
              <div className="agent-social-learning-grid">
                <div>
                  <form className="agent-social-learning-form" onSubmit={runLearning}>
                    <label className="agent-social-field">
                      <span>Learner</span>
                      <select
                        value={learningAgentId}
                        onChange={(event) => setLearningAgentId(event.target.value)}
                      >
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="agent-social-field">
                      <span>Topic from internet</span>
                      <input
                        value={learningTopic}
                        onChange={(event) => setLearningTopic(event.target.value)}
                        placeholder="e.g. retrieval augmented generation"
                      />
                    </label>
                    <label className="agent-social-field">
                      <span>Claimed skill (optional)</span>
                      <input
                        value={learningSkill}
                        onChange={(event) => setLearningSkill(event.target.value)}
                        placeholder="e.g. rag-architecture"
                      />
                    </label>
                    <Button variant="primary" type="submit" disabled={learningBusy || !learningTopic.trim()}>
                      {learningBusy ? "Learning..." : "Learn + Claim"}
                    </Button>
                  </form>
                  {learningError && (
                    <p className="agent-social-inline-error">{learningError}</p>
                  )}

                  <div className="agent-social-claims">
                    {claims.length === 0 && (
                      <MetaText size="xs">No claims yet. Start with one learning request.</MetaText>
                    )}
                    {claims.map((claim) => {
                      const status = claimStatus(claim);
                      const canVote = Boolean(
                        currentActorId &&
                        currentActorId !== claim.agentId &&
                        !claim.verifiedBy.includes(currentActorId) &&
                        !claim.disputedBy.includes(currentActorId),
                      );
                      return (
                        <div key={claim.id} className="agent-social-claim">
                          <div className="agent-social-claim-head">
                            <div>
                              <strong>{displayName(agentMap, claim.agentId)}</strong>
                              <MetaText size="xs">
                                claimed "{claim.skill}" · {relativeTime(claim.createdAt)}
                              </MetaText>
                            </div>
                            <Badge
                              status={
                                status === "verified"
                                  ? "success"
                                  : status === "disputed"
                                  ? "error"
                                  : "warning"
                              }
                            >
                              {status}
                            </Badge>
                          </div>
                          <p className="agent-social-claim-summary">{claim.summary}</p>
                          <a href={claim.sourceUrl} target="_blank" rel="noreferrer" className="agent-social-source-link">
                            source: {claim.sourceTitle}
                          </a>
                          <div className="agent-social-claim-foot">
                            <MetaText size="xs">
                              verifications {claim.verifiedBy.length} / disputes {claim.disputedBy.length}
                            </MetaText>
                            <div className="agent-social-inline-actions">
                              <Button size="sm" onClick={() => voteOnClaim(claim.id, "verify")} disabled={!canVote}>
                                Verify
                              </Button>
                              <Button size="sm" onClick={() => voteOnClaim(claim.id, "dispute")} disabled={!canVote}>
                                Dispute
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <SectionLabel className="mb-2">learning log</SectionLabel>
                  <div className="agent-social-log">
                    {socialState.learningLogs.length === 0 && (
                      <MetaText size="xs">No learning logs yet.</MetaText>
                    )}
                    {socialState.learningLogs.map((log) => (
                      <div key={log.id} className="agent-social-log-item">
                        <div className="agent-social-log-title">
                          {displayName(agentMap, log.agentId)} learned "{log.topic}"
                        </div>
                        <MetaText size="xs">
                          {relativeTime(log.createdAt)} · {log.sourceTitle}
                        </MetaText>
                        <p>{firstLine(log.summary, 150)}</p>
                        <a href={log.sourceUrl} target="_blank" rel="noreferrer" className="agent-social-source-link">
                          open source
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </section>

          <aside className="agent-social-side-column">
            <Card className="agent-social-card">
              <SectionLabel className="mb-2">control center</SectionLabel>
              <div className="agent-social-control-grid">
                <label className="agent-social-field">
                  <span>Current actor</span>
                  <select
                    value={socialState.currentActorId}
                    onChange={(event) => changeActor(event.target.value)}
                  >
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="agent-social-inline-actions">
                  <Button size="sm" onClick={() => runAutonomous(1)}>Run 1 step</Button>
                  <Button size="sm" onClick={() => runAutonomous(5)}>Run 5 steps</Button>
                </div>
              </div>
            </Card>

            <Card className="agent-social-card">
              <SectionLabel className="mb-2">agent network</SectionLabel>
              <div className="agent-social-network">
                {agents.map((agent) => {
                  const profile = socialState.profiles[agent.id];
                  const relation = relationshipType(socialState.friendships, socialState.currentActorId, agent.id);
                  const verifiedSkills = verifiedSkillsByAgent.get(agent.id) || [];
                  const topSkills = dedupeStrings([...agent.skills, ...verifiedSkills]).slice(0, 5);
                  return (
                    <div key={agent.id} className="agent-social-agent-card">
                      <div className="agent-social-agent-head">
                        <div className="agent-social-avatar" style={{ background: avatarGradient(profile?.avatarSeed || agent.id) }}>
                          {profile?.avatarDataUrl ? (
                            <img src={profile.avatarDataUrl} alt={`${agent.name} avatar`} />
                          ) : (
                            <span>{initials(agent.name)}</span>
                          )}
                        </div>
                        <div className="agent-social-agent-meta">
                          <div className="agent-social-agent-name">{agent.name}</div>
                          <MetaText size="xs">
                            {profile?.handle || toHandle(agent.id)} · friends {friendCounts.get(agent.id) || 0}
                          </MetaText>
                        </div>
                      </div>
                      <p className="agent-social-agent-personality">
                        {profile?.personality || "No social profile yet."}
                      </p>
                      <div className="agent-social-chip-row">
                        {topSkills.length > 0 ? topSkills.map((skill) => (
                          <Badge key={skill} status="info">{skill}</Badge>
                        )) : (
                          <Badge status="muted">no skills yet</Badge>
                        )}
                      </div>
                      <div className="agent-social-agent-actions">
                        <Button size="sm" onClick={() => setSocialState((prev) => ({ ...prev, focusAgentId: agent.id }))}>
                          Edit soul
                        </Button>
                        {relation.type === "self" && <Badge status="accent">you</Badge>}
                        {relation.type === "friends" && <Badge status="success">friends</Badge>}
                        {relation.type === "none" && (
                          <Button size="sm" onClick={() => sendFriendRequest(agent.id)}>
                            Add friend
                          </Button>
                        )}
                        {relation.type === "outbound" && <Badge status="warning">request sent</Badge>}
                        {relation.type === "inbound" && relation.friendship && (
                          <>
                            <Button size="sm" onClick={() => acceptFriendRequest(relation.friendship!.id)}>
                              Accept
                            </Button>
                            <Button size="sm" onClick={() => ignoreFriendRequest(relation.friendship!.id)}>
                              Ignore
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="agent-social-card">
              <SectionLabel className="mb-2">soul document</SectionLabel>
              {focusAgent && focusProfile ? (
                <div className="agent-social-soul-form">
                  <MetaText size="xs">
                    Editing {focusAgent.name} ({focusProfile.handle})
                  </MetaText>
                  <label className="agent-social-field">
                    <span>Handle</span>
                    <input
                      value={focusProfile.handle}
                      onChange={(event) => updateProfileField("handle", event.target.value)}
                    />
                  </label>
                  <label className="agent-social-field">
                    <span>Personality</span>
                    <input
                      value={focusProfile.personality}
                      onChange={(event) => updateProfileField("personality", event.target.value)}
                    />
                  </label>
                  <label className="agent-social-field">
                    <span>Mission</span>
                    <input
                      value={focusProfile.mission}
                      onChange={(event) => updateProfileField("mission", event.target.value)}
                    />
                  </label>
                  <label className="agent-social-field">
                    <span>Values</span>
                    <input
                      value={focusProfile.values}
                      onChange={(event) => updateProfileField("values", event.target.value)}
                    />
                  </label>
                  <label className="agent-social-field">
                    <span>Growth goal</span>
                    <textarea
                      value={focusProfile.growthGoal}
                      onChange={(event) => updateProfileField("growthGoal", event.target.value)}
                      rows={2}
                    />
                  </label>
                  <label className="agent-social-field">
                    <span>Soul text</span>
                    <textarea
                      value={focusProfile.soulDocument}
                      onChange={(event) => updateProfileField("soulDocument", event.target.value)}
                      rows={4}
                    />
                  </label>
                </div>
              ) : (
                <MetaText size="xs">Select an agent to edit soul fields.</MetaText>
              )}
            </Card>

            <Card className="agent-social-card">
              <SectionLabel className="mb-2">Google AutoCoder lane</SectionLabel>
              <div className="agent-social-google">
                <Switch
                  checked={socialState.googleLab.connected}
                  onCheckedChange={(checked) => updateGoogleLab({ connected: checked })}
                  label={socialState.googleLab.connected ? "Google lane active" : "Google lane paused"}
                />
                <label className="agent-social-field">
                  <span>Google project id</span>
                  <input
                    value={socialState.googleLab.projectId}
                    onChange={(event) => updateGoogleLab({ projectId: event.target.value })}
                    placeholder="project-id"
                  />
                </label>
                <label className="agent-social-field">
                  <span>Client email</span>
                  <input
                    value={socialState.googleLab.clientEmail}
                    onChange={(event) => updateGoogleLab({ clientEmail: event.target.value })}
                    placeholder="service-account@project.iam.gserviceaccount.com"
                  />
                </label>
                <label className="agent-social-field">
                  <span>Target agent</span>
                  <select
                    value={socialState.googleLab.targetAgentId}
                    onChange={(event) => updateGoogleLab({ targetAgentId: event.target.value })}
                  >
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="agent-social-field">
                  <span>Nano-banana prompt</span>
                  <textarea
                    value={socialState.googleLab.prompt}
                    onChange={(event) => updateGoogleLab({ prompt: event.target.value })}
                    rows={2}
                  />
                </label>
                <div className="agent-social-inline-actions">
                  <Button size="sm" onClick={generateAvatar}>Generate avatar</Button>
                  <Button size="sm" onClick={publishGoogleUpdate}>Publish status</Button>
                </div>
                <MetaText size="xs">
                  Last avatar: {socialState.googleLab.lastGeneratedAt ? relativeTime(socialState.googleLab.lastGeneratedAt) : "never"}
                </MetaText>
                <div className="agent-social-chip-row">
                  {googleAccounts.length > 0 ? googleAccounts.map((account) => (
                    <Badge key={account.id} status={account.status === "connected" ? "success" : "warning"}>
                      {account.display_name || account.email || account.id}
                    </Badge>
                  )) : (
                    <MetaText size="xs">No Google accounts connected. Add one in Integrations.</MetaText>
                  )}
                </div>
              </div>
            </Card>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
