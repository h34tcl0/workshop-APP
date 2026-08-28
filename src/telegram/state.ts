import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const TELEGRAM_STATE_FILE = path.join(process.env.DATA_DIR || "./data", "telegram_offset.json");

export const RECENTLY_PROCESSED_MAX = 200;
const recentlyProcessedIds: number[] = [];

export function tokenFingerprint(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export function loadPersistedOffset(token: string): number {
  try {
    const raw = fs.readFileSync(TELEGRAM_STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.lastUpdateId === "number" && parsed.tokenFingerprint === tokenFingerprint(token)) {
      return parsed.lastUpdateId;
    }
    if (parsed && parsed.tokenFingerprint && parsed.tokenFingerprint !== tokenFingerprint(token)) {
      console.warn("[Telegram Polling] El token cambió respecto al offset persistido. Se descarta el offset viejo y se arranca desde 0 para evitar contaminación cruzada entre bots.");
    }
  } catch (_) {
    // No existe todavía o está corrupto: arrancamos desde 0
  }
  return 0;
}

export function persistOffset(token: string, updateId: number): void {
  try {
    const dir = path.dirname(TELEGRAM_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TELEGRAM_STATE_FILE, JSON.stringify({ lastUpdateId: updateId, tokenFingerprint: tokenFingerprint(token) }), "utf-8");
  } catch (err) {
    console.error("[Telegram Polling] No se pudo persistir el offset:", err);
  }
}

export function alreadyProcessed(updateId: number): boolean {
  if (recentlyProcessedIds.includes(updateId)) return true;
  recentlyProcessedIds.push(updateId);
  if (recentlyProcessedIds.length > RECENTLY_PROCESSED_MAX) {
    recentlyProcessedIds.shift();
  }
  return false;
}
