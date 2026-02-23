#!/usr/bin/env npx tsx
/**
 * Create a professional "Avatar Studio" avatar.
 * Stores the SVG as a media item in the JOI media system.
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

// ── Config ──
const MEDIA_ROOT = join(process.env.HOME || "/Users/mm2", ".joi", "media");
const DB_URL = process.env.DATABASE_URL || "postgres://joi:joi@mini.local:5434/joi";

const AGENT_ID = "avatar-studio";
const AGENT_NAME = "Avatar Studio";

// ── Avatar Studio Avatar SVG ──
// A creative lens / artistic iris with prismatic energy and stylistic nodes
const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Background: Deep Obsidian / Studio Dark -->
    <radialGradient id="bg" cx="50%" cy="50%" r="75%">
      <stop offset="0%" stop-color="#111827"/>
      <stop offset="100%" stop-color="#030712"/>
    </radialGradient>

    <!-- Prismatic Energy (Gemini/Creative vibe) -->
    <conicGradient id="prism" cx="256" cy="256" angle="0">
      <stop offset="0%" stop-color="#22d3ee"/> <!-- Cyan -->
      <stop offset="25%" stop-color="#a855f7"/> <!-- Purple -->
      <stop offset="50%" stop-color="#f43f5e"/> <!-- Rose -->
      <stop offset="75%" stop-color="#fbbf24"/> <!-- Gold -->
      <stop offset="100%" stop-color="#22d3ee"/>
    </conicGradient>

    <!-- Lens Glass Sheen -->
    <linearGradient id="sheen" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.2"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.1"/>
    </linearGradient>

    <!-- Glow filters -->
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
    
    <filter id="heavy-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="15" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>

    <mask id="lens-mask">
      <circle cx="256" cy="256" r="180" fill="white"/>
    </mask>
  </defs>

  <!-- Background -->
  <rect width="512" height="512" fill="url(#bg)"/>

  <!-- Creative Aura / Pulse -->
  <circle cx="256" cy="256" r="220" fill="none" stroke="url(#prism)" stroke-width="1" opacity="0.15">
    <animate attributeName="r" values="220;235;220" dur="8s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.15;0.05;0.15" dur="8s" repeatCount="indefinite"/>
  </circle>

  <!-- Studio Grid Backdrop -->
  <g opacity="0.04" stroke="#94a3b8" stroke-width="0.5" fill="none">
    <path d="M 0 128 H 512 M 0 256 H 512 M 0 384 H 512"/>
    <path d="M 128 0 V 512 M 256 0 V 512 M 384 0 V 512"/>
  </g>

  <!-- Main Lens Housing -->
  <circle cx="256" cy="256" r="200" fill="#0f172a" stroke="#334155" stroke-width="4" filter="url(#glow)"/>
  <circle cx="256" cy="256" r="185" fill="none" stroke="#1e293b" stroke-width="12"/>

  <!-- The Prism Core (Iris) -->
  <g mask="url(#lens-mask)">
    <circle cx="256" cy="256" r="180" fill="url(#prism)" opacity="0.8">
      <animateTransform attributeName="transform" type="rotate" from="0 256 256" to="360 256 256" dur="20s" repeatCount="indefinite"/>
    </circle>
    
    <!-- Stylized Iris Blades -->
    <g fill="#030712" opacity="0.9">
      <path d="M 256 76 L 380 200 L 380 312 L 256 436 L 132 312 L 132 200 Z" opacity="0.4"/>
      <path d="M 256 100 L 350 200 L 350 312 L 256 412 L 162 312 L 162 200 Z"/>
    </g>

    <!-- Internal Lens Reflections -->
    <circle cx="200" cy="200" r="120" fill="url(#sheen)" transform="rotate(-15, 256, 256)"/>
    <ellipse cx="320" cy="350" rx="40" ry="20" fill="white" opacity="0.1" transform="rotate(30, 320, 350)"/>
  </g>

  <!-- Center Focal Point -->
  <circle cx="256" cy="256" r="40" fill="#030712" stroke="#475569" stroke-width="2"/>
  <circle cx="256" cy="256" r="15" fill="white" filter="url(#heavy-glow)" opacity="0.8">
    <animate attributeName="opacity" values="0.8;0.4;0.8" dur="4s" repeatCount="indefinite"/>
  </circle>

  <!-- Style Nodes / Particles -->
  <g fill="white" opacity="0.6" filter="url(#glow)">
    <circle cx="100" cy="256" r="3">
      <animate attributeName="opacity" values="0.6;1;0.6" dur="3s" repeatCount="indefinite"/>
    </circle>
    <circle cx="412" cy="256" r="3">
      <animate attributeName="opacity" values="0.6;1;0.6" dur="3.5s" repeatCount="indefinite"/>
    </circle>
    <circle cx="256" cy="100" r="3">
      <animate attributeName="opacity" values="0.6;1;0.6" dur="4s" repeatCount="indefinite"/>
    </circle>
    <circle cx="256" cy="412" r="3">
      <animate attributeName="opacity" values="0.6;1;0.6" dur="4.5s" repeatCount="indefinite"/>
    </circle>
  </g>

  <!-- Artistic Badge -->
  <g transform="translate(420, 440)">
    <rect x="-40" y="-15" width="80" height="30" rx="15" fill="#020617" stroke="#a855f7" stroke-width="1.5"/>
    <text x="0" y="5" text-anchor="middle" font-family="monospace" font-size="12" fill="#a855f7" font-weight="bold">STUDIO</text>
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
    const filename = `avatar-studio-avatar-${Date.now()}.svg`;
    const storagePath = `${year}/${month}/${mediaId}.svg`;
    const fullPath = join(MEDIA_ROOT, storagePath);

    // Write SVG to disk
    await mkdir(dirname(fullPath), { recursive: true });
    const buffer = Buffer.from(AVATAR_SVG, "utf-8");
    await writeFile(fullPath, buffer);

    // Also create a PNG rasterization via sharp for thumbnail
    let thumbnailPath: string | null = null;
    let width: number | null = 512;
    let height: number | null = 512;

    try {
      const sharp = (await import("sharp")).default;
      const pngBuffer = await sharp(buffer)
        .resize(512, 512)
        .png()
        .toBuffer();

      // Save PNG version too
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

      // Use PNG as main stored file
      const pngMediaId = mediaId;
      await pool.query(
        `INSERT INTO media (
           id, message_id, conversation_id, channel_type, channel_id, sender_id,
           media_type, filename, mime_type, size_bytes, storage_path, thumbnail_path,
           width, height, duration_seconds, status, caption
         ) VALUES (
           $1, NULL, NULL, $2, $3, $4,
           'photo', $5, $6, $7, $8, $9,
           $10, $11, NULL, 'ready', $12
         )`,
        [
          pngMediaId,
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
          `Agent avatar for ${AGENT_NAME} (${AGENT_ID}) — Prismatic Lens`,
        ],
      );

      console.log(`✅ Avatar created successfully!`);
      console.log(`   Media ID: ${pngMediaId}`);
      console.log(`   Agent: ${AGENT_NAME} (${AGENT_ID})`);
      console.log(`   Storage: ${pngStoragePath}`);
      console.log(`   Thumbnail: ${thumbnailPath}`);
      console.log(`   Size: ${pngBuffer.length} bytes (${width}x${height})`);
      console.log(`   URL: /api/media/${pngMediaId}/file`);
    } catch (sharpErr) {
      const errorStr = sharpErr instanceof Error ? sharpErr.message : String(sharpErr);
      if (errorStr.includes("duplicate key value violates unique constraint")) {
        console.log("✅ Avatar already stored in DB.");
        return;
      }

      console.warn("Sharp not available, storing SVG directly:", errorStr);

      await pool.query(
        `INSERT INTO media (
           id, message_id, conversation_id, channel_type, channel_id, sender_id,
           media_type, filename, mime_type, size_bytes, storage_path, thumbnail_path,
           width, height, duration_seconds, status, caption
         ) VALUES (
           $1, NULL, NULL, $2, $3, $4,
           'photo', $5, $6, $7, $8, $9,
           $10, $11, NULL, 'ready', $12
         )`,
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
          `Agent avatar for ${AGENT_NAME} (${AGENT_ID}) — Prismatic Lens`,
        ],
      );

      console.log(`✅ Avatar created (SVG fallback)!`);
      console.log(`   Media ID: ${mediaId}`);
      console.log(`   Storage: ${storagePath}`);
      console.log(`   URL: /api/media/${mediaId}/file`);
    }
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error("❌ Failed to create avatar:", err);
  process.exit(1);
});
