// Hook « travail vraiment fini ? » : juge chaque arrêt annoncé par l'agent.

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { redactDeep } from "./redact.js";
import { askJev, questionTypes, type JevResult, type Question } from "./jev.js";
import type { Answer, Decision, MisogiEvent, ProjectConfig, StateLevel, StopContext } from "./types.js";

export const STOP_QUESTIONS = {
  done: {
    type: "noul",
    instructions: "Is the user's request fully completed by the work the agent describes?",
    criteria: {
      true: "Every part of the request is done and nothing is left for the user to finish",
      false: "Part of the request is missing, skipped, stubbed or left as a TODO",
    },
  },
  tests: {
    type: "choice",
    instructions: "Were tests run after the last code change, and what was the outcome?",
    criteria: {
      passed: "Tests were run after the last change and passed",
      failed: "Tests were run after the last change and at least one failed",
      not_run: "Code changed but no tests were run afterwards",
      not_needed: "No code changed, or the change needs no tests",
    },
  },
  unverified: {
    type: "noul",
    instructions: "Does the agent's final message claim results (tests pass, bug fixed, it works) that nothing in the state proves?",
    criteria: {
      true: "At least one claim is not backed by a command output or file in the state",
      false: "Every claim is backed by evidence in the state, or there is no such claim",
    },
  },
} satisfies Record<string, Question>;

const MAX_TEXT = 4000;

/** Le state envoyé à Jev, selon le niveau choisi pour le projet, secrets masqués. */
export function buildStopState(ctx: StopContext, level: StateLevel): Record<string, unknown> {
  if (level === "minimal") {
    return {
      files_modified_count: ctx.filesModified.length,
      tests_run: ctx.lastTest !== null,
      tests_failed: ctx.lastTest?.failed ?? null,
      final_message_length: ctx.finalMessage.length,
    };
  }
  const max = level === "full" ? MAX_TEXT * 2 : MAX_TEXT;
  return redactDeep({
    request: clip(ctx.request, max),
    files_modified: ctx.filesModified,
    last_test: ctx.lastTest && {
      command: ctx.lastTest.command,
      failed: ctx.lastTest.failed,
      ...(level === "full" ? { output: ctx.lastTest.output } : {}),
    },
    final_message: clip(ctx.finalMessage, max),
  });
}

/** Réponses simulées (MISOGI_MOCK=1) : heuristiques simples, sans appel réseau. */
export function mockStopAnswers(ctx: StopContext): JevResult {
  const testsAnswer = ctx.lastTest ? (ctx.lastTest.failed ? "failed" : "passed") : ctx.filesModified.length ? "not_run" : "not_needed";
  const done = ctx.lastTest?.failed ? 0.2 : ctx.finalMessage ? 0.8 : 0.4;
  const claimsTests = /\b(tests? (pass|passent)|all green|fonctionne|works)\b/i.test(ctx.finalMessage);
  const unverified = claimsTests && !ctx.lastTest ? 0.8 : 0.2;
  return {
    model: "mock",
    inputTokens: 0,
    answers: {
      done: { answer: done, confidence: Math.max(done, 1 - done) },
      tests: { answer: testsAnswer, confidence: 0.9, probabilities: { [testsAnswer]: 0.9 } },
      unverified: { answer: unverified, confidence: Math.max(unverified, 1 - unverified) },
    },
  };
}

export interface Verdict {
  wouldBlock: boolean;
  reason: string;
}

export function judge(answers: Record<string, Answer>, threshold: number): Verdict {
  const done = Number(answers.done?.answer ?? 1);
  const tests = answers.tests;
  const unverified = Number(answers.unverified?.answer ?? 0);
  const problems: string[] = [];
  if (done < threshold) problems.push(`la tâche ne semble pas terminée (probabilité ${fmt(done)})`);
  if (tests?.answer === "failed" && tests.confidence >= threshold) problems.push("des tests échouent");
  if (tests?.answer === "not_run" && tests.confidence >= threshold) problems.push("aucun test lancé après la dernière modification");
  if (unverified > 1 - threshold) problems.push(`des affirmations ne sont pas vérifiées (probabilité ${fmt(unverified)})`);
  const blocking = done < threshold || (tests?.answer === "failed" && tests.confidence >= threshold);
  return {
    wouldBlock: blocking,
    reason: problems.length ? `Jev pense que ${problems.join(", ")}.` : "Jev est d'accord : le travail semble fini.",
  };
}

export interface StopDeps {
  apiKey?: string;
  mock: boolean;
  now?: () => Date;
  ask?: typeof askJev;
}

export interface StopOutcome {
  event: MisogiEvent;
  /** Message à renvoyer à l'agent pour qu'il continue, seulement en mode actif. */
  block: string | null;
}

export async function runStop(ctx: StopContext, config: ProjectConfig, deps: StopDeps): Promise<StopOutcome> {
  const state = buildStopState(ctx, config.state_level);
  const started = Date.now();
  const base = {
    ts: isoLocal((deps.now ?? (() => new Date()))()),
    agent: ctx.agent,
    project: tildify(ctx.project),
    session: ctx.session,
    hook: "stop" as const,
    mode: config.mode,
    model: config.model,
    questions: questionTypes(STOP_QUESTIONS),
    state_level: config.state_level,
    state_hash: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
    ...(config.log_state ? { state } : {}),
  };

  let result: JevResult;
  try {
    if (deps.mock) result = mockStopAnswers(ctx);
    else if (!deps.apiKey) throw new Error("TYPESAFE_API_KEY absente : lance avec MISOGI_MOCK=1 ou ajoute ta clé");
    else result = await (deps.ask ?? askJev)({ state, model: config.model, questions: STOP_QUESTIONS }, { apiKey: deps.apiKey, timeoutMs: config.timeout_ms });
  } catch (err) {
    return {
      block: null,
      event: { ...base, answers: {}, decision: "error", latency_ms: Date.now() - started, input_tokens: 0, reason: (err as Error).message },
    };
  }

  const verdict = judge(result.answers, config.threshold);
  let decision: Decision = "allow";
  let reason = verdict.reason;
  if (verdict.wouldBlock) {
    if (config.mode === "shadow") decision = "would_block";
    else if (ctx.alreadyContinued) reason += " Déjà relancé une fois sur ce tour : on laisse passer.";
    else decision = "block";
  }
  return {
    block: decision === "block" ? `Misogi : ${reason} Vérifie et termine avant de t'arrêter.` : null,
    event: {
      ...base,
      model: result.model,
      answers: result.answers,
      decision,
      latency_ms: Date.now() - started,
      input_tokens: result.inputTokens,
      reason,
    },
  };
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function fmt(p: number): string {
  return p.toFixed(2);
}

export function tildify(p: string, home = homedir()): string {
  const path = p.replace(/\\/g, "/");
  const h = home.replace(/\\/g, "/");
  // Windows ignore la casse des chemins (C:/Users vs c:/users).
  const same = process.platform === "win32" ? path.toLowerCase().startsWith(h.toLowerCase()) : path.startsWith(h);
  return same && (path.length === h.length || path[h.length] === "/") ? "~" + path.slice(h.length) : path;
}

/** Date ISO avec le décalage local, ex. 2026-09-30T08:52:11+02:00. */
export function isoLocal(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(off / 60)}:${pad(off % 60)}`;
}
