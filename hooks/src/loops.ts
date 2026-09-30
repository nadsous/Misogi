// Détection de l'agent qui tourne en rond, pendant le tour, côté serveur (aucun hook, aucune attente pour
// l'agent). Le code repère un signal suspect dans la session ; Jev ne tranche que dans ces cas-là :
// « l'agent répète-t-il des tentatives semblables sans rien apprendre de neuf, ou progresse-t-il ? ».

import { createHash } from "node:crypto";
import { readJsonlTail, type Turn } from "./adapters/common.js";
import { turnFromEntries } from "./adapters/claude.js";
import { turnFromRollout } from "./adapters/codex.js";
import { turnFromWire } from "./adapters/kimi.js";
import { askJev, questionTypes, type JevResult, type Question } from "./jev.js";
import { redactDeep } from "./redact.js";
import type { SessionStatus } from "./sessions.js";
import { isoLocal, tildify } from "./stop.js";
import type { MisogiEvent, ProjectConfig } from "./types.js";

/** Même vérification en échec autant de fois dans le tour : suspect. */
const SAME_FAILURES = 3;
/** Autant d'échecs de vérification dans le tour, le dernier compris : suspect aussi. */
const ANY_FAILURES = 5;
const STUCK_AT = 0.7;

export function turnOf(s: SessionStatus): Turn | null {
  try {
    if (s.agent === "claude") return turnFromEntries(readJsonlTail(s.file), s.project);
    if (s.agent === "kimi") return turnFromWire(readJsonlTail(s.file), s.project);
    return turnFromRollout(readJsonlTail(s.file), s.project);
  } catch {
    return null;
  }
}

const norm = (c: string) => c.replace(/\s+/g, " ").trim().toLowerCase();

/** Le signal suspect du tour, en français, ou null si rien ne cloche. */
export function loopSignal(turn: Turn): string | null {
  const failed = turn.checks.filter((c) => c.failed);
  if (!failed.length || !turn.checks.at(-1)?.failed) return null; // la dernière vérification passe : ça avance
  const counts = new Map<string, number>();
  for (const c of failed) counts.set(norm(c.command), (counts.get(norm(c.command)) ?? 0) + 1);
  const [command, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  if (n >= SAME_FAILURES) return `« ${command.slice(0, 80)} » a échoué ${n} fois dans ce tour`;
  if (failed.length >= ANY_FAILURES) return `${failed.length} vérifications en échec dans ce tour`;
  return null;
}

export const LOOP_QUESTION = {
  stuck: {
    type: "noul",
    instructions:
      "Looking at the task and the sequence of checks in `recent_checks` (oldest first, with the end of their output), is the coding agent going in circles, repeating similar attempts that fail the same way, rather than making progress?",
    criteria: {
      true: "The failures repeat with the same cause; the attempts do not change the outcome",
      false: "Each attempt fails differently or on something new: the agent is learning and moving forward",
    },
  },
} satisfies Record<string, Question>;

export function buildLoopState(turn: Turn): Record<string, unknown> {
  return redactDeep({
    task: turn.request.slice(0, 2000),
    edits_in_turn: turn.editCount,
    recent_checks: turn.checks.slice(-10).map((c) => ({ command: c.command.slice(0, 200), passed: !c.failed, output_end: c.output.slice(-400) })),
  });
}

/** Une alerte par tour et par signal : on ne rappelle pas Jev à chaque tick du serveur. */
const alerted = new Set<string>();

export async function checkLoop(
  s: SessionStatus,
  config: ProjectConfig,
  deps: { apiKey?: string; mock: boolean; ask?: typeof askJev; now?: () => Date },
): Promise<MisogiEvent | null> {
  if (s.status === "done") return null;
  const turn = turnOf(s);
  if (!turn) return null;
  const signal = loopSignal(turn);
  if (!signal) return null;
  const key = `${s.agent}:${s.session}:${turn.startedAt ?? turn.request.slice(0, 50)}`;
  if (alerted.has(key)) return null;
  alerted.add(key);

  const state = buildLoopState(turn);
  const started = Date.now();
  let result: JevResult;
  try {
    if (deps.mock) result = { model: "mock", inputTokens: 0, answers: { stuck: { answer: 0.8, confidence: 0.8 } } };
    else if (!deps.apiKey) return null;
    else result = await (deps.ask ?? askJev)({ state, model: config.model, questions: LOOP_QUESTION }, { apiKey: deps.apiKey, timeoutMs: Math.max(config.timeout_ms, 3000) });
  } catch {
    alerted.delete(key); // Jev injoignable : on réessaiera au prochain tick
    return null;
  }
  const stuck = Number(result.answers.stuck?.answer ?? 0);
  if (stuck < STUCK_AT) return null;
  return {
    ts: isoLocal((deps.now ?? (() => new Date()))()),
    agent: s.agent,
    project: tildify(s.project),
    session: s.session,
    hook: "loop",
    mode: config.mode,
    model: result.model,
    questions: questionTypes(LOOP_QUESTION),
    answers: result.answers,
    decision: "would_block",
    latency_ms: Date.now() - started,
    input_tokens: result.inputTokens,
    state_level: config.state_level,
    state_hash: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
    reason: `L'agent semble tourner en rond : ${signal}. Regarde où il bloque et donne-lui une piste, ou arrête-le.`,
    summary: { request: turn.request.slice(0, 2000), files: turn.filesModified.slice(0, 30), checks: turn.checks.slice(-8).map((c) => ({ command: c.command.slice(0, 120), failed: c.failed, after_last_edit: c.afterLastEdit })), final: "" },
    loop: { signal, stuck },
  };
}
