// YouTube transcript extraction
// 3-tier approach:
//   1. youtube-transcript npm — fast caption scraping (currently unreliable)
//   2. yt-dlp — download existing captions from YouTube (reliable)
//   3. mlx-whisper — local speech-to-text on Apple Silicon (for videos without captions)

import { YoutubeTranscript } from "youtube-transcript";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface TranscriptSegment {
  text: string;
  offset: number;   // ms from start
  duration: number;  // ms
}

export interface TranscriptResult {
  videoId: string;
  segments: TranscriptSegment[];
  text: string;          // joined plain text
  method: "captions" | "yt-dlp" | "mlx-whisper";
  language: string;
  segmentCount: number;
}

const MLX_WHISPER_MODEL = "mlx-community/whisper-small-mlx";

function extractVideoId(input: string): string | null {
  // Handle plain video IDs
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;

  // Handle various YouTube URL formats
  try {
    const url = new URL(input);
    if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
    if (url.hostname.includes("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v) return v;
      // /embed/ID or /shorts/ID
      const parts = url.pathname.split("/");
      if (parts[1] === "embed" || parts[1] === "shorts") return parts[2] || null;
    }
  } catch {
    // Not a URL
  }
  return null;
}

// ─── Tier 1: YouTube captions API (npm package) ───

async function fetchViaCaptions(videoId: string, lang: string): Promise<TranscriptResult> {
  const raw = await YoutubeTranscript.fetchTranscript(videoId, { lang });
  const segments: TranscriptSegment[] = raw.map((s) => ({
    text: s.text,
    offset: s.offset,
    duration: s.duration,
  }));

  const text = segments.map((s) => s.text).join(" ");

  return {
    videoId,
    segments,
    text,
    method: "captions",
    language: lang,
    segmentCount: segments.length,
  };
}

// ─── Tier 2: yt-dlp caption download ───

function parseVtt(vttContent: string): TranscriptSegment[] {
  // YouTube auto-captions use a rolling/scrolling style: each VTT block
  // contains 2-3 lines, overlapping with the previous block. Block N+1
  // repeats all but the last line of block N, adding one new line at the
  // bottom. This causes each phrase to appear 2-3x in the raw output.
  //
  // Strategy: track individual text lines (normalized) across all blocks
  // and only emit genuinely new lines, preserving timestamps.

  const segments: TranscriptSegment[] = [];
  const seenLines = new Set<string>();
  const vttLines = vttContent.split("\n");
  let i = 0;

  // Skip VTT header
  while (i < vttLines.length && !vttLines[i].includes("-->")) i++;

  while (i < vttLines.length) {
    const line = vttLines[i].trim();
    const timeMatch = line.match(
      /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/,
    );
    if (timeMatch) {
      const startMs =
        parseInt(timeMatch[1]) * 3600000 +
        parseInt(timeMatch[2]) * 60000 +
        parseInt(timeMatch[3]) * 1000 +
        parseInt(timeMatch[4]);
      const endMs =
        parseInt(timeMatch[5]) * 3600000 +
        parseInt(timeMatch[6]) * 60000 +
        parseInt(timeMatch[7]) * 1000 +
        parseInt(timeMatch[8]);

      i++;
      const newLines: string[] = [];
      while (i < vttLines.length && vttLines[i].trim() !== "" && !vttLines[i].includes("-->")) {
        const cleaned = vttLines[i].replace(/<[^>]+>/g, "").trim();
        if (cleaned) {
          const normalized = cleaned.toLowerCase();
          if (!seenLines.has(normalized)) {
            seenLines.add(normalized);
            newLines.push(cleaned);
          }
        }
        i++;
      }

      if (newLines.length > 0) {
        segments.push({
          text: newLines.join(" "),
          offset: startMs,
          duration: endMs - startMs,
        });
      }
    } else {
      i++;
    }
  }

  return segments;
}

async function fetchViaYtDlp(videoId: string, lang: string): Promise<TranscriptResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-transcript-"));
  const outTemplate = path.join(tmpDir, "sub");

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        "yt-dlp",
        [
          "--skip-download",
          "--write-auto-subs",
          "--write-subs",
          "--sub-langs", lang,
          "--sub-format", "vtt",
          "-o", outTemplate,
          `https://www.youtube.com/watch?v=${videoId}`,
        ],
        { timeout: 30000 },
        (err, _stdout, stderr) => {
          if (err) return reject(new Error(`yt-dlp failed: ${stderr || err.message}`));
          resolve();
        },
      );
    });

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".vtt"));
    if (files.length === 0) throw new Error("No subtitle file generated by yt-dlp");

    const vttContent = fs.readFileSync(path.join(tmpDir, files[0]), "utf-8");
    const segments = parseVtt(vttContent);
    const text = segments.map((s) => s.text).join(" ");

    return {
      videoId,
      segments,
      text,
      method: "yt-dlp",
      language: lang,
      segmentCount: segments.length,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Tier 3: mlx-whisper local speech-to-text ───

async function fetchViaWhisper(videoId: string, lang: string): Promise<TranscriptResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-whisper-"));

  try {
    // Step 1: Download audio only via yt-dlp
    const audioPath = path.join(tmpDir, "audio.mp3");
    await new Promise<void>((resolve, reject) => {
      execFile(
        "yt-dlp",
        [
          "-f", "bestaudio",
          "--extract-audio",
          "--audio-format", "mp3",
          "-o", audioPath,
          `https://www.youtube.com/watch?v=${videoId}`,
        ],
        { timeout: 120000 },
        (err, _stdout, stderr) => {
          if (err) return reject(new Error(`yt-dlp audio download failed: ${stderr || err.message}`));
          resolve();
        },
      );
    });

    if (!fs.existsSync(audioPath)) {
      throw new Error("Audio file not created by yt-dlp");
    }

    // Step 2: Transcribe with mlx_whisper
    await new Promise<void>((resolve, reject) => {
      execFile(
        "mlx_whisper",
        [
          audioPath,
          "--model", MLX_WHISPER_MODEL,
          "--output-format", "json",
          "--output-dir", tmpDir,
          ...(lang !== "auto" ? ["--language", lang] : []),
        ],
        { timeout: 300000 }, // 5 min for long videos
        (err, _stdout, stderr) => {
          if (err) return reject(new Error(`mlx_whisper failed: ${stderr || err.message}`));
          resolve();
        },
      );
    });

    // Step 3: Parse JSON output
    const jsonPath = path.join(tmpDir, "audio.json");
    if (!fs.existsSync(jsonPath)) {
      throw new Error("mlx_whisper did not produce JSON output");
    }

    const result = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as {
      text: string;
      segments: Array<{ start: number; end: number; text: string }>;
      language: string;
    };

    const segments: TranscriptSegment[] = result.segments.map((s) => ({
      text: s.text.trim(),
      offset: Math.round(s.start * 1000),
      duration: Math.round((s.end - s.start) * 1000),
    }));

    const text = result.text.trim();

    return {
      videoId,
      segments,
      text,
      method: "mlx-whisper",
      language: result.language || lang,
      segmentCount: segments.length,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Main entry point ───

export async function transcribeYouTube(
  urlOrId: string,
  language = "en",
): Promise<TranscriptResult> {
  const videoId = extractVideoId(urlOrId);
  if (!videoId) throw new Error(`Could not extract video ID from: ${urlOrId}`);

  // Tier 1: captions API (fast, lightweight)
  try {
    const result = await fetchViaCaptions(videoId, language);
    if (result.segmentCount > 0) return result;
  } catch {
    // Fall through
  }

  // Tier 2: yt-dlp caption download (reliable for videos with captions)
  try {
    const result = await fetchViaYtDlp(videoId, language);
    if (result.segmentCount > 0) return result;
  } catch {
    // Fall through
  }

  // Tier 3: mlx-whisper local transcription (for captionless videos)
  return await fetchViaWhisper(videoId, language);
}

// ─── Standalone audio file transcription ───

export async function transcribeAudioFile(
  filePath: string,
  language = "auto",
): Promise<{ text: string; segments: TranscriptSegment[]; language: string }> {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-file-"));
  const baseName = path.basename(filePath, path.extname(filePath));

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        "mlx_whisper",
        [
          filePath,
          "--model", MLX_WHISPER_MODEL,
          "--output-format", "json",
          "--output-dir", tmpDir,
          ...(language !== "auto" ? ["--language", language] : []),
        ],
        { timeout: 300000 },
        (err, _stdout, stderr) => {
          if (err) return reject(new Error(`mlx_whisper failed: ${stderr || err.message}`));
          resolve();
        },
      );
    });

    const jsonPath = path.join(tmpDir, `${baseName}.json`);
    if (!fs.existsSync(jsonPath)) {
      throw new Error("mlx_whisper did not produce JSON output");
    }

    const result = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as {
      text: string;
      segments: Array<{ start: number; end: number; text: string }>;
      language: string;
    };

    return {
      text: result.text.trim(),
      segments: result.segments.map((s) => ({
        text: s.text.trim(),
        offset: Math.round(s.start * 1000),
        duration: Math.round((s.end - s.start) * 1000),
      })),
      language: result.language || language,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
