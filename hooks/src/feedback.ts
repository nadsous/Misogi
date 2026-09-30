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
}

export function reliability(events: MisogiEvent[], feedback: Record<string, Verdict>): Reliability {
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
