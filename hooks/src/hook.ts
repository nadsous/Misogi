#!/usr/bin/env node
// Point d'entrée commun : `node hook.js <agent> <hook> [--tracked-only]`.
//   <hook> = stop (travail vraiment fini ?), pretool (garde-fou shell), statusline (quotas Claude).
// --tracked-only : pour les hooks déclarés en global (Kimi), n'agir que dans les projets suivis.
// Fail-open : quoi qu'il arrive, on sort en 0 sans rien bloquer, sauf verdict « block » en mode actif.

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { isAgent, STOP_ADAPTERS } from "./adapters/index.js";
import type { HookReply, StopAdapter } from "./adapters/common.js";
import { isTracked, loadProjectConfig, misogiHome, mockEnabled } from "./config.js";
import { gitChangesSince, withGitEvidence } from "./evidence.js";
import { runGuard } from "./guard.js";
import { previousStatusline } from "./install.js";
import { getApiKey } from "./keys.js";
import { appendEvent } from "./log.js";
import { addPending, clearBusy, isHeadless, markBusy, recordRelaunch, relaunchCount, someoneCanClick, takeOverride, waitForAnswer } from "./runtime.js";
import { runStop } from "./stop.js";
import { ticketFor } from "./tickets.js";
import type { MisogiEvent } from "./types.js";

/** Filet de sécurité : l'agent n'attend jamais Misogi plus longtemps que ça (hors attente de ta réponse). */
const HARD_DEADLINE_MS = 4000;
let deadline = setTimeout(() => process.exit(0), HARD_DEADLINE_MS);
deadline.unref();

function extendDeadline(ms: number): void {
  clearTimeout(deadline);
  deadline = setTimeout(() => process.exit(0), ms);
  deadline.unref();
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function reply(r: HookReply): void {
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.exitCode;
}

/**
 * Écrit la décision dans le journal local, et l'envoie aussi à la fenêtre d'une autre machine
 * si MISOGI_REMOTE est défini (session SSH, conteneur de dev) : voir `misogi remote`.
 */
async function record(event: MisogiEvent): Promise<void> {
  try {
    appendEvent(event);
  } catch (err) {
    process.stderr.write(`misogi: journal non écrit : ${(err as Error).message}\n`);
  }
  const remote = process.env.MISOGI_REMOTE;
  if (!remote) return;
  try {
    await fetch(`${remote.replace(/\/+$/, "")}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.MISOGI_TOKEN ?? ""}` },
      body: JSON.stringify({ ...event, origin: event.origin ?? hostname() }),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // fenêtre distante injoignable : le journal local suffit
  }
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

async function stop(adapter: StopAdapter, input: Record<string, unknown>, trackedOnly: boolean): Promise<void> {
  const raw = adapter.context(input);
  if (trackedOnly && !isTracked(raw.project)) return;
  // Fichiers modifiés par des commandes shell (sed, scripts…) : git les voit, les outils d'édition non.
  const ctx = withGitEvidence(raw, gitChangesSince(raw.project, raw.startedAt));
  const config = loadProjectConfig(ctx.project);
  const { key } = await getApiKey(ctx.project);
  const override = takeOverride(ctx.agent, ctx.session);
  const relaunches = relaunchCount(ctx.agent, ctx.session, ctx.alreadyContinued);
  // Ticket lié (branche ou demande) : ses critères d'acceptation sont jugés avec le reste. Jamais bloquant.
  const busy = markBusy({ agent: ctx.agent, project: ctx.project, hook: "stop" }, `${ctx.agent}-${ctx.session}-stop`);
  let event: MisogiEvent;
  let block: string | null;
  try {
    const ticket = config.tickets && override !== "allow" ? await ticketFor(ctx.project, ctx.request).catch(() => null) : null;
    ({ event, block } = await runStop(ctx, config, { apiKey: key, mock: mockEnabled(), relaunches, override, ticket }));
  } finally {
    clearBusy(busy);
  }

  // Jev veut relancer : si quelqu'un regarde la fenêtre, on lui laisse quelques secondes pour trancher.
  // En mode sans interface (claude -p, CI), personne ne peut cliquer : la règle s'applique tout de suite.
  if (block && !override && config.ask_before_relaunch && someoneCanClick()) {
    const id = randomUUID();
    const until = Date.now() + config.ask_timeout_ms;
    extendDeadline(config.ask_timeout_ms + HARD_DEADLINE_MS);
    addPending({ id, event, deadline: until, fallback: "relaunch" });
    const answer = await waitForAnswer(id, until);
    if (answer === "allow") {
      event = { ...event, decision: "allow", resolved_by: "user", reason: `${event.reason ?? ""} Laissé passer depuis Misogi.`.trim() };
      block = null;
    } else {
      event = { ...event, resolved_by: answer === "relaunch" ? "user" : "timeout" };
    }
  }

  if (block) recordRelaunch(ctx.agent, ctx.session, relaunches + 1);
  if (isHeadless() && event.decision !== "allow" && event.decision !== "error") {
    process.stderr.write(`misogi: ${event.reason}\n`);
  }
  await record(event);
  if (block) reply(adapter.block(block));
}

async function pretool(adapter: StopAdapter, input: Record<string, unknown>, trackedOnly: boolean): Promise<void> {
  const tool = adapter.tool(input);
  if (!tool) return;
  if (trackedOnly && !isTracked(tool.project)) return;
  const config = loadProjectConfig(tool.project);
  if (!config.guard.enabled) return;
  const { key } = await getApiKey(tool.project);
  const busy = markBusy({ agent: adapter.agent, project: tool.project, hook: "pretool" }, `${adapter.agent}-${tool.session}-pretool`);
  const { event, deny } = await runGuard({ agent: adapter.agent, ...tool }, config, { apiKey: key, mock: mockEnabled() }).finally(() => clearBusy(busy));
  if (event) await record(event);
  if (deny) reply(adapter.deny(deny));
}

async function main(): Promise<void> {
  const [agent, hook, ...flags] = process.argv.slice(2);
  if (agent === "claude" && hook === "statusline") return statusline(await readStdin());
  if (!isAgent(agent) || (hook !== "stop" && hook !== "pretool")) {
    process.stderr.write(`misogi: combinaison non prise en charge « ${agent} ${hook} » (disponible : claude|codex|kimi stop|pretool)\n`);
    return;
  }
  const input = JSON.parse((await readStdin()) || "{}") as Record<string, unknown>;
  const trackedOnly = flags.includes("--tracked-only");
  if (hook === "stop") await stop(STOP_ADAPTERS[agent], input, trackedOnly);
  else await pretool(STOP_ADAPTERS[agent], input, trackedOnly);
}

main().catch((err) => {
  process.stderr.write(`misogi: ${(err as Error).message}\n`);
  process.exitCode = 0;
});
