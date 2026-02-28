import type { LiveKitEdits, ModelRoute } from "./types";

export type LanguagePresetId = "de_safe" | "en_safe";

type LivekitPresetFields = Pick<
  LiveKitEdits,
  | "language"
  | "sttProvider"
  | "sttModel"
  | "ttsProvider"
  | "ttsModel"
  | "ttsVoice"
  | "voiceModel"
  | "voicePrompt"
  | "pronunciations"
  | "voiceHistoryLimit"
  | "voiceEnableTools"
  | "voiceIncludeMemory"
  | "voiceMinEndpointSec"
  | "voiceMaxEndpointSec"
>;

export interface LanguagePreset {
  id: LanguagePresetId;
  label: string;
  description: string;
  languageLabel: string;
  livekit: LivekitPresetFields;
  routes: ModelRoute[];
}

const CARTESIA_VICTORIA_VOICE_ID = "b9de4a89-2257-424b-94c2-db18ba68c81a";

const SAFE_MODEL_ROUTES: ModelRoute[] = [
  { task: "chat", model: "claude-sonnet-4-20250514", provider: "anthropic" },
  { task: "lightweight", model: "openai/gpt-4o-mini", provider: "openrouter" },
  { task: "tool", model: "openai/gpt-4o-mini", provider: "openrouter" },
  { task: "utility", model: "anthropic/claude-haiku-3-20240307", provider: "openrouter" },
  { task: "triage", model: "openai/gpt-4o-mini", provider: "openrouter" },
  { task: "classifier", model: "openai/gpt-4.1-nano", provider: "openrouter" },
  { task: "embedding", model: "nomic-embed-text", provider: "ollama" },
];

export const LANGUAGE_PRESETS: Record<LanguagePresetId, LanguagePreset> = {
  de_safe: {
    id: "de_safe",
    label: "German Safe",
    description: "German-first setup for voice + model routing with stable defaults.",
    languageLabel: "Deutsch",
    livekit: {
      language: "de",
      sttProvider: "deepgram",
      sttModel: "nova-3",
      ttsProvider: "cartesia",
      ttsModel: "sonic-2",
      ttsVoice: CARTESIA_VICTORIA_VOICE_ID,
      voiceModel: "openai/gpt-4o-mini",
      voicePrompt:
        "Du antwortest im Voice-Modus. Antworte immer auf Deutsch, kurz und natuerlich. Keine Markdown-Formatierung, keine Aufzaehlungen.",
      pronunciations: [{ word: "JOI", replacement: "Joy" }],
      voiceHistoryLimit: 8,
      voiceEnableTools: false,
      voiceIncludeMemory: false,
      voiceMinEndpointSec: 0.15,
      voiceMaxEndpointSec: 0.8,
    },
    routes: SAFE_MODEL_ROUTES,
  },
  en_safe: {
    id: "en_safe",
    label: "English Safe",
    description: "English-first setup for voice + model routing with stable defaults.",
    languageLabel: "English",
    livekit: {
      language: "en",
      sttProvider: "deepgram",
      sttModel: "nova-3",
      ttsProvider: "cartesia",
      ttsModel: "sonic-2",
      ttsVoice: CARTESIA_VICTORIA_VOICE_ID,
      voiceModel: "openai/gpt-4o-mini",
      voicePrompt:
        "You are responding in voice mode. Always answer in English, concise and natural. Avoid markdown and bullet lists.",
      pronunciations: [{ word: "JOI", replacement: "Joy" }],
      voiceHistoryLimit: 8,
      voiceEnableTools: false,
      voiceIncludeMemory: false,
      voiceMinEndpointSec: 0.15,
      voiceMaxEndpointSec: 0.8,
    },
    routes: SAFE_MODEL_ROUTES,
  },
};
