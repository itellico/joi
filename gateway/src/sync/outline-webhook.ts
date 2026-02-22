// Outline webhook receiver — Express Router

import crypto from "node:crypto";
import { Router } from "express";
import { query } from "../db/client.js";
import { log, logWarn, logError } from "../logging.js";
import { syncOutlineToObsidian } from "./outline-sync.js";
import * as api from "./outline-api.js";
import type { JoiConfig } from "../config/schema.js";
import type { OutlineWebhookPayload } from "./outline-types.js";

export function createOutlineWebhookRouter(config: JoiConfig): Router {
  const router = Router();

  router.post("/", (req, res) => {
    // Verify HMAC signature if webhook secret is configured
    if (config.outline.webhookSecret) {
      const signature = req.headers["outline-signature"] as string | undefined;
      if (!signature) {
        logWarn("outline", "Webhook missing signature header");
        res.status(401).json({ error: "Missing signature" });
        return;
      }

      const hmac = crypto.createHmac("sha256", config.outline.webhookSecret);
      hmac.update(JSON.stringify(req.body));
      const expected = hmac.digest("hex");

      if (signature !== expected) {
        logWarn("outline", "Webhook signature mismatch");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    // Respond immediately
    res.status(200).json({ ok: true });

    // Process async
    const payload = req.body as OutlineWebhookPayload;
    processWebhook(payload, config).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      logError("outline", `Webhook processing failed: ${message}`, { event: payload.event });
    });
  });

  return router;
}

async function processWebhook(payload: OutlineWebhookPayload, config: JoiConfig): Promise<void> {
  const { event } = payload;
  const docId = payload.payload?.model?.id || payload.payload?.id;

  if (!docId) {
    logWarn("outline", `Webhook missing document ID for event: ${event}`);
    return;
  }

  log("outline", `Webhook received: ${event}`, { docId });

  switch (event) {
    case "documents.create":
    case "documents.update":
    case "documents.publish": {
      // Fetch full document from API (webhook payload may not have full text)
      try {
        const doc = await api.getDocument(config, docId);
        await syncOutlineToObsidian(doc, config);
        log("outline", `Synced from webhook: ${doc.title}`, { event, docId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError("outline", `Failed to sync from webhook: ${message}`, { event, docId });
      }
      break;
    }

    case "documents.delete":
    case "documents.archive": {
      await query(
        `UPDATE outline_sync_state SET status = 'deleted', updated_at = NOW() WHERE outline_id = $1`,
        [docId],
      );
      log("outline", `Marked deleted: ${docId}`, { event });
      break;
    }

    default:
      log("outline", `Ignoring webhook event: ${event}`, { docId });
  }
}
