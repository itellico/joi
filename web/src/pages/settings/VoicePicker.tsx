import { useEffect, useState, useCallback, useRef } from "react";
import { Card, Badge, MetaText } from "../../components/ui";

export interface VoiceInfo {
  id: string;
  name: string;
  description: string;
  language: string;
  gender: string;
  previewUrl?: string | null;
}

export const LANGUAGES: Record<string, string> = {
  "": "All Languages",
  en: "English",
  de: "German",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  hi: "Hindi",
  ar: "Arabic",
  tr: "Turkish",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
  no: "Norwegian",
  cs: "Czech",
  ro: "Romanian",
  el: "Greek",
  hu: "Hungarian",
  uk: "Ukrainian",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  ms: "Malay",
  tl: "Filipino",
  bg: "Bulgarian",
  hr: "Croatian",
  sk: "Slovak",
  he: "Hebrew",
  ka: "Georgian",
  ta: "Tamil",
  te: "Telugu",
  bn: "Bengali",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  mr: "Marathi",
  pa: "Punjabi",
};

export const GENDERS: Record<string, string> = {
  "": "All",
  masculine: "Male",
  feminine: "Female",
  gender_neutral: "Neutral",
};

export default function VoicePicker({ provider, selectedVoiceId, onSelect }: {
  provider: string;
  selectedVoiceId: string;
  onSelect: (id: string) => void;
}) {
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [languageFilter, setLanguageFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [search, setSearch] = useState("");
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchVoices = useCallback(async () => {
    if (provider === "openai") return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ provider });
      if (genderFilter) params.set("gender", genderFilter);
      const res = await fetch(`/api/livekit/voices?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch voices");
      }
      const data = await res.json();
      setVoices(data.voices || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load voices");
    } finally {
      setLoading(false);
    }
  }, [provider, genderFilter]);

  useEffect(() => { fetchVoices(); }, [fetchVoices]);

  const playPreview = async (voiceId: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (previewingId === voiceId) {
      setPreviewingId(null);
      return;
    }

    setPreviewingId(voiceId);
    try {
      const res = await fetch("/api/livekit/voices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceId,
          provider,
          ...(previewText.trim() ? { text: previewText.trim() } : {}),
        }),
      });

      if (!res.ok) throw new Error("Preview failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setPreviewingId(null);
        URL.revokeObjectURL(url);
      };
      audio.play();
    } catch {
      setPreviewingId(null);
    }
  };

  const filtered = voices.filter((v) => {
    if (languageFilter && v.language !== languageFilter && !v.language?.startsWith(languageFilter)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!v.name.toLowerCase().includes(q) && !v.description.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const availableLanguages = [...new Set(voices.map((v) => v.language?.split("-")[0] || "en"))].sort();

  if (provider === "openai") {
    return (
      <Card>
        <h3 className="mb-1">Voice Selection</h3>
        <MetaText size="sm" className="block mb-4 text-md">
          OpenAI TTS uses fixed voice names: alloy, echo, fable, onyx, nova, shimmer.
        </MetaText>
        <div className="voice-grid">
          {["alloy", "echo", "fable", "onyx", "nova", "shimmer"].map((name) => (
            <button
              key={name}
              className={`voice-card ${selectedVoiceId === name ? "voice-card-selected" : ""}`}
              onClick={() => onSelect(name)}
            >
              <span className="voice-card-name">{name}</span>
            </button>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h3 className="mb-1">Voice Selection</h3>
      <MetaText size="sm" className="block mb-4 text-md">
        Browse and preview voices from {provider === "cartesia" ? "Cartesia" : "ElevenLabs"}.
        Click a voice to select it, use the play button to preview.
      </MetaText>

      {/* Filters */}
      <div className="flex-row gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Search voices..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: "1 1 200px", minWidth: 150 }}
        />
        <select
          value={languageFilter}
          onChange={(e) => setLanguageFilter(e.target.value)}
          style={{ minWidth: 140 }}
        >
          <option value="">All Languages</option>
          {availableLanguages.map((lang) => (
            <option key={lang} value={lang}>{LANGUAGES[lang] || lang}</option>
          ))}
        </select>
        <select
          value={genderFilter}
          onChange={(e) => setGenderFilter(e.target.value)}
          style={{ minWidth: 100 }}
        >
          {Object.entries(GENDERS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        <MetaText size="sm" className="flex-row" style={{ alignItems: "center" }}>
          {filtered.length} voice{filtered.length !== 1 ? "s" : ""}
        </MetaText>
      </div>

      {/* Preview text */}
      <div className="flex-row gap-2 mb-4">
        <input
          type="text"
          placeholder="Custom preview text (leave blank for default with pronunciation words)"
          value={previewText}
          onChange={(e) => setPreviewText(e.target.value)}
          style={{ flex: 1 }}
        />
        {previewText && (
          <button
            className="pronunciation-delete"
            onClick={() => setPreviewText("")}
            title="Reset to default"
            style={{ fontSize: 11, width: "auto", padding: "0 8px" }}
          >
            Reset
          </button>
        )}
      </div>

      {loading && <MetaText size="sm" className="text-muted">Loading voices...</MetaText>}
      {error && <MetaText size="sm" className="text-error">{error}</MetaText>}

      {/* Voice Grid */}
      {!loading && (
        <div className="voice-grid">
          {filtered.map((voice) => (
            <div
              key={voice.id}
              className={`voice-card ${selectedVoiceId === voice.id ? "voice-card-selected" : ""}`}
              onClick={() => onSelect(voice.id)}
            >
              <div className="voice-card-header">
                <span className="voice-card-name">{voice.name}</span>
                <button
                  className="voice-preview-btn"
                  onClick={(e) => { e.stopPropagation(); playPreview(voice.id); }}
                  title="Preview voice"
                >
                  {previewingId === voice.id ? "■" : "▶"}
                </button>
              </div>
              <div className="voice-card-meta">
                <span className="voice-tag">{LANGUAGES[voice.language?.split("-")[0]] || voice.language}</span>
                <span className="voice-tag">{voice.gender === "masculine" ? "Male" : voice.gender === "feminine" ? "Female" : "Neutral"}</span>
              </div>
              {voice.description && (
                <MetaText size="xs" className="voice-card-desc">{voice.description}</MetaText>
              )}
              {selectedVoiceId === voice.id && (
                <Badge status="success" className="voice-card-badge">Selected</Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
