// Google Drive API wrapper for file management
// Multi-account: all functions accept optional accountId

import { google, type drive_v3 } from "googleapis";
import { getAuthClient } from "./auth.js";
import { Readable } from "node:stream";

const driveCache = new Map<string, drive_v3.Drive>();
const folderCache = new Map<string, string>();

async function getDrive(accountId?: string): Promise<drive_v3.Drive> {
  const key = accountId || "_default";
  if (driveCache.has(key)) return driveCache.get(key)!;
  const auth = await getAuthClient(accountId);
  const drive = google.drive({ version: "v3", auth });
  driveCache.set(key, drive);
  return drive;
}

/**
 * Find or create a folder by path (e.g. "JOI/Accounting/2026-01").
 * Creates intermediate folders as needed.
 */
export async function ensureFolder(folderPath: string, accountId?: string): Promise<string> {
  const cacheKey = `${accountId || "_default"}:${folderPath}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey)!;

  const drive = await getDrive(accountId);
  const parts = folderPath.split("/");
  let parentId = "root";

  for (let i = 0; i < parts.length; i++) {
    const name = parts[i];
    const currentPath = parts.slice(0, i + 1).join("/");
    const currentCacheKey = `${accountId || "_default"}:${currentPath}`;

    if (folderCache.has(currentCacheKey)) {
      parentId = folderCache.get(currentCacheKey)!;
      continue;
    }

    // Search for existing folder
    const { data } = await drive.files.list({
      q: `name = '${name}' AND '${parentId}' IN parents AND mimeType = 'application/vnd.google-apps.folder' AND trashed = false`,
      fields: "files(id, name)",
      spaces: "drive",
    });

    if (data.files && data.files.length > 0) {
      parentId = data.files[0].id!;
    } else {
      // Create folder
      const { data: created } = await drive.files.create({
        requestBody: {
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parentId],
        },
        fields: "id",
      });
      parentId = created.id!;
    }

    folderCache.set(currentCacheKey, parentId);
  }

  return parentId;
}

export interface UploadResult {
  fileId: string;
  name: string;
  webViewLink: string;
}

/**
 * Upload a file to a specific Drive folder.
 */
export async function uploadFile(
  fileName: string,
  content: Buffer,
  mimeType: string,
  folderPath: string,
  accountId?: string,
): Promise<UploadResult> {
  const drive = await getDrive(accountId);
  const folderId = await ensureFolder(folderPath, accountId);

  const { data } = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(content),
    },
    fields: "id, name, webViewLink",
  });

  return {
    fileId: data.id!,
    name: data.name!,
    webViewLink: data.webViewLink || "",
  };
}

/**
 * List files in a folder.
 */
export async function listFiles(
  folderPath: string,
  options?: { mimeType?: string; limit?: number },
  accountId?: string,
): Promise<Array<{ id: string; name: string; mimeType: string; size: string; createdTime: string }>> {
  const drive = await getDrive(accountId);
  const folderId = await ensureFolder(folderPath, accountId);

  let q = `'${folderId}' in parents AND trashed = false`;
  if (options?.mimeType) {
    q += ` AND mimeType = '${options.mimeType}'`;
  }

  const { data } = await drive.files.list({
    q,
    fields: "files(id, name, mimeType, size, createdTime)",
    orderBy: "createdTime desc",
    pageSize: options?.limit || 100,
  });

  return (data.files || []).map((f) => ({
    id: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
    size: f.size || "0",
    createdTime: f.createdTime || "",
  }));
}

/**
 * Download a file from Drive.
 */
export async function downloadFile(fileId: string, accountId?: string): Promise<Buffer> {
  const drive = await getDrive(accountId);

  const { data } = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );

  return Buffer.from(data as ArrayBuffer);
}

/**
 * Move a file to a different folder.
 */
export async function moveFile(
  fileId: string,
  targetFolderPath: string,
  accountId?: string,
): Promise<void> {
  const drive = await getDrive(accountId);
  const targetFolderId = await ensureFolder(targetFolderPath, accountId);

  // Get current parents
  const { data: file } = await drive.files.get({
    fileId,
    fields: "parents",
  });

  const previousParents = (file.parents || []).join(",");

  await drive.files.update({
    fileId,
    addParents: targetFolderId,
    removeParents: previousParents,
    fields: "id, parents",
  });
}

/**
 * Check if a file already exists in a folder (by name).
 */
export async function fileExists(
  fileName: string,
  folderPath: string,
  accountId?: string,
): Promise<string | null> {
  const drive = await getDrive(accountId);

  try {
    const folderId = await ensureFolder(folderPath, accountId);
    const { data } = await drive.files.list({
      q: `name = '${fileName}' AND '${folderId}' in parents AND trashed = false`,
      fields: "files(id)",
      spaces: "drive",
    });

    return data.files && data.files.length > 0 ? data.files[0].id! : null;
  } catch {
    return null;
  }
}
