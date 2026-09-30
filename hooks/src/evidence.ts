// Faits du tour vus par git : les fichiers modifiés depuis le début du tour, même quand l'agent
// les a changés par une commande shell (sed, script Python, cp…) plutôt qu'avec ses outils d'édition.

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import type { StopContext } from "./types.js";

export interface GitChange {
  file: string;
  mtime: number;
}

/** Fichiers suivis ou nouveaux modifiés depuis `since` (les fichiers ignorés par git, comme dist/, n'en font pas partie). */
export function gitChangesSince(root: string, since: number | null | undefined): GitChange[] {
  if (!since) return [];
  let out: string;
  try {
    out = execFileSync("git", ["-C", root, "status", "--porcelain", "-uall", "-z"], { timeout: 1500, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return []; // pas un dépôt git, ou git absent
  }
  const changes: GitChange[] = [];
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    if (status.startsWith("R") || status.startsWith("C")) i++; // l'ancien nom suit
    if (file.startsWith(".misogi/")) continue;
    try {
      const mtime = statSync(join(root, file)).mtimeMs;
      if (mtime >= since - 2000) changes.push({ file, mtime });
    } catch {
      // fichier supprimé : on ne sait pas quand
    }
  }
  return changes;
}

/**
 * Complète le contexte avec git : fichiers modifiés hors des outils d'édition, et une vérification
 * lancée avant la dernière modification ne prouve plus rien.
 */
export function withGitEvidence(ctx: StopContext, changes: GitChange[]): StopContext {
  if (!changes.length) return ctx;
  const known = new Set(ctx.filesModified);
  const extra = changes.filter((c) => !known.has(c.file));
  const lastChange = Math.max(...changes.map((c) => c.mtime));
  return {
    ...ctx,
    filesModified: [...ctx.filesModified, ...extra.map((c) => c.file)],
    editCount: Math.max(ctx.editCount ?? 0, ctx.filesModified.length + extra.length),
    checks: (ctx.checks ?? []).map((c) => ({ ...c, afterLastEdit: c.afterLastEdit && (c.at === null || c.at >= lastChange - 1000) })),
  };
}
