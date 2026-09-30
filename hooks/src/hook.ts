#!/usr/bin/env node
// Point d'entrée commun : `node hook.js <agent> <hook> [--tracked-only]`.
//   <hook> = stop (travail vraiment fini ?), pretool (garde-fou shell), statusline (quotas Claude),
//            prompt (relire la demande), precompact + session (garder tes consignes à la compaction).
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
import { contextAfterCompact, runCompact } from "./compact.js";
import { previousAgentMessage, runPrompt } from "./prompt.js";
import { readIntent, resolveFile, runRead } from "./read.js";
import { decideRoute } from "./router.js";
import { projectRoot } from "./platform.js";
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

/** Contexte ajouté à la conversation de l'agent (UserPromptSubmit, SessionStart). */
function addContext(event: string, text: string): void {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
}

function common(input: Record<string, unknown>): { project: string; session: string; transcript: string } {
  return { project: projectRoot(String(input.cwd ?? process.cwd())), session: String(input.session_id ?? ""), transcript: String(input.transcript_path ?? "") };
}

/** Relire la demande avant que l'agent parte (prompt.ts). Ne bloque jamais la demande. */
async function prompt(agent: "claude" | "codex", input: Record<string, unknown>): Promise<void> {
  const { project, session, transcript } = common(input);
  if (!isTracked(project)) return;
  const config = loadProjectConfig(project);
  const text = String(input.prompt ?? "").trim();
  // Commandes (/clear, /model…) : rien à relire. Le routeur a besoin de cette relecture pour choisir le modèle.
  const routing = agent === "claude" && config.router.enabled;
  if ((!config.assist.prompt && !routing) || !text || text.startsWith("/")) return;
  const { key } = await getApiKey(project);
  const busy = markBusy({ agent, project, hook: "prompt" }, `${agent}-${session}-prompt`);
  try {
    let { event, context } = await runPrompt({ agent, project, session, prompt: text, previous: previousAgentMessage(transcript) }, config, { apiKey: key, mock: mockEnabled() });
    // Routeur : le modèle de ce tour, écrit avant que Claude Code n'envoie sa requête (le relais le lit).
    if (routing && event.prompt) {
      const route = decideRoute(session, event.prompt.size, config);
      event = { ...event, route, reason: `${event.reason ?? ""} Routé vers ${route.model}${route.escalated ? ` (monté depuis ${route.previous})` : ""}.`.trim() };
    }
    await record(event);
    if (context) addContext("UserPromptSubmit", context);
  } finally {
    clearBusy(busy);
  }
}

/** Lecture ciblée (read.ts) : la lecture d'un gros fichier est remplacée par la fenêtre utile. */
async function read(input: Record<string, unknown>): Promise<void> {
  const { project, session, transcript } = common(input);
  const tool = (input.tool_input ?? {}) as Record<string, unknown>;
  const file = typeof tool.file_path === "string" ? tool.file_path : "";
  if (!file || !isTracked(project)) return;
  const config = loadProjectConfig(project);
  if (!config.assist.read) return;
  extendDeadline(Math.max(config.timeout_ms * 2, 3000) + 1500);
  const { key } = await getApiKey(project);
  const { event, narrowed } = await runRead(
    { project, session, filePath: resolveFile(project, file), offset: tool.offset, limit: tool.limit, ...readIntent(transcript) },
    config,
    { apiKey: key, mock: mockEnabled() },
  );
  if (event) await record(event);
  if (!narrowed) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: "Misogi : lecture resserrée à la partie utile",
        updatedInput: { ...tool, offset: narrowed.offset, limit: narrowed.limit },
        additionalContext: narrowed.note,
      },
    }),
  );
}

/** Avant la compaction : choisir tes consignes à garder (compact.ts). */
async function precompact(input: Record<string, unknown>): Promise<void> {
  const { project, session, transcript } = common(input);
  if (!isTracked(project) || !transcript) return;
  const config = loadProjectConfig(project);
  if (!config.assist.compact) return;
  extendDeadline(Math.max(config.timeout_ms * 3, 5000) + 2000);
  const { key } = await getApiKey(project);
  const event = await runCompact({ agent: "claude", project, session, transcript }, config, { apiKey: key, mock: mockEnabled() });
  if (event) await record(event);
}

/** Après la compaction (SessionStart, source « compact ») : redonner ces consignes à l'agent. */
function session(input: Record<string, unknown>): void {
  if (input.source !== "compact") return;
  const { project, session: id } = common(input);
  if (!isTracked(project) || !loadProjectConfig(project).assist.compact) return;
  const context = contextAfterCompact("claude", id);
  if (context) addContext("SessionStart", context);
}

async function main(): Promise<void> {
  const [agent, hook, ...flags] = process.argv.slice(2);
  if (agent === "claude" && hook === "statusline") return statusline(await readStdin());
  const input = JSON.parse((await readStdin()) || "{}") as Record<string, unknown>;
  if ((agent === "claude" || agent === "codex") && hook === "prompt") return prompt(agent, input);
  if (agent === "claude" && hook === "precompact") return precompact(input);
  if (agent === "claude" && hook === "read") return read(input);
  if (agent === "claude" && hook === "session") return session(input);
  if (!isAgent(agent) || (hook !== "stop" && hook !== "pretool")) {
    process.stderr.write(`misogi: combinaison non prise en charge « ${agent} ${hook} » (disponible : claude|codex|kimi stop|pretool, claude|codex prompt, claude precompact|session|read)\n`);
    return;
  }
  const trackedOnly = flags.includes("--tracked-only");
  if (hook === "stop") await stop(STOP_ADAPTERS[agent], input, trackedOnly);
  else await pretool(STOP_ADAPTERS[agent], input, trackedOnly);
}

main().catch((err) => {
  process.stderr.write(`misogi: ${(err as Error).message}\n`);
  process.exitCode = 0;
});
