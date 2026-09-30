// « Jev avait raison / tort » sur chaque décision, et rejeu des décisions passées avec un autre seuil.
// Les avis restent en local (~/.misogi/feedback.json) : ils servent à mesurer la fiabilité de Jev
// sur TES projets et à choisir un seuil qui corrige ses erreurs plutôt que d'en créer.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { misogiHome } from "./config.js";
import { judge } from "./stop.js";
import type { MisogiEvent } from "./types.js";

export type Verdict = "right" | "wrong";

export function eventKey(e: Pick<MisogiEvent, "ts" | "session" | "state_hash">): string {
  return `${e.ts}:${e.session}:${e.state_hash}`;
}

function file(): string {
  return join(misogiHome(), "feedback.json");
}

export function loadFeedback(): Record<string, Verdict> {
  try {
    return JSON.parse(readFileSync(file(), "utf8")) as Record<string, Verdict>;
  } catch {
    return {};
  }
}

export function setFeedback(key: string, verdict: Verdict | null): Record<string, Verdict> {
  const all = loadFeedback();
  if (verdict) all[key] = verdict;
  else delete all[key];
  mkdirSync(misogiHome(), { recursive: true });
  writeFileSync(file(), JSON.stringify(all));
  return all;
}

/** Jev a-t-il signalé un problème pour cette décision (bloqué, aurait bloqué, ou limite atteinte) ? */
export function flagged(e: MisogiEvent): boolean {
  return e.decision === "block" || e.decision === "would_block" || e.limit_reached === true;
}

export interface Reliability {
  rated: number;
  right: number;
  /** 0–1, null sans avis. */
  accuracy: number | null;
  falseAlarms: number;
  missed: number;
  /** Même mesure par aide (fin de tour, garde-fou, relecture de la demande, boucle…). */
  byHook?: Record<string, { rated: number; right: number; accuracy: number | null }>;
}

export function reliability(events: MisogiEvent[], feedback: Record<string, Verdict>): Reliability {
  const byHook: NonNullable<Reliability["byHook"]> = {};
  for (const e of events) {
    const v = feedback[eventKey(e)];
    if (!v) continue;
    const h = (byHook[e.hook] ??= { rated: 0, right: 0, accuracy: null });
    h.rated++;
    if (v === "right") h.right++;
    h.accuracy = h.right / h.rated;
  }
  return { ...reliabilityTotals(events, feedback), byHook };
}

function reliabilityTotals(events: MisogiEvent[], feedback: Record<string, Verdict>): Reliability {
  let right = 0;
  let falseAlarms = 0;
  let missed = 0;
  for (const e of events) {
    const v = feedback[eventKey(e)];
    if (v === "right") right++;
    else if (v === "wrong") flagged(e) ? falseAlarms++ : missed++;
  }
  const rated = right + falseAlarms + missed;
  return { rated, right, accuracy: rated ? right / rated : null, falseAlarms, missed };
}

export interface ReplayChange {
  ts: string;
  session: string;
  before: boolean;
  after: boolean;
  /** Ce que tu en avais dit, si tu avais donné ton avis. */
  feedback?: Verdict;
}

export interface Replay {
  threshold: number;
  total: number;
  flaggedBefore: number;
  flaggedAfter: number;
  changes: ReplayChange[];
  /** Erreurs de Jev (d'après tes avis) que ce seuil corrigerait. */
  fixed: number;
  /** Bonnes décisions (d'après tes avis) que ce seuil casserait. */
  broken: number;
}

/**
 * Rejoue les arrêts passés avec un autre seuil, sans rappeler Jev : ses réponses sont dans le journal.
 * Seules les décisions « fin de tour » avec des réponses sont rejouables.
 */
export function replay(events: MisogiEvent[], threshold: number, feedback: Record<string, Verdict>): Replay {
  const stops = events.filter((e) => e.hook === "stop" && !e.skipped && Object.keys(e.answers ?? {}).length > 0);
  const changes: ReplayChange[] = [];
  let flaggedBefore = 0;
  let flaggedAfter = 0;
  let fixed = 0;
  let broken = 0;
  for (const e of stops) {
    const before = flagged(e);
    const after = judge(e.answers, threshold, e.facts).wouldBlock;
    if (before) flaggedBefore++;
    if (after) flaggedAfter++;
    if (before === after) continue;
    const fb = feedback[eventKey(e)];
    // Avis « tort » : la décision d'avant était fausse, la changer la corrige. Avis « raison » : la changer la casse.
    if (fb === "wrong") fixed++;
    if (fb === "right") broken++;
    changes.push({ ts: e.ts, session: e.session, before, after, ...(fb ? { feedback: fb } : {}) });
  }
  return { threshold, total: stops.length, flaggedBefore, flaggedAfter, changes, fixed, broken };
}

/** Avis nécessaires avant de conseiller un seuil : en dessous, le conseil serait du bruit. */
export const MIN_RATED_FOR_SUGGESTION = 8;

export interface ThresholdSuggestion {
  /** Nombre d'arrêts rejouables sur lesquels tu as donné ton avis. */
  rated: number;
  needed: number;
  /** Seuil conseillé, ou null s'il n'y a pas assez d'avis ou si l'actuel est déjà le meilleur. */
  threshold: number | null;
  /** Erreurs corrigées moins bonnes décisions cassées, par rapport au seuil actuel. */
  gain: number;
}

/**
 * Cherche le seuil qui aurait fait le moins d'erreurs sur tes avis, en rejouant l'historique (sans rappeler Jev).
 * À gain égal, le seuil le plus proche de l'actuel l'emporte : on ne change pas pour rien.
 */
export function suggestThreshold(events: MisogiEvent[], feedback: Record<string, Verdict>, current: number): ThresholdSuggestion {
  const stops = events.filter((e) => e.hook === "stop" && !e.skipped && !e.resolved_by && Object.keys(e.answers ?? {}).length > 0);
  // Ton avis porte sur la décision prise à l'époque : « tort » veut dire qu'il fallait faire l'inverse.
  const labeled = stops.filter((e) => feedback[eventKey(e)]).map((e) => ({ e, shouldFlag: flagged(e) !== (feedback[eventKey(e)] === "wrong") }));
  const rated = labeled.length;
  if (rated < MIN_RATED_FOR_SUGGESTION) return { rated, needed: MIN_RATED_FOR_SUGGESTION, threshold: null, gain: 0 };
  const errors = (t: number) => labeled.filter(({ e, shouldFlag }) => judge(e.answers, t, e.facts).wouldBlock !== shouldFlag).length;
  const now = errors(current);
  let best = { threshold: current, errors: now };
  for (let i = 10; i <= 19; i++) {
    const t = i / 20; // 0,50 → 0,95
    const n = errors(t);
    if (n < best.errors || (n === best.errors && Math.abs(t - current) < Math.abs(best.threshold - current))) best = { threshold: t, errors: n };
  }
  const gain = now - best.errors;
  return { rated, needed: MIN_RATED_FOR_SUGGESTION, threshold: gain > 0 ? best.threshold : null, gain };
}
