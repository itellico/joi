export interface IntegrationWatchdogAlert {
  channelId: string;
  channelType: string;
  status: string;
  source: "heartbeat" | "ws.status" | "ws.qr";
  message: string;
  detectedAt: string;
}

export interface IntegrationWatchdogQr {
  channelId: string;
  channelType: string;
  qrDataUrl: string;
  receivedAt: string;
}

const ALERT_KEY = "joi.integration.watchdog.alert";
const QR_KEY = "joi.integration.watchdog.qr";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function storeIntegrationWatchdogAlert(alert: IntegrationWatchdogAlert): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(ALERT_KEY, JSON.stringify(alert));
}

export function consumeIntegrationWatchdogAlert(): IntegrationWatchdogAlert | null {
  if (typeof window === "undefined") return null;
  const parsed = safeParse<IntegrationWatchdogAlert>(window.sessionStorage.getItem(ALERT_KEY));
  window.sessionStorage.removeItem(ALERT_KEY);
  return parsed;
}

export function storeIntegrationWatchdogQr(payload: IntegrationWatchdogQr): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(QR_KEY, JSON.stringify(payload));
}

export function consumeIntegrationWatchdogQr(): IntegrationWatchdogQr | null {
  if (typeof window === "undefined") return null;
  const parsed = safeParse<IntegrationWatchdogQr>(window.sessionStorage.getItem(QR_KEY));
  window.sessionStorage.removeItem(QR_KEY);
  return parsed;
}
