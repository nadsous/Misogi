#!/usr/bin/env node
// Point d'entrée commun : `node hook.js <agent> <hook> [--tracked-only]`, ex. `node hook.js kimi stop`.
// --tracked-only : pour les hooks déclarés en global (Kimi), n'agir que dans les projets suivis.
// Fail-open : quoi qu'il arrive, on sort en 0 sans rien bloquer, sauf verdict « block » en mode actif.

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isAgent, STOP_ADAPTERS } from "./adapters/index.js";
import { isTracked, loadProjectConfig, misogiHome, mockEnabled } from "./config.js";
import { previousStatusline } from "./install.js";
import { getApiKey } from "./keys.js";
import { appendEvent } from "./log.js";
import { runStop } from "./stop.js";

/** Filet de sécurité : l'agent ne doit jamais attendre Misogi plus longtemps que ça. */
const HARD_DEADLINE_MS = 4000;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Statusline Claude Code : enregistre les quotas (rate_limits 5 h / 7 j) pour la fenêtre Misogi,
 * puis affiche la statusline d'avant si l'utilisateur en avait une, sinon une ligne courte.
 */
function statusline(raw: string): void {
  const input = JSON.parse(raw || "{}") as { rate_limits?: unknown; context_window?: { used_percentage?: number }; model?: { display_name?: string } };
  const dir = join(misogiHome(), "usage");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "claude.json"), JSON.stringify({ rate_limits: input.rate_limits, context: input.context_window?.used_percentage ?? null, model: input.model?.display_name, seenAt: Date.now() }));

  const previous = previousStatusline();
  if (previous) {
    try {
      process.stdout.write(execSync(previous, { input: raw, timeout: 2000, encoding: "utf8", windowsHide: true }));
      return;
    } catch {
      // la statusline d'origine a échoué : on affiche la nôtre
    }
  }
  const rl = (input.rate_limits ?? {}) as Record<string, { used_percentage?: number } | undefined>;
  const parts = [["5h", rl.five_hour], ["7j", rl.seven_day]].filter(([, w]) => typeof (w as { used_percentage?: number })?.used_percentage === "number").map(([l, w]) => `${l} ${Math.round((w as { used_percentage: number }).used_percentage)} %`);
  process.stdout.write(parts.length ? `misogi · ${parts.join(" · ")}` : "misogi");
}

async function main(): Promise<void> {
  const [agent, hook, ...flags] = process.argv.slice(2);
  if (agent === "claude" && hook === "statusline") return statusline(await readStdin());
  if (!isAgent(agent) || hook !== "stop") {
    process.stderr.write(`misogi: combinaison non prise en charge « ${agent} ${hook} » (disponible : claude|codex|kimi stop)\n`);
    return;
  }
  const adapter = STOP_ADAPTERS[agent];
  const input = JSON.parse((await readStdin()) || "{}") as Record<string, unknown>;
  const ctx = adapter.context(input);
  if (flags.includes("--tracked-only") && !isTracked(ctx.project)) return;

  const config = loadProjectConfig(ctx.project);
  const { key } = await getApiKey(ctx.project);
  const { event, block } = await runStop(ctx, config, { apiKey: key, mock: mockEnabled() });
  try {
    appendEvent(event);
  } catch (err) {
    process.stderr.write(`misogi: journal non écrit : ${(err as Error).message}\n`);
  }
  if (block) {
    const reply = adapter.block(block);
    if (reply.stdout) process.stdout.write(reply.stdout);
    if (reply.stderr) process.stderr.write(reply.stderr);
    process.exitCode = reply.exitCode;
  }
}

const deadline = setTimeout(() => process.exit(0), HARD_DEADLINE_MS);
deadline.unref();

main().catch((err) => {
  process.stderr.write(`misogi: ${(err as Error).message}\n`);
  process.exitCode = 0;
});
