// Routeur de modèle (Claude Code) : Claude Code envoie ses requêtes à Misogi (ANTHROPIC_BASE_URL), qui les
// relaie à Anthropic sans rien toucher, sauf le champ `model` des tours principaux.
//   - Le choix se fait quand TU écris (hook UserPromptSubmit, prompt.ts) : Jev juge la taille du travail.
//   - Dans une session, le modèle ne fait que monter : le cache de prompt est propre à chaque modèle, et un modèle
//     plus fort qui reprend le travail à moitié fait d'un plus faible ne rattrape qu'une partie de l'écart.
//   - Seules les requêtes « main » changent : sous-agents, compaction et requêtes annexes (titres…) passent telles quelles.
//   - Ta connexion (claude.ai ou clé API) est relayée telle quelle ; les réponses en streaming sont relayées octet par octet.
// Chaque choix est consigné et visible dans la fenêtre.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import { misogiHome } from "./config.js";
import type { ProjectConfig, Tier } from "./types.js";

export const ROUTER_PORT = 4318;
export const UPSTREAM = "api.anthropic.com";
const ORDER: Tier[] = ["fast", "balanced", "frontier"];

/** Taille du travail (question de prompt.ts) → niveau de modèle. */
export function tierForSize(size: string): Tier {
  if (size === "question" || size === "trivial") return "fast";
  if (size === "large") return "frontier";
  return "balanced";
}

function routeFile(session: string): string {
  return join(misogiHome(), "route", `${session.replace(/[^\w-]/g, "")}.json`);
}

export interface RouteDecision {
  tier: Tier;
  model: string;
  previous?: Tier;
  escalated: boolean;
}

export function currentRoute(session: string): { tier: Tier; model: string } | null {
  try {
    return JSON.parse(readFileSync(routeFile(session), "utf8")) as { tier: Tier; model: string };
  } catch {
    return null;
  }
}

/** Décision pour ce message : le niveau jugé par Jev, jamais en dessous de celui déjà atteint dans la session. */
export function decideRoute(session: string, size: string, config: ProjectConfig): RouteDecision {
  const wanted = tierForSize(size);
  const prev = currentRoute(session);
  const tier = prev && ORDER.indexOf(prev.tier) > ORDER.indexOf(wanted) ? prev.tier : wanted;
  const model = config.router.models[tier];
  mkdirSync(join(misogiHome(), "route"), { recursive: true });
  writeFileSync(routeFile(session), JSON.stringify({ tier, model, at: Date.now() }));
  return { tier, model, ...(prev ? { previous: prev.tier } : {}), escalated: !!prev && tier !== prev.tier };
}

// --- Statistiques : requêtes et tokens par modèle, pour le panneau Quotas.

export interface RouteStats {
  since: number;
  models: Record<string, { requests: number; input: number; output: number }>;
  /** Requêtes refusées par le modèle choisi, renvoyées sur le modèle d'origine. */
  fallbacks?: number;
  lastFallback?: { to: string; from: string; error: string; at: number };
}

function statsFile(): string {
  return join(misogiHome(), "route-stats.json");
}

export function loadRouteStats(): RouteStats {
  try {
    return JSON.parse(readFileSync(statsFile(), "utf8")) as RouteStats;
  } catch {
    return { since: Date.now(), models: {} };
  }
}

function addStats(model: string, input: number, output: number): void {
  const s = loadRouteStats();
  const m = (s.models[model] ??= { requests: 0, input: 0, output: 0 });
  m.requests++;
  m.input += input;
  m.output += output;
  try {
    mkdirSync(misogiHome(), { recursive: true });
    writeFileSync(statsFile(), JSON.stringify(s));
  } catch {
    // statistiques perdues : sans gravité
  }
}

/** Tokens d'une réponse (streaming ou non), lus au passage sans rien modifier. */
export function usageOf(text: string): { input: number; output: number } {
  const input = [...text.matchAll(/"input_tokens"\s*:\s*(\d+)/g)].reduce((m, x) => Math.max(m, Number(x[1])), 0);
  const cacheRead = [...text.matchAll(/"cache_read_input_tokens"\s*:\s*(\d+)/g)].reduce((m, x) => Math.max(m, Number(x[1])), 0);
  const output = [...text.matchAll(/"output_tokens"\s*:\s*(\d+)/g)].reduce((m, x) => Math.max(m, Number(x[1])), 0);
  return { input: input + cacheRead, output };
}

/** Sortie maximale connue des modèles plus petits : Claude Code règle max_tokens pour le modèle d'origine. */
const MAX_OUTPUT: [RegExp, number][] = [
  [/haiku/, 64_000],
  [/sonnet/, 64_000],
];

/** Ajuste ce que le modèle cible n'accepterait pas : plafond de sortie, et budget de réflexion en dessous. */
export function fitToModel(json: Record<string, unknown>, model: string): void {
  const max = MAX_OUTPUT.find(([re]) => re.test(model))?.[1];
  if (!max) return;
  if (typeof json.max_tokens === "number" && json.max_tokens > max) json.max_tokens = max;
  const thinking = json.thinking as { type?: string; budget_tokens?: number } | undefined;
  // Haiku n'a ni la réflexion « adaptive » ni le réglage d'effort que Claude Code règle pour Opus : pour une petite
  // tâche, sans réflexion (et donc sans l'effacement de la réflexion dans context_management).
  if (/haiku/.test(model)) {
    if (thinking?.type === "adaptive") delete json.thinking;
    // L'effort est réglé pour la requête, et aussi message par message (per-turn control).
    const dropEffort = (holder: Record<string, unknown>): void => {
      const oc = holder.output_config as Record<string, unknown> | undefined;
      if (!oc || !("effort" in oc)) return;
      delete oc.effort;
      if (!Object.keys(oc).length) delete holder.output_config;
    };
    dropEffort(json);
    for (const m of Array.isArray(json.messages) ? json.messages : []) if (m && typeof m === "object") dropEffort(m as Record<string, unknown>);
    // Messages « system » au milieu de la conversation : Haiku ne les connaît pas. Même contenu, présenté comme
    // Claude Code le fait ailleurs : un rappel système dans un message de l'utilisateur.
    if (Array.isArray(json.messages)) {
      json.messages = (json.messages as { role?: string; content?: unknown }[]).map((m) => {
        if (m?.role !== "system") return m;
        const text = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? (m.content as { text?: string }[]).map((b) => b.text ?? "").join("\n") : "";
        return { role: "user", content: [{ type: "text", text: `<system-reminder>\n${text}\n</system-reminder>` }] };
      });
    }
    const cm = json.context_management as { edits?: { type?: string }[] } | undefined;
    if (cm?.edits && !json.thinking) {
      cm.edits = cm.edits.filter((e) => !String(e.type ?? "").startsWith("clear_thinking"));
      if (!cm.edits.length) delete json.context_management;
    }
    return;
  }
  const cap = typeof json.max_tokens === "number" ? json.max_tokens : max;
  if (thinking?.budget_tokens && thinking.budget_tokens >= cap) thinking.budget_tokens = Math.max(1024, cap - 4096);
}

/**
 * Nouveau corps de requête si ce tour doit changer de modèle, sinon null (relayé tel quel).
 * Seulement les tours principaux (en-tête de Claude Code), et seulement vers un modèle Claude.
 */
export function rewriteBody(headers: IncomingMessage["headers"], body: Buffer, route: (session: string) => { model: string } | null): { body: Buffer; model: string; from: string } | null {
  if (headers["x-claude-code-request-class"] !== "main") return null;
  const session = String(headers["x-claude-code-session-id"] ?? "");
  const decision = session ? route(session) : null;
  if (!decision) return null;
  let json: { model?: unknown };
  try {
    json = JSON.parse(body.toString("utf8")) as { model?: unknown };
  } catch {
    return null;
  }
  if (typeof json.model !== "string" || !json.model.startsWith("claude-") || json.model === decision.model) return null;
  const from = json.model;
  json.model = decision.model;
  fitToModel(json as Record<string, unknown>, decision.model);
  return { body: Buffer.from(JSON.stringify(json)), model: decision.model, from };
}

// accept-encoding aussi : des réponses non compressées se relaient pareil et se lisent (tokens, erreurs).
const HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "proxy-connection", "upgrade", "accept-encoding"]);

/** Le relais : tout passe vers api.anthropic.com, seul le modèle des tours principaux peut changer. */
export function startRouter(port = ROUTER_PORT, route: (session: string) => { model: string } | null = currentRoute): Promise<Server | null> {
  const server = createServer((req, res) => void relay(req, res, route));
  return new Promise((resolve) => {
    server.once("error", () => resolve(null)); // port pris (autre instance) : le routeur de celle-ci suffit
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function relay(req: IncomingMessage, res: ServerResponse, route: (session: string) => { model: string } | null): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const original: Buffer = Buffer.concat(chunks);
  let rewritten: ReturnType<typeof rewriteBody> = null;
  let model = "";
  if (req.method === "POST" && (req.url ?? "").startsWith("/v1/messages") && !(req.url ?? "").includes("count_tokens")) {
    rewritten = rewriteBody(req.headers, original, route);
    try {
      model = rewritten?.model ?? String((JSON.parse(original.toString("utf8")) as { model?: string }).model ?? "");
    } catch {
      model = "";
    }
  }
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !HOP.has(k.toLowerCase())) headers[k] = v;

  const send = (body: Buffer, sentModel: string, canFallBack: boolean): void => {
    const upstream = httpsRequest({ host: UPSTREAM, port: 443, method: req.method, path: req.url, headers: { ...headers, ...(body.length ? { "content-length": String(body.length) } : {}) } }, (up) => {
      // Filet de sécurité : Anthropic refuse la requête modifiée (option que le modèle choisi n'accepte pas…) →
      // on la renvoie telle que Claude Code l'avait écrite, sur son modèle d'origine. Le routage ne casse jamais un tour.
      if (canFallBack && up.statusCode === 400 && rewritten) {
        let error = "";
        up.on("data", (d: Buffer) => (error += d.toString("utf8")));
        up.on("end", () => {
          noteFallback(rewritten!.model, rewritten!.from, error);
          send(original, rewritten!.from, false);
        });
        return;
      }
      res.writeHead(up.statusCode ?? 502, up.headers);
      // Début (tokens d'entrée, message_start) et fin (tokens de sortie, message_delta) : de quoi compter sans tout garder.
      let head = "";
      let tail = "";
      up.on("data", (d: Buffer) => {
        res.write(d); // relayé tout de suite : Claude Code lit le flux au fil de l'eau
        if (!sentModel) return;
        const s = d.toString("utf8");
        if (head.length < 8000) head += s;
        tail = (tail + s).slice(-8000);
      });
      up.on("end", () => {
        res.end();
        if (sentModel && (up.statusCode ?? 500) < 400) {
          const u = usageOf(head + tail);
          addStats(sentModel, u.input, u.output);
        }
      });
      up.on("error", () => res.destroy());
    });
    upstream.on("error", (err) => {
      if (res.headersSent) return void res.destroy();
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: `Misogi (routeur) : Anthropic injoignable (${err.message})` } }));
    });
    upstream.end(body);
  };
  send(rewritten?.body ?? original, model, true);
}

/** Retour au modèle d'origine : compté et gardé (dernier message d'erreur) pour la fenêtre. */
function noteFallback(to: string, from: string, error: string): void {
  const s = loadRouteStats();
  s.fallbacks = (s.fallbacks ?? 0) + 1;
  s.lastFallback = { to, from, error: error.slice(0, 300), at: Date.now() };
  try {
    writeFileSync(statsFile(), JSON.stringify(s));
  } catch {
    // sans gravité
  }
}

export function routerUrl(port = ROUTER_PORT): string {
  return `http://127.0.0.1:${port}`;
}
