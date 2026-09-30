import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { misogiHome } from "./config.js";
import type { MisogiEvent } from "./types.js";

export const MAX_LOG_BYTES = 10 * 1024 * 1024;

export function logPath(): string {
  return join(misogiHome(), "events.jsonl");
}

/** Ajoute une ligne au journal ; au-delà de MAX_LOG_BYTES, l'ancien fichier devient events.1.jsonl. */
export function appendEvent(event: MisogiEvent, maxBytes = MAX_LOG_BYTES): void {
  const file = logPath();
  mkdirSync(misogiHome(), { recursive: true });
  try {
    if (statSync(file).size >= maxBytes) renameSync(file, join(misogiHome(), "events.1.jsonl"));
  } catch {
    // pas encore de journal
  }
  appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
}
