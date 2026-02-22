// Agent tool definitions and handlers for YouTube transcription + audio transcription

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "../agent/tools.js";
import { transcribeYouTube, transcribeAudioFile } from "./transcriber.js";

type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<unknown>;

export function getYouTubeToolHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set("youtube_transcribe", async (input) => {
    const { url, language } = input as { url: string; language?: string };
    if (!url) return { error: "url is required" };

    try {
      const result = await transcribeYouTube(url, language || "en");
      return {
        videoId: result.videoId,
        text: result.text,
        segmentCount: result.segmentCount,
        method: result.method,
        language: result.language,
        segments: result.segmentCount <= 500 ? result.segments : undefined,
        truncatedSegments: result.segmentCount > 500,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Failed to transcribe: ${message}` };
    }
  });

  handlers.set("audio_transcribe", async (input) => {
    const { file_path, language } = input as { file_path: string; language?: string };
    if (!file_path) return { error: "file_path is required" };

    try {
      const result = await transcribeAudioFile(file_path, language || "auto");
      return {
        text: result.text,
        segmentCount: result.segments.length,
        language: result.language,
        method: "mlx-whisper",
        segments: result.segments.length <= 500 ? result.segments : undefined,
        truncatedSegments: result.segments.length > 500,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Failed to transcribe: ${message}` };
    }
  });

  return handlers;
}

export function getYouTubeToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "youtube_transcribe",
      description:
        "Transcribe a YouTube video. Extracts the full transcript from a YouTube video URL or ID. " +
        "Uses 3 methods: (1) YouTube captions if available, (2) yt-dlp subtitle download, " +
        "(3) local mlx-whisper speech-to-text for videos without captions. " +
        "Use this when the user asks about the content of a YouTube video, wants a summary, " +
        "or needs to extract information from a video.",
      input_schema: {
        type: "object" as const,
        properties: {
          url: {
            type: "string",
            description:
              "YouTube video URL (e.g. https://www.youtube.com/watch?v=xxx, https://youtu.be/xxx) or video ID",
          },
          language: {
            type: "string",
            description:
              "Language code for captions (default: 'en'). Use 'de' for German, 'fr' for French, etc.",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "audio_transcribe",
      description:
        "Transcribe an audio or video file to text using local mlx-whisper (runs on Apple Silicon). " +
        "Supports MP3, MP4, WAV, M4A, WEBM, and other common formats. " +
        "Use this for meeting recordings, voice memos, podcasts, or any audio file the user wants transcribed.",
      input_schema: {
        type: "object" as const,
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the audio/video file to transcribe",
          },
          language: {
            type: "string",
            description:
              "Language code (default: 'auto' for auto-detection). Use 'en', 'de', 'fr', etc.",
          },
        },
        required: ["file_path"],
      },
    },
  ];
}
