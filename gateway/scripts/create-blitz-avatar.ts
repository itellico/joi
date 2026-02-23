#!/usr/bin/env npx tsx
/**
 * Create a "Launch Commander" avatar for the Blitz agent.
 * Stores the SVG as a media item in the JOI media system.
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

// ── Config ──
const MEDIA_ROOT = join(process.env.HOME || "/Users/mm2", ".joi", "media");
const DB_URL = process.env.DATABASE_URL || "postgres://joi:joi@192.168.178.58:5434/joi";

const AGENT_ID = "blitz";
const AGENT_NAME = "Blitz";

// ── Blitz Avatar SVG ──
// A tactical lightning bolt trail launching a rocket into deep space
const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Background: Deep Space / Tactical Navy -->
    <radialGradient id="bg" cx="50%" cy="40%" r="80%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="60%" stop-color="#020617"/>
      <stop offset="100%" stop-color="#000000"/>
    </radialGradient>

    <!-- Lightning Bolt / Trail Gradient -->
    <linearGradient id="bolt-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0ea5e9" stop-opacity="0.2"/>
      <stop offset="40%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#00e5ff"/>
    </linearGradient>

    <!-- Launch Glow -->
    <linearGradient id="launch-glow" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ff4d00"/>
      <stop offset="100%" stop-color="#fbbf24" stop-opacity="0"/>
    </linearGradient>

    <!-- Tech accents -->
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>

    <filter id="heavy-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="15" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="512" height="512" fill="url(#bg)"/>

  <!-- Radar/Tactical Grid -->
  <g opacity="0.1" stroke="#38bdf8" stroke-width="1" fill="none">
    <circle cx="256" cy="256" r="100"/>
    <circle cx="256" cy="256" r="200"/>
    <line x1="256" y1="0" x2="256" y2="512"/>
    <line x1="0" y1="256" x2="512" y2="256"/>
    <path d="M 0 0 L 512 512 M 512 0 L 0 512" stroke-dasharray="4 8"/>
  </g>

  <!-- Launch Plume -->
  <path d="M 256 420 Q 256 380 280 340 L 232 340 Q 256 380 256 420" fill="url(#launch-glow)" filter="url(#glow)" opacity="0.6">
    <animate attributeName="opacity" values="0.4;0.8;0.4" dur="0.8s" repeatCount="indefinite"/>
  </path>

  <!-- Blitz Lightning Trail -->
  <path d="M 120 480 L 200 320 L 160 340 L 256 120 L 220 160 L 320 40" 
        fill="none" stroke="url(#bolt-gradient)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)">
    <animate attributeName="stroke-dasharray" values="0,1000;1000,0" dur="2s" repeatCount="indefinite"/>
  </path>

  <!-- Rocket/Command Module -->
  <g transform="translate(320, 40) rotate(45)">
    <path d="M 0 -30 L 15 10 L -15 10 Z" fill="#f8fafc" filter="url(#glow)"/>
    <rect x="-15" y="10" width="30" height="40" fill="#f8fafc"/>
    <path d="M -15 50 L -25 70 L 25 70 L 15 50 Z" fill="#94a3b8"/>
    <!-- Viewport -->
    <circle cx="0" cy="25" r="6" fill="#0ea5e9" filter="url(#glow)"/>
  </g>

  <!-- Status Indicators -->
  <g transform="translate(40, 40)" opacity="0.8">
    <rect width="100" height="4" fill="#334155" rx="2"/>
    <rect width="70" height="4" fill="#00e5ff" rx="2">
      <animate attributeName="width" values="70;90;70" dur="3s" repeatCount="indefinite"/>
    </rect>
    <text x="0" y="20" font-family="monospace" font-size="10" fill="#00e5ff">LAUNCH_SEQ: ACTIVE</text>
  </g>

  <!-- "BLITZ" Tactical Badge -->
  <g transform="translate(400, 450)">
    <rect x="-50" y="-18" width="100" height="36" rx="4" fill="#020617" stroke="#00e5ff" stroke-width="2" filter="url(#glow)"/>
    <text x="0" y="6" text-anchor="middle" font-family="monospace" font-size="16" fill="#00e5ff" font-weight="bold" letter-spacing="2">BLITZ</text>
  </g>

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
    const filename = `blitz-avatar-${Date.now()}.svg`;
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
          `Agent avatar for ${AGENT_NAME} (${AGENT_ID}) — Launch Commander`,
        ],
      );

      console.log(`✅ Avatar created successfully (PNG)!`);
      console.log(`   Media ID: ${mediaId}`);
      console.log(`   Agent: ${AGENT_NAME} (${AGENT_ID})`);
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
          `Agent avatar for ${AGENT_NAME} (${AGENT_ID}) — Launch Commander`,
        ],
      );

      console.log(`✅ Avatar created (SVG fallback)!`);
    }

    // ── Update agent's avatar_url ──
    const avatarUrl = `/api/media/${finalMediaId}/file`;
    try {
      await pool.query(
        `UPDATE agents SET avatar_url = $1, updated_at = NOW() WHERE id = $2`,
        [avatarUrl, AGENT_ID],
      );
      console.log(`   avatar_url: ${avatarUrl}`);
    } catch (urlErr) {
      console.warn(`   ⚠ avatar_url update failed (might need migration 045)`);
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
