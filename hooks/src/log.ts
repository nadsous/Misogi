import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { misogiHome } from "./config.js";
import type { MisogiEvent } from "./types.js";

export const MAX_LOG_BYTES = 10 * 1024 * 1024;

export function logPath(): string {
  return join(misogiHome(), "events.jsonl");
}

/**
 * Durée de conservation : retire les décisions plus vieilles que `days` jours (0 = tout garder).
 * Réécrit le fichier d'un coup (fichier temporaire puis renommage) pour ne jamais le laisser à moitié.
 */
export function purgeOlderThan(days: number, now = Date.now()): number {
  if (days <= 0) return 0;
  const cutoff = now - days * 86400_000;
  let removed = 0;
  for (const file of [join(misogiHome(), "events.1.jsonl"), logPath()]) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
    const kept = lines.filter((l) => {
      try {
        return Date.parse((JSON.parse(l) as { ts: string }).ts) >= cutoff;
      } catch {
        return false;
      }
    });
    removed += lines.length - kept.length;
    if (kept.length === lines.length) continue;
    if (!kept.length) {
      rmSync(file, { force: true });
      continue;
    }
    const tmp = file + ".tmp";
    writeFileSync(tmp, kept.join("\n") + "\n", "utf8");
    renameSync(tmp, file);
  }
  return removed;
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
