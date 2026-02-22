/** Per-channel language definitions used across STT, TTS, system prompt, and triage. */

export interface LanguageDef {
  name: string;       // Display name (in its own language)
  locale: string;     // IETF locale for date/time formatting
  deepgram: string;   // Deepgram STT language code
  flag: string;       // Emoji flag for UI
}

export const LANGUAGES: Record<string, LanguageDef> = {
  en: { name: "English",    locale: "en-US", deepgram: "en-US", flag: "\uD83C\uDDEC\uD83C\uDDE7" },
  de: { name: "Deutsch",    locale: "de-AT", deepgram: "de",    flag: "\uD83C\uDDE6\uD83C\uDDF9" },
  fr: { name: "Fran\u00E7ais",   locale: "fr-FR", deepgram: "fr",    flag: "\uD83C\uDDEB\uD83C\uDDF7" },
  es: { name: "Espa\u00F1ol",    locale: "es-ES", deepgram: "es",    flag: "\uD83C\uDDEA\uD83C\uDDF8" },
  it: { name: "Italiano",   locale: "it-IT", deepgram: "it",    flag: "\uD83C\uDDEE\uD83C\uDDF9" },
  pt: { name: "Portugu\u00EAs",  locale: "pt-PT", deepgram: "pt",    flag: "\uD83C\uDDF5\uD83C\uDDF9" },
};

/** Resolve a language code to its definition, falling back to English. */
export function getLanguageDef(code: string | null | undefined): LanguageDef {
  return LANGUAGES[code || "en"] ?? LANGUAGES.en;
}
