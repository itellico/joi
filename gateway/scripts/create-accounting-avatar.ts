#!/usr/bin/env npx tsx
/**
 * Create a professional "Accounting Orchestrator" avatar.
 * Stores the SVG as a media item in the JOI media system.
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

// ── Config ──
const MEDIA_ROOT = join(process.env.HOME || "/Users/mm2", ".joi", "media");
const DB_URL = process.env.DATABASE_URL || "postgres://joi:joi@mini.local:5434/joi";

const AGENT_ID = "accounting-orchestrator";
const AGENT_NAME = "Accounting Orchestrator";

// ── Accounting Orchestrator Avatar SVG ──
// A glowing 3D bar chart with orchestration nodes and financial emerald/gold tones
const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Background: Deep Slate/Navy -->
    <radialGradient id="bg" cx="50%" cy="45%" r="70%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="60%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#020617"/>
    </radialGradient>

    <!-- Emerald Glow for bars -->
    <linearGradient id="emerald-glow" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#064e3b"/>
    </linearGradient>

    <!-- Gold Accent -->
    <linearGradient id="gold-glow" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24"/>
      <stop offset="100%" stop-color="#92400e"/>
    </linearGradient>

    <!-- Cyber Blue Accent -->
    <linearGradient id="cyan-glow" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#22d3ee"/>
      <stop offset="100%" stop-color="#0891b2"/>
    </linearGradient>

    <!-- Glow filters -->
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>

    <filter id="heavy-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="12" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="512" height="512" fill="url(#bg)"/>

  <!-- Subtle grid -->
  <g opacity="0.05" stroke="#94a3b8" stroke-width="1" fill="none">
    <path d="M 0 64 H 512 M 0 128 H 512 M 0 192 H 512 M 0 256 H 512 M 0 320 H 512 M 0 384 H 512 M 0 448 H 512"/>
    <path d="M 64 0 V 512 M 128 0 V 512 M 192 0 V 512 M 256 0 V 512 M 320 0 V 512 M 384 0 V 512 M 448 0 V 512"/>
  </g>

  <!-- Orchestration Rings -->
  <circle cx="256" cy="256" r="210" fill="none" stroke="#10b981" stroke-width="1" opacity="0.1" filter="url(#glow)"/>
  <circle cx="256" cy="256" r="180" fill="none" stroke="#fbbf24" stroke-width="0.5" opacity="0.1" stroke-dasharray="10 15"/>

  <!-- 📊 Bar Chart Composition -->
  <g transform="translate(100, 380)">
    <!-- Axis lines -->
    <path d="M 0 0 H 320 M 0 0 V -280" stroke="#94a3b8" stroke-width="2" opacity="0.3"/>

    <!-- Bar 1 (Small) -->
    <rect x="30" y="-80" width="50" height="80" fill="url(#emerald-glow)" rx="4" filter="url(#glow)" opacity="0.8">
      <animate attributeName="height" values="80;95;80" dur="4s" repeatCount="indefinite"/>
      <animate attributeName="y" values="-80;-95;-80" dur="4s" repeatCount="indefinite"/>
    </rect>

    <!-- Bar 2 (Medium) -->
    <rect x="100" y="-160" width="50" height="160" fill="url(#cyan-glow)" rx="4" filter="url(#glow)" opacity="0.9">
      <animate attributeName="height" values="160;140;160" dur="5s" repeatCount="indefinite"/>
      <animate attributeName="y" values="-160;-140;-160" dur="5s" repeatCount="indefinite"/>
    </rect>

    <!-- Bar 3 (Large) -->
    <rect x="170" y="-240" width="50" height="240" fill="url(#emerald-glow)" rx="4" filter="url(#glow)" opacity="0.8">
      <animate attributeName="height" values="240;260;240" dur="6s" repeatCount="indefinite"/>
      <animate attributeName="y" values="-240;-260;-240" dur="6s" repeatCount="indefinite"/>
    </rect>

    <!-- Bar 4 (Accent) -->
    <rect x="240" y="-120" width="50" height="120" fill="url(#gold-glow)" rx="4" filter="url(#glow)" opacity="0.9">
      <animate attributeName="height" values="120;135;120" dur="4.5s" repeatCount="indefinite"/>
      <animate attributeName="y" values="-120;-135;-120" dur="4.5s" repeatCount="indefinite"/>
    </rect>

    <!-- Orchestration Nodes & Connections -->
    <g stroke="#ffffff" stroke-width="1.5" opacity="0.4">
      <circle cx="55" cy="-80" r="4" fill="#fbbf24">
        <animate attributeName="cy" values="-80;-95;-80" dur="4s" repeatCount="indefinite"/>
      </circle>
      <circle cx="125" cy="-160" r="4" fill="#fbbf24">
        <animate attributeName="cy" values="-160;-140;-160" dur="5s" repeatCount="indefinite"/>
      </circle>
      <circle cx="195" cy="-240" r="4" fill="#fbbf24">
        <animate attributeName="cy" values="-240;-260;-240" dur="6s" repeatCount="indefinite"/>
      </circle>
      <circle cx="265" cy="-120" r="4" fill="#fbbf24">
        <animate attributeName="cy" values="-120;-135;-120" dur="4.5s" repeatCount="indefinite"/>
      </circle>

      <!-- Connection line -->
      <path d="M 55 -80 L 125 -160 L 195 -240 L 265 -120" fill="none" stroke="#fbbf24" stroke-width="2" stroke-dasharray="4 4" opacity="0.6">
         <!-- This is harder to animate perfectly but gives the 'trend line' look -->
      </path>
    </g>
  </g>

  <!-- Floating Currency Symbols / Particles -->
  <g font-family="Arial" font-size="24" fill="#10b981" opacity="0.2">
    <text x="400" y="100">€</text>
    <text x="80" y="150">$</text>
    <text x="420" y="300">£</text>
  </g>

  <!-- "ORCH" Badge -->
  <g transform="translate(420, 440)">
    <rect x="-40" y="-15" width="80" height="30" rx="15" fill="#020617" stroke="#fbbf24" stroke-width="1.5"/>
    <text x="0" y="5" text-anchor="middle" font-family="monospace" font-size="12" fill="#fbbf24" font-weight="bold">ORCH</text>
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
    const filename = `accounting-orchestrator-avatar-${Date.now()}.svg`;
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

    // Try PNG rasterization via sharp, fall back to SVG
    let finalMediaId = mediaId;
    let finalStoragePath = storagePath;
    let thumbnailPath: string | null = null;
    let width: number | null = 512;
    let height: number | null = 512;
    let usedPng = false;

    try {
      const sharp = (await import("sharp")).default;
      const pngBuffer = await sharp(buffer)
        .resize(512, 512)
        .png()
        .toBuffer();

      // Save PNG version
      const pngStoragePath = `${year}/${month}/${mediaId}.png`;
      const pngFullPath = join(MEDIA_ROOT, pngStoragePath);
      await writeFile(pngFullPath, pngBuffer);

      // Generate thumbnail
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
      finalStoragePath = pngStoragePath;
      usedPng = true;

      // Insert media record (use ON CONFLICT to be idempotent)
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
          `Agent avatar for ${AGENT_NAME} (${AGENT_ID}) — 3D Bar Chart Orchestrator`,
        ],
      );

      console.log(`✅ Avatar created successfully (PNG)!`);
      console.log(`   Media ID: ${mediaId}`);
      console.log(`   Agent: ${AGENT_NAME} (${AGENT_ID})`);
      console.log(`   Storage: ${pngStoragePath}`);
      console.log(`   Thumbnail: ${thumbnailPath}`);
      console.log(`   Size: ${pngBuffer.length} bytes (${width}x${height})`);
    } catch (sharpErr) {
      const errorStr = sharpErr instanceof Error ? sharpErr.message : String(sharpErr);
      console.warn("Sharp not available, storing SVG directly:", errorStr);

      // Fallback: store SVG directly (also idempotent)
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
          `Agent avatar for ${AGENT_NAME} (${AGENT_ID}) — 3D Bar Chart Orchestrator`,
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
      // Column may not exist yet if migration 045 hasn't run
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
