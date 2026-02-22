import { Card, Badge, Button, FormField, FormGrid, MetaText, Switch } from "../../components/ui";
import VoicePicker from "./VoicePicker";
import type { SettingsData, LiveKitKeys, LiveKitEdits, ModelOption } from "./types";

// Only streaming-compatible models — batch-only models (whisper) are excluded
const STT_MODELS: Record<string, ModelOption[]> = {
  deepgram: [
    { id: "nova-3", label: "Nova-3 (Best accuracy, multilingual, $0.0077/min)" },
    { id: "nova-2-general", label: "Nova-2 General (Great accuracy, proven, $0.0058/min)" },
    { id: "nova-2-conversationalai", label: "Nova-2 ConversationalAI (Optimized for agents, $0.0058/min)" },
    { id: "nova-2", label: "Nova-2 (Auto-select, $0.0058/min)" },
  ],
};

const TTS_MODELS: Record<string, ModelOption[]> = {
  cartesia: [
    { id: "sonic-3", label: "Sonic 3 (Latest, 42 languages, lowest latency)" },
    { id: "sonic-2", label: "Sonic 2 (Multilingual, stable)" },
    { id: "sonic-multilingual", label: "Sonic Multilingual (Older multilingual)" },
    { id: "sonic-english", label: "Sonic English (English only, fast)" },
  ],
  elevenlabs: [
    { id: "eleven_v3", label: "Eleven v3 (Newest, most expressive, 70+ langs)" },
    { id: "eleven_multilingual_v2", label: "Multilingual v2 (Premium, 29 langs)" },
    { id: "eleven_turbo_v2_5", label: "Turbo v2.5 (Low latency, 32 langs)" },
    { id: "eleven_flash_v2_5", label: "Flash v2.5 (Ultra-fast ~75ms, 32 langs, half price)" },
    { id: "eleven_flash_v2", label: "Flash v2 (Ultra-fast ~75ms, English only, half price)" },
  ],
  openai: [
    { id: "gpt-4o-mini-tts", label: "GPT-4o Mini TTS (Newest, expressive, ~$0.015/min)" },
    { id: "tts-1", label: "TTS-1 (Standard, fast, $15/1M chars)" },
    { id: "tts-1-hd", label: "TTS-1 HD (High quality, slower, $30/1M chars)" },
  ],
};

interface VoiceTabProps {
  settings: SettingsData;
  livekitKeys: LiveKitKeys;
  setLivekitKeys: React.Dispatch<React.SetStateAction<LiveKitKeys>>;
  livekitEdits: LiveKitEdits;
  setLivekitEdits: React.Dispatch<React.SetStateAction<LiveKitEdits>>;
}

export default function VoiceTab({ settings, livekitKeys, setLivekitKeys, livekitEdits, setLivekitEdits }: VoiceTabProps) {
  return (
    <div className="flex-col gap-6">
      {/* LiveKit Voice Pipeline */}
      <Card>
        <h3 className="mb-1">LiveKit Voice Pipeline</h3>
        <MetaText size="sm" className="block mb-4 text-md">
          Real-time voice via WebRTC. Self-hosted LiveKit server handles VAD, STT, LLM, and TTS.
          The agent worker runs in Docker alongside the LiveKit server.
        </MetaText>
        <FormGrid>
          <FormField label="LiveKit Server URL" hint="Self-hosted LiveKit server (ws://localhost:7880)">
            <div className="flex-row gap-2">
              <input
                type="text"
                placeholder="ws://localhost:7880"
                value={livekitEdits.url}
                onChange={(e) => setLivekitEdits((p) => ({ ...p, url: e.target.value }))}
              />
              {settings.livekit.url && <Badge status="success">Set</Badge>}
            </div>
          </FormField>
          <FormField label="LiveKit API Key" hint="Matches key in livekit.yaml">
            <div className="flex-row gap-2">
              <input
                type="password"
                placeholder={settings.livekit.apiKey || "joi-api-key"}
                value={livekitKeys.apiKey}
                onChange={(e) => setLivekitKeys((p) => ({ ...p, apiKey: e.target.value }))}
              />
              {settings.livekit.apiKey && <Badge status="success">Active</Badge>}
            </div>
          </FormField>
          <FormField label="LiveKit API Secret" hint="Matches secret in livekit.yaml">
            <div className="flex-row gap-2">
              <input
                type="password"
                placeholder={settings.livekit.apiSecret || "..."}
                value={livekitKeys.apiSecret}
                onChange={(e) => setLivekitKeys((p) => ({ ...p, apiSecret: e.target.value }))}
              />
              {settings.livekit.apiSecret && <Badge status="success">Active</Badge>}
            </div>
          </FormField>
          <FormField label="STT Provider" hint="Speech-to-text engine">
            <select
              value={livekitEdits.sttProvider}
              onChange={(e) => {
                const provider = e.target.value;
                const firstModel = STT_MODELS[provider]?.[0]?.id || "";
                setLivekitEdits((p) => ({ ...p, sttProvider: provider, sttModel: firstModel }));
              }}
            >
              <option value="deepgram">Deepgram</option>
            </select>
          </FormField>
          <FormField label="STT Model" hint="Speech recognition model — affects accuracy, latency, and cost">
            <select
              value={livekitEdits.sttModel}
              onChange={(e) => setLivekitEdits((p) => ({ ...p, sttModel: e.target.value }))}
            >
              {(STT_MODELS[livekitEdits.sttProvider] || []).map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
              {livekitEdits.sttModel && !(STT_MODELS[livekitEdits.sttProvider] || []).some((m) => m.id === livekitEdits.sttModel) && (
                <option value={livekitEdits.sttModel}>{livekitEdits.sttModel} (custom)</option>
              )}
            </select>
          </FormField>
          <FormField label="TTS Provider" hint="Text-to-speech engine">
            <select
              value={livekitEdits.ttsProvider}
              onChange={(e) => {
                const provider = e.target.value;
                const firstModel = TTS_MODELS[provider]?.[0]?.id || "";
                setLivekitEdits((p) => ({ ...p, ttsProvider: provider, ttsModel: firstModel }));
              }}
            >
              <option value="cartesia">Cartesia</option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="openai">OpenAI</option>
            </select>
          </FormField>
          <FormField label="TTS Model" hint="Voice synthesis model — affects quality, latency, and language support">
            <select
              value={livekitEdits.ttsModel}
              onChange={(e) => setLivekitEdits((p) => ({ ...p, ttsModel: e.target.value }))}
            >
              {(TTS_MODELS[livekitEdits.ttsProvider] || []).map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
              {livekitEdits.ttsModel && !(TTS_MODELS[livekitEdits.ttsProvider] || []).some((m) => m.id === livekitEdits.ttsModel) && (
                <option value={livekitEdits.ttsModel}>{livekitEdits.ttsModel} (custom)</option>
              )}
            </select>
          </FormField>
        </FormGrid>
      </Card>

      {/* Voice Runtime & Cache */}
      <Card>
        <h3 className="mb-1">Voice Runtime &amp; Cache</h3>
        <MetaText size="sm" className="block mb-4 text-md">
          These settings control voice latency behavior and Cartesia TTS caching (local memory + Redis).
        </MetaText>
        <FormGrid>
          <FormField label="Voice LLM Model" hint="Model used by /api/voice/chat in fast voice mode">
            <input
              type="text"
              value={livekitEdits.voiceModel}
              onChange={(e) => setLivekitEdits((p) => ({ ...p, voiceModel: e.target.value }))}
              placeholder="openai/gpt-4o-mini"
            />
          </FormField>

          <FormField label="Voice History Limit" hint="Recent message window sent to the voice LLM (2-50)">
            <input
              type="number"
              min={2}
              max={50}
              step={1}
              value={livekitEdits.voiceHistoryLimit}
              onChange={(e) => {
                const n = Number(e.target.value);
                const safe = Number.isFinite(n) ? Math.max(2, Math.min(50, n)) : 8;
                setLivekitEdits((p) => ({ ...p, voiceHistoryLimit: safe }));
              }}
            />
          </FormField>

          <FormField label="Enable Tools in Voice" hint="Higher capability, higher latency">
            <Switch
              checked={livekitEdits.voiceEnableTools}
              onCheckedChange={(checked) => setLivekitEdits((p) => ({ ...p, voiceEnableTools: checked }))}
            />
          </FormField>

          <FormField label="Include Memory Context" hint="Adds long-term context to voice prompts (slower)">
            <Switch
              checked={livekitEdits.voiceIncludeMemory}
              onCheckedChange={(checked) => setLivekitEdits((p) => ({ ...p, voiceIncludeMemory: checked }))}
            />
          </FormField>

          <FormField label="Min Endpoint Delay (sec)" hint="Lower = faster turn-taking, can clip speech if too low">
            <input
              type="number"
              min={0}
              max={3}
              step={0.05}
              value={livekitEdits.voiceMinEndpointSec}
              onChange={(e) => {
                const n = Number(e.target.value);
                const safe = Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : 0.15;
                setLivekitEdits((p) => ({ ...p, voiceMinEndpointSec: safe }));
              }}
            />
          </FormField>

          <FormField label="Max Endpoint Delay (sec)" hint="Upper bound for endpointing wait before response">
            <input
              type="number"
              min={0}
              max={5}
              step={0.05}
              value={livekitEdits.voiceMaxEndpointSec}
              onChange={(e) => {
                const n = Number(e.target.value);
                const safe = Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0.8;
                setLivekitEdits((p) => ({ ...p, voiceMaxEndpointSec: safe }));
              }}
            />
          </FormField>

          <FormField label="Enable TTS Cache" hint="Use cache before calling Cartesia">
            <Switch
              checked={livekitEdits.ttsCacheEnabled}
              onCheckedChange={(checked) => setLivekitEdits((p) => ({ ...p, ttsCacheEnabled: checked }))}
            />
          </FormField>

          <FormField label="Local Cache Items" hint="Max in-memory cache entries on worker">
            <input
              type="number"
              min={0}
              max={10000}
              step={1}
              value={livekitEdits.ttsCacheLocalMaxItems}
              onChange={(e) => {
                const n = Number(e.target.value);
                const safe = Number.isFinite(n) ? Math.max(0, Math.min(10000, n)) : 512;
                setLivekitEdits((p) => ({ ...p, ttsCacheLocalMaxItems: safe }));
              }}
            />
          </FormField>

          <FormField label="Local Cache Size (MB)" hint="Memory cap for local cache eviction">
            <input
              type="number"
              min={1}
              max={2048}
              step={1}
              value={Math.round(livekitEdits.ttsCacheLocalMaxBytes / (1024 * 1024))}
              onChange={(e) => {
                const n = Number(e.target.value);
                const safeMb = Number.isFinite(n) ? Math.max(1, Math.min(2048, n)) : 64;
                setLivekitEdits((p) => ({ ...p, ttsCacheLocalMaxBytes: safeMb * 1024 * 1024 }));
              }}
            />
          </FormField>

          <FormField label="Cache Max Text Chars" hint="Skip caching very long utterances">
            <input
              type="number"
              min={32}
              max={2000}
              step={1}
              value={livekitEdits.ttsCacheMaxTextChars}
              onChange={(e) => {
                const n = Number(e.target.value);
                const safe = Number.isFinite(n) ? Math.max(32, Math.min(2000, n)) : 280;
                setLivekitEdits((p) => ({ ...p, ttsCacheMaxTextChars: safe }));
              }}
            />
          </FormField>

          <FormField label="Cache Max Audio (KB)" hint="Skip caching oversized synthesized audio">
            <input
              type="number"
              min={16}
              max={16384}
              step={16}
              value={Math.round(livekitEdits.ttsCacheMaxAudioBytes / 1024)}
              onChange={(e) => {
                const n = Number(e.target.value);
                const safeKb = Number.isFinite(n) ? Math.max(16, Math.min(16384, n)) : 2048;
                setLivekitEdits((p) => ({ ...p, ttsCacheMaxAudioBytes: safeKb * 1024 }));
              }}
            />
          </FormField>

          <FormField label="Redis TTL (sec)" hint="Expiration for remote Redis cached entries">
            <input
              type="number"
              min={60}
              max={60 * 60 * 24 * 30}
              step={60}
              value={livekitEdits.ttsCacheRedisTtlSec}
              onChange={(e) => {
                const n = Number(e.target.value);
                const safe = Number.isFinite(n) ? Math.max(60, Math.min(60 * 60 * 24 * 30, n)) : 604800;
                setLivekitEdits((p) => ({ ...p, ttsCacheRedisTtlSec: safe }));
              }}
            />
          </FormField>

          <FormField label="Cache Key Prefix" hint="Namespace prefix in local/remote cache">
            <input
              type="text"
              value={livekitEdits.ttsCachePrefix}
              onChange={(e) => setLivekitEdits((p) => ({ ...p, ttsCachePrefix: e.target.value }))}
              placeholder="joi:tts:v1"
            />
          </FormField>

          <FormField label="Redis URL (mini.local)" hint="Redis endpoint on your mini host, e.g. redis://mini.local:6379/0">
            <input
              type="text"
              value={livekitEdits.ttsCacheRedisUrl}
              onChange={(e) => setLivekitEdits((p) => ({ ...p, ttsCacheRedisUrl: e.target.value }))}
              placeholder="redis://mini.local:6379/0"
            />
          </FormField>
        </FormGrid>
      </Card>

      {/* Voice Selection */}
      <VoicePicker
        provider={livekitEdits.ttsProvider}
        selectedVoiceId={livekitEdits.ttsVoice}
        onSelect={(id) => setLivekitEdits((p) => ({ ...p, ttsVoice: id }))}
      />

      {/* Pronunciations & Voice Style */}
      <Card>
        <h3 className="mb-1">Pronunciations &amp; Voice Style</h3>
        <MetaText size="sm" className="block mb-4 text-md">
          Custom pronunciation rules ensure words are spoken correctly by the TTS engine.
          The voice prompt shapes how the LLM responds in voice mode (concise, conversational, no markdown).
        </MetaText>

        {/* Pronunciation Rules */}
        <div className="mb-4">
          <div className="flex-row justify-between mb-2">
            <MetaText size="sm" className="text-secondary" style={{ fontWeight: 600 }}>Pronunciation Rules</MetaText>
            <Button
              size="sm"
              onClick={() =>
                setLivekitEdits((p) => ({
                  ...p,
                  pronunciations: [...p.pronunciations, { word: "", replacement: "" }],
                }))
              }
            >
              + Add Rule
            </Button>
          </div>
          <div className="flex-col gap-2">
            {livekitEdits.pronunciations.map((rule, i) => (
              <div key={i} className="flex-row gap-2 pronunciation-rule">
                <input
                  type="text"
                  placeholder="Word (e.g. JOI)"
                  value={rule.word}
                  onChange={(e) =>
                    setLivekitEdits((p) => ({
                      ...p,
                      pronunciations: p.pronunciations.map((r, j) =>
                        j === i ? { ...r, word: e.target.value } : r
                      ),
                    }))
                  }
                  style={{ flex: "1 1 120px" }}
                />
                <span className="text-muted" style={{ padding: "0 4px", userSelect: "none" }}>→</span>
                <input
                  type="text"
                  placeholder="Say as (e.g. Joy)"
                  value={rule.replacement}
                  onChange={(e) =>
                    setLivekitEdits((p) => ({
                      ...p,
                      pronunciations: p.pronunciations.map((r, j) =>
                        j === i ? { ...r, replacement: e.target.value } : r
                      ),
                    }))
                  }
                  style={{ flex: "1 1 120px" }}
                />
                <input
                  type="text"
                  placeholder="IPA (optional)"
                  value={rule.ipa || ""}
                  onChange={(e) =>
                    setLivekitEdits((p) => ({
                      ...p,
                      pronunciations: p.pronunciations.map((r, j) =>
                        j === i ? { ...r, ipa: e.target.value || undefined } : r
                      ),
                    }))
                  }
                  style={{ flex: "0 1 140px" }}
                  title="IPA phonemes for Cartesia (e.g. dʒɔɪ)"
                />
                <button
                  className="pronunciation-delete"
                  onClick={() =>
                    setLivekitEdits((p) => ({
                      ...p,
                      pronunciations: p.pronunciations.filter((_, j) => j !== i),
                    }))
                  }
                  title="Remove rule"
                >
                  ×
                </button>
              </div>
            ))}
            {livekitEdits.pronunciations.length === 0 && (
              <MetaText size="sm" className="text-muted">No pronunciation rules. Click "+ Add Rule" to add one.</MetaText>
            )}
          </div>
        </div>

        {/* Voice Prompt */}
        <FormField
          label="Voice Mode Prompt"
          hint="Extra system prompt injected when responding via voice. Controls tone, style, and formatting."
        >
          <textarea
            rows={5}
            value={livekitEdits.voicePrompt}
            onChange={(e) => setLivekitEdits((p) => ({ ...p, voicePrompt: e.target.value }))}
            placeholder="You are responding via voice (text-to-speech). Keep responses concise and conversational..."
            style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", resize: "vertical" }}
          />
        </FormField>
      </Card>
    </div>
  );
}
