// Aide à la compaction (Claude Code) : quand le contexte déborde, Claude résume la conversation et oublie
// souvent une consigne donnée au début (« ne touche pas à la prod », « garde l'API compatible »…).
//   1. PreCompact : Misogi relit tes messages de la session ; pour chacun, Jev dit s'il pose une consigne
//      durable (cookbook « re-ranking » : le code propose les candidats, Jev les classe) ;
//   2. SessionStart (source « compact ») : les consignes gardées, mot pour mot, sont redonnées à Claude
//      après le résumé. Sélection, jamais réécriture : ce sont tes phrases.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { humanText, type Entry } from "./adapters/claude.js";
import { parseJsonl } from "./adapters/common.js";
import { misogiHome } from "./config.js";
import { askJev, questionTypes, type JevResult, type Question } from "./jev.js";
import { redactDeep } from "./redact.js";
import { isoLocal, tildify } from "./stop.js";
import type { Agent, MisogiEvent, ProjectConfig } from "./types.js";

const MAX_CANDIDATES = 50;
const MAX_KEPT = 8;
const KEEP_AT = 0.6;
/** Au-delà, on ne lit que la fin du transcript (les plus anciens messages sont les moins probables). */
const MAX_TRANSCRIPT_BYTES = 30 * 1024 * 1024;

/** Tes messages de la session, dans l'ordre, sans les relances trop courtes (« ok », « vas-y »). */
export function userMessages(transcript: string): string[] {
  let text: string;
  try {
    const size = statSync(transcript).size;
    text = readFileSync(transcript, "utf8");
    if (size > MAX_TRANSCRIPT_BYTES) text = text.slice(-MAX_TRANSCRIPT_BYTES);
  } catch {
    return [];
  }
  // Filtre rapide avant d'analyser : seules les lignes « user » nous intéressent.
  const lines = text.split("\n").filter((l) => l.includes('"type":"user"'));
  const out: string[] = [];
  for (const e of parseJsonl<Entry>(lines.join("\n"))) {
    if (e.isSidechain) continue;
    const t = humanText(e);
    if (t && t.replace(/\s+/g, " ").trim().length >= 15) out.push(t.length > 700 ? t.slice(0, 700) + "…" : t);
  }
  return [...new Set(out)];
}

export function compactQuestions(n: number): Record<string, Question> {
  const q: Record<string, Question> = {};
  for (let i = 0; i < n; i++) {
    q[`keep_${i}`] = {
      type: "noul",
      instructions: `Does the user message \`messages[${i}]\` state a lasting instruction, constraint, preference or decision that the coding agent must still respect later in this session?`,
      criteria: {
        true: "A rule that keeps applying: what not to touch, conventions, requirements, a decision taken, how the user wants things done",
        false: "A one-off request or question, a thank-you, a status update, or something that no longer matters once done",
      },
    };
  }
  return q;
}

export function pickKept(answers: JevResult["answers"], messages: string[]): string[] {
  return messages
    .map((m, i) => ({ m, i, p: Number(answers[`keep_${i}`]?.answer ?? 0) }))
    .filter((x) => x.p >= KEEP_AT)
    .sort((a, b) => b.p - a.p)
    .slice(0, MAX_KEPT)
    .sort((a, b) => a.i - b.i) // dans l'ordre où tu les as données
    .map((x) => x.m);
}

function keptFile(agent: Agent, session: string): string {
  return join(misogiHome(), "compact", `${agent}-${session.replace(/[^\w-]/g, "")}.json`);
}

export function saveKept(agent: Agent, session: string, kept: string[]): void {
  mkdirSync(join(misogiHome(), "compact"), { recursive: true });
  writeFileSync(keptFile(agent, session), JSON.stringify({ kept, at: Date.now() }));
}

/** Texte redonné à l'agent après la compaction : des faits (ce que l'utilisateur a demandé), pas des ordres. */
export function contextAfterCompact(agent: Agent, session: string): string | null {
  try {
    const { kept } = JSON.parse(readFileSync(keptFile(agent, session), "utf8")) as { kept: string[] };
    if (!kept.length) return null;
    return `Consignes données par l'utilisateur plus tôt dans cette session, gardées mot pour mot par Misogi lors de la compaction :\n${kept.map((k, i) => `${i + 1}. « ${k.replace(/\s+/g, " ")} »`).join("\n")}`;
  } catch {
    return null;
  }
}

export function mockCompactAnswers(messages: string[]): JevResult {
  const rule = /\b(ne (touche|modifie|change) (pas|jamais)|jamais|toujours|garde|interdit|never|always|don't|do not|must|keep)\b/i;
  return {
    model: "mock",
    inputTokens: 0,
    answers: Object.fromEntries(messages.map((m, i) => [`keep_${i}`, { answer: rule.test(m) ? 0.8 : 0.2, confidence: 0.8 }])),
  };
}

export async function runCompact(
  ctx: { agent: Agent; project: string; session: string; transcript: string },
  config: ProjectConfig,
  deps: { apiKey?: string; mock: boolean; ask?: typeof askJev; now?: () => Date },
): Promise<MisogiEvent | null> {
  const messages = userMessages(ctx.transcript).slice(-MAX_CANDIDATES);
  if (!messages.length) return null;
  const questions = compactQuestions(messages.length);
  const state = redactDeep({ messages });
  const started = Date.now();
  const base = {
    ts: isoLocal((deps.now ?? (() => new Date()))()),
    agent: ctx.agent,
    project: tildify(ctx.project),
    session: ctx.session,
    hook: "compact" as const,
    mode: config.mode,
    questions: questionTypes(questions),
    state_level: config.state_level,
    state_hash: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
  };
  let result: JevResult;
  try {
    if (deps.mock) result = mockCompactAnswers(messages);
    else if (!deps.apiKey) throw new Error("clé Jev absente");
    else result = await (deps.ask ?? askJev)({ state, model: config.model, questions }, { apiKey: deps.apiKey, timeoutMs: Math.max(config.timeout_ms * 3, 5000) });
  } catch (err) {
    return { ...base, model: config.model, answers: {}, decision: "error", latency_ms: Date.now() - started, input_tokens: 0, reason: (err as Error).message };
  }
  const kept = pickKept(result.answers, messages);
  saveKept(ctx.agent, ctx.session, kept);
  return {
    ...base,
    model: result.model,
    // Les réponses brutes (50 questions) alourdiraient le journal : seul le résultat compte.
    answers: {},
    decision: "allow",
    latency_ms: Date.now() - started,
    input_tokens: result.inputTokens,
    reason: kept.length ? `${kept.length} consigne${kept.length > 1 ? "s" : ""} gardée${kept.length > 1 ? "s" : ""} pour après la compaction.` : "Aucune consigne durable repérée dans tes messages.",
    compact: { kept, candidates: messages.length },
  };
}
