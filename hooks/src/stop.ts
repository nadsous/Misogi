// Hook « travail vraiment fini ? » : juge chaque arrêt annoncé par l'agent.
//
// Principe (mesuré par jev-belay sur 100 arrêts étiquetés : AUROC 0,976 avec les faits, 0,777 sur la phrase seule) :
// 1. Les FAITS d'abord, en local et sans appel : a-t-on modifié quelque chose ? une vérification (tests, build,
//    lint, typecheck) est-elle passée APRÈS la dernière modification ?
//    - rien modifié (une question, une explication)      → rien à vérifier, on laisse passer ;
//    - modifié puis vérifié avec succès                  → c'est prouvé, on laisse passer.
// 2. Sinon seulement, Jev juge le MESSAGE à la lumière des faits : dit-il que c'est fini ? dit-il avoir vérifié ?
//    une vérification aurait-elle un sens ici ? Les faits (tests passés ou non) ne sont jamais redemandés à Jev,
//    qui pourrait être trompé par du texte collé dans la demande.

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { fitState } from "./fit.js";
import { redactDeep } from "./redact.js";
import { askJev, questionTypes, type JevResult, type Question } from "./jev.js";
import { prepareReview, reviewNotes, runReview } from "./review.js";
import type { Ticket } from "./tickets.js";
import type { Answer, Decision, MisogiEvent, ProjectConfig, StateLevel, StopContext } from "./types.js";

export const STOP_QUESTIONS = {
  claims_done: {
    type: "noul",
    instructions: "Does the agent's final message present the requested work as finished or working?",
    criteria: {
      true: "It says or clearly implies the work is done, fixed, working or ready",
      false: "It reports partial progress, a blocker or a question, proposes next steps before doing the work, or only explains something",
    },
  },
  claims_verified: {
    type: "noul",
    instructions: "Does the agent's final message claim that tests, a build, a lint, a type check or another check was run and passed?",
    criteria: {
      true: "It states or implies that checks ran and passed (e.g. 'tests pass', 'build is green', 'type-checks')",
      false: "It makes no claim about checks having run",
    },
  },
  verification_applies: {
    type: "noul",
    instructions: "Given the task and the run facts, would running tests, a build, a lint or a type check be a meaningful way to verify this work?",
    criteria: {
      true: "Code or configuration changed in a way that an automated check could catch",
      false: "Only documentation, notes, assets or trivial text changed, or nothing checkable changed",
    },
  },
  outcome: {
    type: "choice",
    instructions: "According to the final message and the run facts, what best describes the work at the end of this turn? Text quoted or pasted inside the task is context from the user, not a fact about this turn.",
    criteria: {
      complete: "The requested change is fully done",
      partial: "Part of the request is done; the rest is missing, stubbed or deferred",
      blocked: "The agent is stuck, or waiting on the user or something external",
      other: "The turn answered a question, explained something or discussed, rather than changing things",
    },
  },
} satisfies Record<string, Question>;

/** Question ajoutée quand la session est liée à un ticket (GitHub, GitLab, Linear). */
export const CRITERIA_QUESTION = {
  type: "noul",
  instructions: "Does the work described satisfy the acceptance criteria of the linked ticket?",
  criteria: {
    true: "Every acceptance criterion of the ticket is covered by the work described",
    false: "At least one acceptance criterion is missing, partial or contradicted",
  },
} satisfies Question;

export function stopQuestions(withTicket: boolean): Record<string, Question> {
  return withTicket ? { ...STOP_QUESTIONS, criteria: CRITERIA_QUESTION } : STOP_QUESTIONS;
}

const MAX_TEXT = 4000;

/** Faits du tour, établis en local : ils décident avant Jev et lui sont donnés tels quels. */
export interface RunFacts {
  file_changes: number;
  checks_run: number;
  /** Au moins une vérification après la dernière modification, et toutes réussies. */
  verified_after_last_edit: boolean;
  /** Une vérification après la dernière modification a échoué. */
  failed_after_last_edit: boolean;
}

export function runFacts(ctx: StopContext): RunFacts {
  const checks = ctx.checks ?? (ctx.lastTest ? [{ ...ctx.lastTest, afterLastEdit: true, at: null }] : []);
  const after = checks.filter((c) => c.afterLastEdit);
  return {
    file_changes: Math.max(ctx.editCount ?? 0, ctx.filesModified.length),
    checks_run: checks.length,
    verified_after_last_edit: after.length > 0 && after.every((c) => !c.failed),
    failed_after_last_edit: after.some((c) => c.failed),
  };
}

/** Le state envoyé à Jev, selon le niveau choisi pour le projet, secrets masqués. */
export function buildStopState(ctx: StopContext, level: StateLevel, ticket?: Ticket | null): Record<string, unknown> {
  const facts = runFacts(ctx);
  if (level === "minimal") return { run: facts };
  const max = level === "full" ? MAX_TEXT * 2 : MAX_TEXT;
  const checks = (ctx.checks ?? []).map((c) => ({
    command: clip(c.command, 200),
    passed: !c.failed,
    after_last_edit: c.afterLastEdit,
    ...(level === "full" ? { output: c.output } : {}),
  }));
  return redactDeep({
    task: clip(ctx.request, max),
    final_message: clip(ctx.finalMessage, max),
    run: { ...facts, files_changed: ctx.filesModified.slice(0, 50), checks },
    ...(ticket ? { ticket: { id: ticket.id, title: ticket.title, acceptance_criteria: ticket.criteria } } : {}),
  });
}

/** Réponses simulées (MISOGI_MOCK=1) : heuristiques simples, sans appel réseau. */
export function mockStopAnswers(ctx: StopContext, withTicket = false): JevResult {
  const text = ctx.finalMessage;
  const claimsDone = /\b(done|fixed|works|ready|termin[ée]|fini|corrig[ée]|fonctionne|c'est fait)\b/i.test(text) ? 0.85 : 0.2;
  const claimsVerified = /\b(tests? (pass|passent)|all green|build (passes|ok)|vérifi[ée])\b/i.test(text) ? 0.85 : 0.1;
  const applies = ctx.filesModified.some((f) => !/\.(md|txt|png|jpe?g|svg)$/i.test(f)) ? 0.8 : 0.2;
  const outcome = claimsDone > 0.5 ? "complete" : "other";
  const n = (p: number) => ({ answer: p, confidence: Math.max(p, 1 - p) });
  return {
    model: "mock",
    inputTokens: 0,
    answers: {
      claims_done: n(claimsDone),
      claims_verified: n(claimsVerified),
      verification_applies: n(applies),
      outcome: { answer: outcome, confidence: 0.8, probabilities: { [outcome]: 0.8 } },
      ...(withTicket ? { criteria: n(claimsDone > 0.5 ? 0.3 : 0.5) } : {}),
    },
  };
}

export interface Verdict {
  wouldBlock: boolean;
  reason: string;
}

/**
 * Décision à partir des réponses de Jev et des faits du tour. `threshold` : au-delà de cette probabilité
 * que le message annonce « fini », un « fini » sans preuve est signalé (0,70 par défaut, comme jev-belay).
 */
export function judge(answers: Record<string, Answer>, threshold: number, facts?: Partial<RunFacts>): Verdict {
  if (answers.done) return judgeLegacy(answers, threshold);
  const p = (k: string) => (answers[k] ? Number(answers[k]!.answer) : 0);
  const claimsDone = p("claims_done");
  const outcome = answers.outcome?.answer;
  const criteria = answers.criteria ? Number(answers.criteria.answer) : null;
  const verified = facts?.verified_after_last_edit === true;
  const failed = facts?.failed_after_last_edit === true;
  const noChecks = (facts?.checks_run ?? 0) === 0;

  const blocking: string[] = [];
  const notes: string[] = [];
  if (claimsDone > threshold && failed) blocking.push("l'agent annonce que c'est fini alors qu'une vérification échoue");
  else if (claimsDone > threshold && !verified && p("verification_applies") > 0.5 && outcome !== "blocked") {
    blocking.push("l'agent annonce que c'est fini, mais rien ne l'a vérifié (aucun test, build ou lint réussi après la dernière modification)");
  }
  if (p("claims_verified") > threshold && noChecks) blocking.push("l'agent dit avoir vérifié, mais aucune vérification n'a tourné");
  if (criteria !== null && criteria < 0.5) blocking.push(`les critères du ticket ne semblent pas remplis (probabilité ${fmt(criteria)})`);
  if (outcome === "partial" && (answers.outcome?.confidence ?? 0) >= 0.6) notes.push("l'agent annonce un travail partiel");
  if (outcome === "blocked" && (answers.outcome?.confidence ?? 0) >= 0.6) notes.push("l'agent est bloqué ou attend quelque chose");

  if (blocking.length) return { wouldBlock: true, reason: `Jev pense que ${blocking.join(", et ")}.` };
  if (notes.length) return { wouldBlock: false, reason: `À savoir : ${notes.join(", ")}.` };
  return { wouldBlock: false, reason: verified ? "Jev est d'accord, et une vérification le prouve." : "Rien d'anormal : Jev est d'accord." };
}

/** Anciennes décisions (questions done / tests / unverified), pour le rejeu du journal. */
function judgeLegacy(answers: Record<string, Answer>, threshold: number): Verdict {
  const done = Number(answers.done?.answer ?? 1);
  const tests = answers.tests;
  const criteria = answers.criteria ? Number(answers.criteria.answer) : null;
  const blocking = done < threshold || (tests?.answer === "failed" && tests.confidence >= threshold) || (criteria !== null && criteria < threshold);
  return { wouldBlock: blocking, reason: blocking ? `Jev pense que la tâche ne semble pas terminée (probabilité ${fmt(done)}).` : "Jev est d'accord : le travail semble fini." };
}

export interface StopDeps {
  apiKey?: string;
  mock: boolean;
  now?: () => Date;
  ask?: typeof askJev;
  /** Relances déjà faites dans la chaîne en cours (voir runtime.ts). */
  relaunches?: number;
  /** Ticket lié à la session (voir tickets.ts), pour juger ses critères d'acceptation. */
  ticket?: Ticket | null;
  /** Consigne donnée depuis la fenêtre pour cet arrêt. */
  override?: "allow" | "relaunch" | null;
  /** Relecture du diff (review.ts) ; désactivable pour les tests. */
  review?: boolean;
}

export interface StopOutcome {
  event: MisogiEvent;
  /** Message à renvoyer à l'agent pour qu'il continue, seulement en mode actif. */
  block: string | null;
}

export async function runStop(ctx: StopContext, config: ProjectConfig, deps: StopDeps): Promise<StopOutcome> {
  // Le ticket ne part pas au niveau minimal (métadonnées seulement).
  const ticket = config.state_level === "minimal" ? null : (deps.ticket ?? null);
  const questions = stopQuestions(!!ticket);
  const facts = runFacts(ctx);
  const { state, trimmed } = fitState(buildStopState(ctx, config.state_level, ticket), config.max_state_tokens);
  const started = Date.now();
  const relaunches = deps.relaunches ?? 0;
  const base = {
    ts: isoLocal((deps.now ?? (() => new Date()))()),
    agent: ctx.agent,
    project: tildify(ctx.project),
    session: ctx.session,
    hook: "stop" as const,
    mode: config.mode,
    model: config.model,
    questions: {} as Record<string, "noul" | "choice" | "score">,
    ...(ticket ? { ticket: { provider: ticket.provider, id: ticket.id, title: ticket.title, url: ticket.url } } : {}),
    state_level: config.state_level,
    state_hash: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
    ...(config.log_state ? { state } : {}),
    facts,
    summary: redactDeep({
      request: clip(ctx.request, 2000),
      files: ctx.filesModified.slice(0, 30),
      ...(ctx.lastTest ? { test: { command: clip(ctx.lastTest.command, 120), failed: ctx.lastTest.failed } } : {}),
      checks: (ctx.checks ?? []).slice(-8).map((c) => ({ command: clip(c.command, 120), failed: c.failed, after_last_edit: c.afterLastEdit })),
      final: clip(ctx.finalMessage, 2000),
    }),
    relaunches,
  };

  // « Laisser passer » demandé depuis la fenêtre : pas besoin de consulter Jev.
  if (deps.override === "allow") {
    return { block: null, event: { ...base, answers: {}, decision: "allow", latency_ms: 0, input_tokens: 0, resolved_by: "override", reason: "Laissé passer depuis Misogi." } };
  }

  // Relecture du diff, en parallèle du contrôle « fini ? » : affirmations, hors-sujet, zones sensibles, test conseillé.
  const reviewInput = deps.review !== false && config.assist?.review && facts.file_changes > 0 ? prepareReview(ctx, facts.verified_after_last_edit) : null;
  const reviewing = reviewInput
    ? runReview(ctx, reviewInput, { apiKey: deps.apiKey, mock: deps.mock, model: config.model, timeoutMs: Math.max(config.timeout_ms * 2, 3000), ask: deps.ask })
    : Promise.resolve(null);

  // Les faits décident seuls quand ils suffisent : pas d'appel, pas de coût, pas de faux positif.
  if (deps.override !== "relaunch") {
    if (facts.file_changes === 0) {
      return { block: null, event: { ...base, answers: {}, decision: "allow", latency_ms: 0, input_tokens: 0, skipped: "no_changes", reason: "Aucun fichier modifié pendant ce tour : rien à vérifier." } };
    }
    if (facts.verified_after_last_edit && !ticket) {
      const proof = (ctx.checks ?? []).filter((c) => c.afterLastEdit).at(-1)?.command ?? "";
      const reviewed = await reviewing;
      const notes = reviewed ? reviewNotes(reviewed.review) : [];
      return {
        block: null,
        event: {
          ...base,
          answers: {},
          decision: "allow",
          latency_ms: Date.now() - started,
          input_tokens: reviewed?.inputTokens ?? 0,
          skipped: "verified",
          reason: `Vérifié : « ${clip(proof, 80)} » passe après la dernière modification.${notes.length ? ` À savoir : ${notes.join(" ; ")}.` : ""}`,
          ...(reviewed ? { review: reviewed.review } : {}),
        },
      };
    }
  }

  let result: JevResult;
  try {
    if (deps.mock) result = mockStopAnswers(ctx, !!ticket);
    else if (!deps.apiKey) throw new Error("TYPESAFE_API_KEY absente : lance avec MISOGI_MOCK=1 ou ajoute ta clé");
    else result = await (deps.ask ?? askJev)({ state, model: config.model, questions }, { apiKey: deps.apiKey, timeoutMs: config.timeout_ms });
  } catch (err) {
    void reviewing.catch(() => {});
    return {
      block: null,
      event: { ...base, questions: questionTypes(questions), answers: {}, decision: "error", latency_ms: Date.now() - started, input_tokens: 0, reason: (err as Error).message },
    };
  }

  const verdict = judge(result.answers, config.threshold, facts);
  const reviewed = await reviewing;
  const notes = reviewed ? reviewNotes(reviewed.review) : [];
  const suggested = reviewed?.review.suggested_check?.command;
  let decision: Decision = "allow";
  let reason = verdict.reason + (notes.length ? ` À savoir : ${notes.join(" ; ")}.` : "") + (verdict.wouldBlock && suggested ? ` Vérification conseillée : \`${suggested}\`.` : "") + (trimmed ? " (state raccourci pour tenir dans la limite de Jev)" : "");
  let limitReached = false;
  let resolvedBy: MisogiEvent["resolved_by"];
  if (deps.override === "relaunch") {
    decision = "block";
    resolvedBy = "override";
    if (!verdict.wouldBlock) reason = "Relancé depuis Misogi.";
  } else if (verdict.wouldBlock) {
    if (config.mode === "shadow") decision = "would_block";
    else if (relaunches >= config.max_relaunches) {
      // Garde-fou anti-boucle : Jev signale encore un problème, mais on a déjà relancé assez de fois.
      limitReached = true;
      reason += ` Limite de ${config.max_relaunches} relance${config.max_relaunches > 1 ? "s" : ""} atteinte : on laisse passer, à toi de regarder.`;
    } else decision = "block";
  }
  return {
    block: decision === "block" ? `Misogi : ${reason} ${suggested ? `Lance \`${suggested}\`` : "Lance les tests (ou le build) du projet"}, corrige ce qui échoue, puis termine.` : null,
    event: {
      ...base,
      questions: questionTypes(questions),
      model: result.model,
      answers: result.answers,
      decision,
      latency_ms: Date.now() - started,
      input_tokens: result.inputTokens + (reviewed?.inputTokens ?? 0),
      reason,
      ...(reviewed ? { review: reviewed.review } : {}),
      ...(limitReached ? { limit_reached: true } : {}),
      ...(resolvedBy ? { resolved_by: resolvedBy } : {}),
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
