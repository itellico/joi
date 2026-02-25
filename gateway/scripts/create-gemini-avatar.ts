#!/usr/bin/env npx tsx
/**
 * Create a "nano banana" avatar for the Gemini AutoCoder agent.
 * Stores the SVG as a media item in the JOI media system.
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

// ── Config ──
const MEDIA_ROOT = join(process.env.HOME || "/Users/mm2", ".joi", "media");
const DB_URL = process.env.DATABASE_URL || "postgres://joi:joi@mini:5434/joi";

const AGENT_ID = "google-coder";
const AGENT_NAME = "Gemini AutoCoder";

// ── Nano Banana Avatar SVG ──
// A glowing nano-scale banana with circuit traces and Gemini dual-tone energy
const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Background gradient: deep indigo to dark slate -->
    <radialGradient id="bg" cx="50%" cy="45%" r="70%">
      <stop offset="0%" stop-color="#1a1a3e"/>
      <stop offset="60%" stop-color="#0d0d24"/>
      <stop offset="100%" stop-color="#06060f"/>
    </radialGradient>

    <!-- Banana body gradient: electric yellow to warm amber -->
    <linearGradient id="banana" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffe066"/>
      <stop offset="35%" stop-color="#ffd700"/>
      <stop offset="70%" stop-color="#ffb300"/>
      <stop offset="100%" stop-color="#e69500"/>
    </linearGradient>

    <!-- Holographic sheen overlay -->
    <linearGradient id="sheen" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="40%" stop-color="#a78bfa" stop-opacity="0.15"/>
      <stop offset="70%" stop-color="#38bdf8" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>

    <!-- Gemini dual-tone glow -->
    <radialGradient id="glow-blue" cx="35%" cy="40%" r="40%">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow-purple" cx="65%" cy="60%" r="40%">
      <stop offset="0%" stop-color="#a855f7" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#a855f7" stop-opacity="0"/>
    </radialGradient>

    <!-- Nano glow filter -->
    <filter id="nano-glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>

    <!-- Circuit trace glow -->
    <filter id="circuit-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>

    <!-- Outer rim glow -->
    <filter id="rim-glow">
      <feGaussianBlur stdDeviation="12" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="512" height="512" fill="url(#bg)"/>

  <!-- Gemini dual-tone ambient glow -->
  <circle cx="180" cy="200" r="200" fill="url(#glow-blue)"/>
  <circle cx="330" cy="310" r="200" fill="url(#glow-purple)"/>

  <!-- Subtle grid / tech backdrop -->
  <g opacity="0.06" stroke="#8b8bff" stroke-width="0.5" fill="none">
    <line x1="0" y1="64" x2="512" y2="64"/>
    <line x1="0" y1="128" x2="512" y2="128"/>
    <line x1="0" y1="192" x2="512" y2="192"/>
    <line x1="0" y1="256" x2="512" y2="256"/>
    <line x1="0" y1="320" x2="512" y2="320"/>
    <line x1="0" y1="384" x2="512" y2="384"/>
    <line x1="0" y1="448" x2="512" y2="448"/>
    <line x1="64" y1="0" x2="64" y2="512"/>
    <line x1="128" y1="0" x2="128" y2="512"/>
    <line x1="192" y1="0" x2="192" y2="512"/>
    <line x1="256" y1="0" x2="256" y2="512"/>
    <line x1="320" y1="0" x2="320" y2="512"/>
    <line x1="384" y1="0" x2="384" y2="512"/>
    <line x1="448" y1="0" x2="448" y2="512"/>
  </g>

  <!-- Outer nano ring -->
  <circle cx="256" cy="256" r="210" fill="none" stroke="#ffd700" stroke-width="1.5" opacity="0.15" filter="url(#rim-glow)"/>
  <circle cx="256" cy="256" r="195" fill="none" stroke="#a855f7" stroke-width="0.8" opacity="0.1" stroke-dasharray="8 12"/>

  <!-- === NANO BANANA === -->
  <g filter="url(#nano-glow)" transform="translate(256, 240)">
    <!-- Banana shadow -->
    <ellipse cx="5" cy="85" rx="65" ry="12" fill="#000" opacity="0.2" />

    <!-- Banana body: curved crescent shape -->
    <path d="
      M -10,-95
      C 10,-105  55,-90  70,-55
      C 85,-20   80,25   60,60
      C 48,80    25,90   10,88
      C 0,87    -5,80  -8,70
      C -12,55  -10,30  -20,5
      C -30,-25 -40,-60 -30,-80
      C -25,-90 -18,-95 -10,-95
      Z
    " fill="url(#banana)" stroke="#e69500" stroke-width="1"/>

    <!-- Holographic sheen -->
    <path d="
      M -5,-90
      C 12,-98  48,-85  62,-55
      C 72,-30   68,15   52,50
      C 42,68   22,76   12,74
      C 8,72    2,64    0,55
      C -4,40   -2,20  -10,0
      C -20,-25 -28,-55 -22,-75
      C -18,-85 -10,-90 -5,-90
      Z
    " fill="url(#sheen)"/>

    <!-- Banana tip (top) -->
    <path d="M -10,-95 C -15,-100 -8,-108 0,-104 C 5,-102 10,-98 8,-95" fill="#8B7500" opacity="0.7"/>

    <!-- Banana tip (bottom stem) -->
    <ellipse cx="12" cy="88" rx="6" ry="4" fill="#8B7500" opacity="0.6" transform="rotate(-15, 12, 88)"/>

    <!-- Circuit traces on banana surface -->
    <g stroke="#ffee88" stroke-width="0.8" fill="none" opacity="0.5" filter="url(#circuit-glow)">
      <!-- Horizontal trace lines -->
      <path d="M 0,-60 L 30,-55 L 35,-50"/>
      <path d="M -5,-30 L 25,-22 L 40,-18"/>
      <path d="M -10,0 L 20,8 L 30,12"/>
      <path d="M -5,30 L 15,38 L 25,42"/>

      <!-- Circuit nodes -->
      <circle cx="35" cy="-50" r="2" fill="#ffee88"/>
      <circle cx="40" cy="-18" r="2" fill="#ffee88"/>
      <circle cx="30" cy="12" r="2" fill="#ffee88"/>
      <circle cx="25" cy="42" r="1.5" fill="#ffee88"/>

      <!-- Vertical bus -->
      <path d="M 35,-50 L 38,-35 L 40,-18 L 35,-2 L 30,12 L 28,28 L 25,42"/>
    </g>

    <!-- Nano particles around banana -->
    <g fill="#ffd700" opacity="0.6">
      <circle cx="-45" cy="-40" r="1.5">
        <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2.5s" repeatCount="indefinite"/>
      </circle>
      <circle cx="85" cy="-30" r="1.2">
        <animate attributeName="opacity" values="0.5;1;0.5" dur="3s" repeatCount="indefinite"/>
      </circle>
      <circle cx="-35" cy="30" r="1">
        <animate attributeName="opacity" values="0.4;0.9;0.4" dur="2s" repeatCount="indefinite"/>
      </circle>
      <circle cx="75" cy="40" r="1.3">
        <animate attributeName="opacity" values="0.3;0.7;0.3" dur="2.8s" repeatCount="indefinite"/>
      </circle>
      <circle cx="90" cy="10" r="0.8">
        <animate attributeName="opacity" values="0.6;1;0.6" dur="1.8s" repeatCount="indefinite"/>
      </circle>
    </g>

    <!-- Gemini-style orbiting particles -->
    <g fill="#a78bfa" opacity="0.5">
      <circle cx="-50" cy="-70" r="2">
        <animate attributeName="cx" values="-50;-55;-50" dur="4s" repeatCount="indefinite"/>
        <animate attributeName="cy" values="-70;-65;-70" dur="4s" repeatCount="indefinite"/>
      </circle>
      <circle cx="80" cy="65" r="2">
        <animate attributeName="cx" values="80;85;80" dur="3.5s" repeatCount="indefinite"/>
        <animate attributeName="cy" values="65;70;65" dur="3.5s" repeatCount="indefinite"/>
      </circle>
    </g>

    <!-- Blue energy particles -->
    <g fill="#38bdf8" opacity="0.4">
      <circle cx="-55" cy="10" r="1.5">
        <animate attributeName="opacity" values="0.2;0.6;0.2" dur="3.2s" repeatCount="indefinite"/>
      </circle>
      <circle cx="90" cy="-50" r="1.2">
        <animate attributeName="opacity" values="0.3;0.7;0.3" dur="2.6s" repeatCount="indefinite"/>
      </circle>
    </g>
  </g>

  <!-- "NANO" indicator: small hexagonal badge -->
  <g transform="translate(380, 400)">
    <polygon points="0,-18 16,-9 16,9 0,18 -16,9 -16,-9" fill="#1a1a3e" stroke="#ffd700" stroke-width="1.2" opacity="0.85"/>
    <text x="0" y="1" text-anchor="middle" dominant-baseline="central" font-family="monospace" font-size="8" fill="#ffd700" font-weight="bold" letter-spacing="1">N</text>
  </g>

  <!-- Bottom accent line -->
  <rect x="156" y="470" width="200" height="2" rx="1" fill="#ffd700" opacity="0.15"/>
</svg>`;

// ── Database insert ──
async function run() {
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: DB_URL });

  try {
    const mediaId = randomUUID();
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const filename = `gemini-autocoder-avatar-${Date.now()}.svg`;
    const storagePath = `${year}/${month}/${mediaId}.svg`;
    const fullPath = join(MEDIA_ROOT, storagePath);

    // Write SVG to disk
    await mkdir(dirname(fullPath), { recursive: true });
    const buffer = Buffer.from(AVATAR_SVG, "utf-8");
    await writeFile(fullPath, buffer);

    // ── Housekeeping: mark old avatars for this agent as 'replaced' ──
    await pool.query(
      `UPDATE media
          SET status = 'replaced', updated_at = NOW()
        WHERE sender_id = $1
          AND channel_type = 'agent-social'
          AND media_type = 'photo'
          AND status = 'ready'`,
      [AGENT_ID],
    );

    let finalMediaId = mediaId;
    let thumbnailPath: string | null = null;
    let width: number | null = 512;
    let height: number | null = 512;

    try {
      const sharp = (await import("sharp")).default;
      const pngBuffer = await sharp(buffer)
        .resize(512, 512)
        .png()
        .toBuffer();

      const pngStoragePath = `${year}/${month}/${mediaId}.png`;
      const pngFullPath = join(MEDIA_ROOT, pngStoragePath);
      await writeFile(pngFullPath, pngBuffer);

      const thumbDir = join(MEDIA_ROOT, "thumbs", year, month);
      await mkdir(thumbDir, { recursive: true });
      const thumbName = `${mediaId}_thumb.webp`;
      const thumbFullPath = join(thumbDir, thumbName);
      thumbnailPath = `thumbs/${year}/${month}/${thumbName}`;

      await sharp(pngBuffer)
        .resize(256, 256)
        .webp({ quality: 85 })
        .toFile(thumbFullPath);

      const meta = await sharp(pngBuffer).metadata();
      width = meta.width ?? 512;
      height = meta.height ?? 512;

      await pool.query(
        `INSERT INTO media (
           id, message_id, conversation_id, channel_type, channel_id, sender_id,
           media_type, filename, mime_type, size_bytes, storage_path, thumbnail_path,
           width, height, duration_seconds, status, caption
         ) VALUES (
           $1, NULL, NULL, $2, $3, $4,
           'photo', $5, $6, $7, $8, $9,
           $10, $11, NULL, 'ready', $12
         )
         ON CONFLICT (id) DO UPDATE SET
           storage_path = EXCLUDED.storage_path,
           thumbnail_path = EXCLUDED.thumbnail_path,
           size_bytes = EXCLUDED.size_bytes,
           status = 'ready',
           updated_at = NOW()`,
        [
          mediaId,
          "agent-social",
          "agent-social",
          AGENT_ID,
          filename.replace(".svg", ".png"),
          "image/png",
          pngBuffer.length,
          pngStoragePath,
          thumbnailPath,
          width,
          height,
          `Agent avatar for ${AGENT_NAME} (${AGENT_ID}) — nano banana`,
        ],
      );

      console.log(`✅ Avatar created successfully (PNG)!`);
      console.log(`   Media ID: ${mediaId}`);
      console.log(`   Agent: ${AGENT_NAME} (${AGENT_ID})`);
      console.log(`   Storage: ${pngStoragePath}`);
      console.log(`   Thumbnail: ${thumbnailPath}`);
      console.log(`   Size: ${pngBuffer.length} bytes (${width}x${height})`);
    } catch (sharpErr) {
      console.warn("Sharp not available, storing SVG directly:", sharpErr instanceof Error ? sharpErr.message : sharpErr);

      await pool.query(
        `INSERT INTO media (
           id, message_id, conversation_id, channel_type, channel_id, sender_id,
           media_type, filename, mime_type, size_bytes, storage_path, thumbnail_path,
           width, height, duration_seconds, status, caption
         ) VALUES (
           $1, NULL, NULL, $2, $3, $4,
           'photo', $5, $6, $7, $8, $9,
           $10, $11, NULL, 'ready', $12
         )
         ON CONFLICT (id) DO UPDATE SET
           storage_path = EXCLUDED.storage_path,
           size_bytes = EXCLUDED.size_bytes,
           status = 'ready',
           updated_at = NOW()`,
        [
          mediaId,
          "agent-social",
          "agent-social",
          AGENT_ID,
          filename,
          "image/svg+xml",
          buffer.length,
          storagePath,
          null,
          width,
          height,
          `Agent avatar for ${AGENT_NAME} (${AGENT_ID}) — nano banana`,
        ],
      );

      console.log(`✅ Avatar created (SVG fallback)!`);
      console.log(`   Media ID: ${mediaId}`);
      console.log(`   Storage: ${storagePath}`);
    }

    // ── Update agent's avatar_url (if column exists) ──
    const avatarUrl = `/api/media/${finalMediaId}/file`;
    try {
      await pool.query(
        `UPDATE agents SET avatar_url = $1, updated_at = NOW() WHERE id = $2`,
        [avatarUrl, AGENT_ID],
      );
      console.log(`   avatar_url: ${avatarUrl}`);
    } catch (urlErr) {
      const msg = urlErr instanceof Error ? urlErr.message : String(urlErr);
      if (msg.includes("avatar_url")) {
        console.warn(`   ⚠ avatar_url column not found (run migration 045 first)`);
      } else {
        throw urlErr;
      }
    }

    console.log(`   URL: /api/media/${finalMediaId}/file`);
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error("❌ Failed to create avatar:", err);
  process.exit(1);
});
