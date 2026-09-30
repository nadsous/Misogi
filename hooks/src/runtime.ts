// État partagé entre les hooks et la fenêtre, en fichiers sous ~/.misogi (aucun démon requis) :
// - compteur de relances par session, pour ne jamais boucler ;
// - consignes données depuis la fenêtre (« laisser passer la prochaine fois ») ;
// - décisions en attente, que tu peux trancher depuis la fenêtre pendant quelques secondes ;
// - signe de vie de la fenêtre, pour savoir si quelqu'un peut cliquer.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { misogiHome } from "./config.js";
import type { Agent, MisogiEvent } from "./types.js";

const dir = (name: string) => {
  const d = join(misogiHome(), name);
  mkdirSync(d, { recursive: true });
  return d;
};
const safe = (s: string) => s.replace(/[^\w.-]+/g, "_").slice(0, 120);
const sessionFile = (sub: string, agent: Agent, session: string) => join(dir(sub), `${agent}-${safe(session || "sans-session")}.json`);

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

// --- Relances

/** Relances déjà faites dans la chaîne en cours ; remis à zéro quand l'agent s'arrête pour de vrai. */
export function relaunchCount(agent: Agent, session: string, alreadyContinued: boolean): number {
  const file = sessionFile("relaunches", agent, session);
  if (!alreadyContinued) {
    rmSync(file, { force: true });
    return 0;
  }
  return readJson<{ count: number }>(file)?.count ?? 0;
}

export function recordRelaunch(agent: Agent, session: string, count: number): void {
  writeFileSync(sessionFile("relaunches", agent, session), JSON.stringify({ count, at: Date.now() }));
}

// --- Consignes depuis la fenêtre

export type OverrideAction = "allow" | "relaunch";

export function setOverride(agent: Agent, session: string, action: OverrideAction): void {
  writeFileSync(sessionFile("overrides", agent, session), JSON.stringify({ action, at: Date.now() }));
}

/** Lit et consomme la consigne (elle ne vaut que pour le prochain arrêt), valable 24 h. */
export function takeOverride(agent: Agent, session: string): OverrideAction | null {
  const file = sessionFile("overrides", agent, session);
  const o = readJson<{ action: OverrideAction; at: number }>(file);
  rmSync(file, { force: true });
  return o && Date.now() - o.at < 24 * 3600_000 ? o.action : null;
}

// --- Décisions en attente

export interface Pending {
  id: string;
  event: MisogiEvent;
  /** Epoch ms au-delà duquel la règle automatique s'applique. */
  deadline: number;
  /** Ce qui se passera si personne ne répond. */
  fallback: OverrideAction;
}

export function pendingDir(): string {
  return dir("pending");
}

export function addPending(p: Pending): void {
  writeFileSync(join(pendingDir(), `${p.id}.json`), JSON.stringify(p));
}

export function listPending(now = Date.now()): Pending[] {
  const out: Pending[] = [];
  for (const f of readdirSync(pendingDir())) {
    if (!f.endsWith(".json")) continue;
    const p = readJson<Pending>(join(pendingDir(), f));
    if (p && p.deadline > now) out.push(p);
  }
  return out;
}

export function answerPending(id: string, action: OverrideAction): boolean {
  if (!existsSync(join(pendingDir(), `${safe(id)}.json`))) return false;
  writeFileSync(join(pendingDir(), `${safe(id)}.answer`), action);
  return true;
}

/** Attend ta réponse jusqu'à l'échéance ; null si personne n'a tranché. */
export async function waitForAnswer(id: string, deadline: number, pollMs = 200): Promise<OverrideAction | null> {
  const answer = join(pendingDir(), `${id}.answer`);
  try {
    while (Date.now() < deadline) {
      if (existsSync(answer)) {
        const a = readFileSync(answer, "utf8").trim();
        return a === "allow" || a === "relaunch" ? a : null;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return null;
  } finally {
    rmSync(join(pendingDir(), `${id}.json`), { force: true });
    rmSync(answer, { force: true });
  }
}

// --- Jev au travail : la fenêtre affiche une pastille rose sur le projet pendant que Jev juge

export interface Busy {
  agent: Agent;
  project: string;
  hook: "stop" | "pretool";
  since: number;
}

export function markBusy(b: Omit<Busy, "since">, id: string): string {
  const file = join(dir("busy"), `${safe(id)}.json`);
  writeFileSync(file, JSON.stringify({ ...b, since: Date.now() }));
  return file;
}

export function clearBusy(file: string): void {
  rmSync(file, { force: true });
}

/** Jugements en cours (moins de 90 s : au-delà, le hook est mort sans nettoyer). */
export function listBusy(now = Date.now()): Busy[] {
  const out: Busy[] = [];
  for (const f of readdirSync(dir("busy"))) {
    const b = readJson<Busy>(join(dir("busy"), f));
    if (b && now - b.since < 90_000) out.push(b);
    else rmSync(join(dir("busy"), f), { force: true });
  }
  return out;
}

// --- Jeton pour les sessions distantes (SSH, conteneur) qui envoient leurs décisions à cette fenêtre

export function remoteToken(): string {
  const file = join(misogiHome(), "token");
  try {
    const t = readFileSync(file, "utf8").trim();
    if (t.length >= 32) return t;
  } catch {
    // pas encore de jeton
  }
  mkdirSync(misogiHome(), { recursive: true });
  const t = randomBytes(24).toString("hex");
  writeFileSync(file, t, { mode: 0o600 });
  return t;
}

// --- Signe de vie de la fenêtre

export function heartbeat(clients: number): void {
  writeFileSync(join(misogiHome(), "ui.json"), JSON.stringify({ clients, at: Date.now() }));
}

/** Quelqu'un regarde la fenêtre en ce moment, et la session n'est pas en mode sans interface. */
export function someoneCanClick(now = Date.now()): boolean {
  if (isHeadless()) return false;
  const ui = readJson<{ clients: number; at: number }>(join(misogiHome(), "ui.json"));
  return !!ui && ui.clients > 0 && now - ui.at < 10_000;
}

/** claude -p, CI, conteneur sans écran : personne pour cliquer. */
export function isHeadless(): boolean {
  const env = process.env;
  return env.MISOGI_HEADLESS === "1" || env.CI === "true" || env.CI === "1" || !!env.GITHUB_ACTIONS || !!env.GITLAB_CI || !!env.BUILDKITE || !!env.JENKINS_URL;
}
