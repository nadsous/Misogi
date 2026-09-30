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
/** Kimi Code (connexion kimi.com) ; MISOGI_KIMI_UPSTREAM pour une autre plateforme compatible. */
const KIMI_UPSTREAM = new URL(process.env.MISOGI_KIMI_UPSTREAM || "https://api.kimi.com/coding/v1");

export type RoutedAgent = "claude" | "codex" | "kimi";

/**
 * Où relayer : Claude Code à la racine (/v1/messages), Codex sous /codex/v1 (connexion ChatGPT → chatgpt.com,
 * clé API → api.openai.com), Kimi sous /kimi/v1 (→ api.kimi.com/coding/v1).
 */
export function targetFor(url: string, headers: IncomingMessage["headers"]): { agent: RoutedAgent; host: string; path: string } {
  if (url.startsWith("/codex/")) {
    const rest = url.replace(/^\/codex(\/v1)?/, "") || "/";
    return headers["chatgpt-account-id"] ? { agent: "codex", host: "chatgpt.com", path: `/backend-api/codex${rest}` } : { agent: "codex", host: "api.openai.com", path: `/v1${rest}` };
  }
  if (url.startsWith("/kimi/")) {
    const rest = url.replace(/^\/kimi(\/v1)?/, "") || "/";
    return { agent: "kimi", host: KIMI_UPSTREAM.host, path: `${KIMI_UPSTREAM.pathname.replace(/\/$/, "")}${rest}` };
  }
  return { agent: "claude", host: UPSTREAM, path: url };
}

/** Clé de décision : la session Claude telle quelle, celles de Codex et Kimi préfixées. */
export function routeKey(agent: RoutedAgent, session: string): string {
  return agent === "claude" ? session : `${agent}-${session}`;
}
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

/** Modèle pour ce niveau et cet agent ; null si on ne sait pas (Codex sans liste de modèles encore vue). */
export function modelFor(agent: RoutedAgent, tier: Tier, config: ProjectConfig): string | null {
  if (agent === "claude") return config.router.models[tier];
  if (agent === "kimi") return config.router.kimi[tier];
  const chosen = config.router.codex[tier];
  if (chosen) return chosen;
  // Codex : d'après la liste qu'il a reçue (la plus récente d'abord) : le plus capable, et un « mini » pour les petites tâches.
  const models = codexModels();
  if (!models.length) return null;
  const top = models[0]!.slug;
  if (tier === "fast") return models.find((m) => /mini/i.test(m.slug))?.slug ?? top;
  return top;
}

/** Décision pour ce message : le niveau jugé par Jev, jamais en dessous de celui déjà atteint dans la session. */
export function decideRoute(session: string, size: string, config: ProjectConfig, agent: RoutedAgent = "claude"): RouteDecision | null {
  const wanted = tierForSize(size);
  const prev = currentRoute(session);
  const tier = prev && ORDER.indexOf(prev.tier) > ORDER.indexOf(wanted) ? prev.tier : wanted;
  const model = modelFor(agent, tier, config);
  if (!model) return null;
  mkdirSync(join(misogiHome(), "route"), { recursive: true });
  writeFileSync(routeFile(session), JSON.stringify({ tier, model, at: Date.now() }));
  return { tier, model, ...(prev ? { previous: prev.tier } : {}), escalated: !!prev && tier !== prev.tier };
}

// --- Modèles Codex : la liste que Codex reçoit au démarrage (GET …/models), gardée au passage.

export interface CodexModel {
  slug: string;
  description?: string;
}

function codexModelsFile(): string {
  return join(misogiHome(), "codex-models.json");
}

export function codexModels(): CodexModel[] {
  try {
    return JSON.parse(readFileSync(codexModelsFile(), "utf8")) as CodexModel[];
  } catch {
    return [];
  }
}

/** Réponse de GET /models (Codex) → liste des modèles proposés, dans l'ordre de Codex. */
export function rememberCodexModels(text: string): void {
  try {
    const j = JSON.parse(text) as { models?: { slug?: string; id?: string; description?: string; visibility?: string }[]; data?: { id?: string }[] };
    const list = (j.models ?? j.data ?? []).filter((m) => ("visibility" in m ? m.visibility !== "hide" : true)).map((m) => ({ slug: String((m as { slug?: string }).slug ?? m.id ?? ""), description: (m as { description?: string }).description }));
    if (!list.length) return;
    mkdirSync(misogiHome(), { recursive: true });
    writeFileSync(codexModelsFile(), JSON.stringify(list.filter((m) => m.slug)));
  } catch {
    // pas du JSON attendu : on garde l'ancienne liste
  }
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
  const max = (re: RegExp) => [...text.matchAll(re)].reduce((m, x) => Math.max(m, Number(x[1])), 0);
  // Anthropic et Responses API (Codex) : input_tokens / output_tokens ; chat/completions (Kimi) : prompt_tokens / completion_tokens.
  const input = Math.max(max(/"input_tokens"\s*:\s*(\d+)/g), max(/"prompt_tokens"\s*:\s*(\d+)/g));
  const cacheRead = max(/"cache_read_input_tokens"\s*:\s*(\d+)/g);
  const output = Math.max(max(/"output_tokens"\s*:\s*(\d+)/g), max(/"completion_tokens"\s*:\s*(\d+)/g));
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
  const target = targetFor(req.url ?? "/", req.headers);
  let rewritten: ReturnType<typeof rewriteBody> = null;
  let model = "";
  const url = req.url ?? "";
  const turn =
    req.method === "POST" &&
    (target.agent === "claude" ? url.startsWith("/v1/messages") && !url.includes("count_tokens") : target.agent === "codex" ? /\/responses(\?|$)/.test(target.path) : /\/chat\/completions(\?|$)/.test(target.path));
  if (turn) {
    rewritten = target.agent === "claude" ? rewriteBody(req.headers, original, route) : rewriteOpenAI(target.agent, req.headers, original, route);
    try {
      model = rewritten?.model ?? String((JSON.parse(original.toString("utf8")) as { model?: string }).model ?? "");
    } catch {
      model = "";
    }
  }
  if (process.env.MISOGI_ROUTER_DEBUG) debugShape(target, req, original);
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !HOP.has(k.toLowerCase())) headers[k] = v;

  const send = (body: Buffer, sentModel: string, canFallBack: boolean): void => {
    const upstream = httpsRequest({ host: target.host, port: 443, method: req.method, path: target.path, headers: { ...headers, host: target.host, ...(body.length ? { "content-length": String(body.length) } : {}) } }, (up) => {
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
      let full = "";
      up.on("data", (d: Buffer) => {
        res.write(d); // relayé tout de suite : l'agent lit le flux au fil de l'eau
        if (target.agent === "codex" && req.method === "GET" && full.length < 2_000_000) full += d.toString("utf8");
        if (!sentModel) return;
        const s = d.toString("utf8");
        if (head.length < 8000) head += s;
        tail = (tail + s).slice(-8000);
      });
      up.on("end", () => {
        res.end();
        if (target.agent === "codex" && req.method === "GET" && /\/models(\?|$)/.test(target.path) && (up.statusCode ?? 500) < 300) rememberCodexModels(full);
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

/**
 * Codex (Responses API) et Kimi (chat/completions) : la session est dans le corps (prompt_cache_key) ou, pour Codex,
 * dans un en-tête. Seul le champ `model` change ; si le modèle choisi refuse, le filet renvoie la requête d'origine.
 */
export function rewriteOpenAI(agent: "codex" | "kimi", headers: IncomingMessage["headers"], body: Buffer, route: (session: string) => { model: string } | null): { body: Buffer; model: string; from: string } | null {
  let json: { model?: unknown; prompt_cache_key?: unknown };
  try {
    json = JSON.parse(body.toString("utf8")) as { model?: unknown; prompt_cache_key?: unknown };
  } catch {
    return null;
  }
  const session = String(json.prompt_cache_key ?? headers["session-id"] ?? headers["session_id"] ?? headers["conversation_id"] ?? "");
  const decision = session ? route(routeKey(agent, session)) : null;
  if (!decision || typeof json.model !== "string" || json.model === decision.model) return null;
  const from = json.model;
  json.model = decision.model;
  return { body: Buffer.from(JSON.stringify(json)), model: decision.model, from };
}

/** MISOGI_ROUTER_DEBUG=1 : la forme des requêtes (chemins, champs), jamais leur contenu ni les jetons. */
function debugShape(target: { agent: string; host: string; path: string }, req: IncomingMessage, body: Buffer): void {
  let fields = "";
  try {
    const j = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
    fields = Object.entries(j).map(([k, v]) => (["model", "stream", "store"].includes(k) ? `${k}=${JSON.stringify(v)}` : k === "prompt_cache_key" ? "prompt_cache_key=✓" : k)).join(" ");
  } catch {
    // pas de JSON
  }
  const sessionHeaders = Object.keys(req.headers).filter((h) => /session|conversation|request-class/i.test(h));
  console.error(`[relais ${target.agent}] ${req.method} ${target.host}${target.path} · en-têtes: ${sessionHeaders.join(",") || "-"} · ${fields}`);
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
