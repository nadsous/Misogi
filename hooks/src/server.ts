// Serveur local : surveille le journal, pousse les décisions en Server-Sent Events et sert la fenêtre.
// N'écoute que sur 127.0.0.1. Les requêtes qui modifient quelque chose exigent l'en-tête x-misogi
// (une page tierce ne peut pas l'envoyer sans préflight CORS, que ce serveur refuse).

import { watch } from "chokidar";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { closeSync, openSync, readSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonl } from "./adapters/common.js";
import { STOP_ADAPTERS } from "./adapters/index.js";
import { listProjects, loadProjectConfig, misogiHome, samePath, saveProjectConfig } from "./config.js";
import { listGuides } from "./guides.js";
import { findProjectIcon } from "./icons.js";
import { getUsage } from "./usage.js";
import { askJev } from "./jev.js";
import { deleteApiKey, getApiKey, setApiKey } from "./keys.js";
import { HOOK_SCRIPT, install, installStatusline, isInstalled, isStatuslineInstalled, preview, uninstall, uninstallStatusline } from "./install.js";
import { logPath } from "./log.js";
import { detectAgents, wslLogFiles } from "./platform.js";
import { listSessions, type SessionStatus } from "./sessions.js";
import { buildStopState } from "./stop.js";
import type { Agent, MisogiEvent, ProjectConfig } from "./types.js";

export const DEFAULT_PORT = 4317;
const BACKLOG = 500;
const SESSIONS_EVERY_MS = 3000;

export interface ServeOptions {
  port?: number;
  staticDir?: string;
}

export function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

/** Les dernières décisions de tous les journaux (local + WSL), les plus anciennes d'abord. */
export function readBacklog(files: string[], limit = BACKLOG): MisogiEvent[] {
  const events: MisogiEvent[] = [];
  for (const f of files) {
    for (const candidate of [f.replace(/events\.jsonl$/, "events.1.jsonl"), f]) {
      if (!existsSync(candidate)) continue;
      events.push(...parseJsonl<MisogiEvent>(readFileSync(candidate, "utf8")));
    }
  }
  return events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)).slice(-limit);
}

/** Suit un fichier JSONL en append, rotation comprise. */
class Tail {
  private offset: number;
  private rest = "";
  constructor(private file: string) {
    this.offset = existsSync(file) ? statSync(file).size : 0;
  }
  read(): string[] {
    let size: number;
    try {
      size = statSync(this.file).size;
    } catch {
      return [];
    }
    if (size < this.offset) {
      this.offset = 0; // fichier tourné : on repart du début du nouveau
      this.rest = "";
    }
    if (size === this.offset) return [];
    const fd = openSync(this.file, "r");
    try {
      const buf = Buffer.alloc(size - this.offset);
      readSync(fd, buf, 0, buf.length, this.offset);
      this.offset = size;
      const text = this.rest + buf.toString("utf8");
      const lines = text.split(/\r?\n/);
      this.rest = lines.pop() ?? "";
      return lines.filter((l) => l.trim());
    } finally {
      closeSync(fd);
    }
  }
}

interface ProjectView {
  path: string;
  name: string;
  agents: Agent[];
  installed: Record<Agent, boolean>;
  config: ProjectConfig;
  key: "env" | "keychain" | "none";
}

async function projectView(path: string, agents: Agent[]): Promise<ProjectView> {
  const abs = expandHome(path);
  return {
    path: abs,
    name: abs.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || abs,
    agents,
    installed: { claude: isInstalled("claude", abs), codex: isInstalled("codex", abs), kimi: isInstalled("kimi", abs) },
    config: loadProjectConfig(abs),
    key: (await getApiKey(abs)).source,
  };
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

export function startServer(opts: ServeOptions = {}): Promise<{ port: number; close: () => void }> {
  const port = opts.port ?? DEFAULT_PORT;
  const staticDir = opts.staticDir ?? resolve(fileURLToPath(new URL("../../app/dist", import.meta.url)));
  const logs = [logPath(), ...wslLogFiles()];
  const tails = new Map(logs.map((f) => [f, new Tail(f)]));
  const clients = new Set<ServerResponse>();
  let sessions: SessionStatus[] = safeSessions();

  const broadcast = (event: string, data: unknown) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(msg);
  };

  mkdirSync(misogiHome(), { recursive: true });
  const watcher = watch(misogiHome(), { ignoreInitial: true, depth: 0 });
  const onLog = () => {
    for (const t of tails.values()) {
      for (const line of t.read()) {
        try {
          broadcast("decision", JSON.parse(line));
        } catch {
          // ligne abîmée
        }
      }
    }
  };
  watcher.on("add", onLog).on("change", onLog);
  // Les journaux WSL passent par un partage réseau où les notifications sont peu fiables : on les sonde.
  const poll = setInterval(() => {
    if (logs.length > 1) onLog();
    const next = safeSessions();
    if (JSON.stringify(next.map(sessionKey)) !== JSON.stringify(sessions.map(sessionKey))) {
      sessions = next;
      broadcast("sessions", sessions);
    }
  }, SESSIONS_EVERY_MS);

  const server = createServer(async (req, res) => {
    try {
      if (!isLocalHost(req)) return send(res, 403, { error: "hôte refusé" });
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        if (req.method !== "GET" && req.headers["x-misogi"] !== "1") return send(res, 403, { error: "en-tête x-misogi manquant" });
        return await api(req, res, url);
      }
      return serveStatic(res, staticDir, url.pathname);
    } catch (err) {
      send(res, 500, { error: (err as Error).message });
    }
  });

  /** Projets connus : registre des installations, journal et sessions récentes. */
  function knownProjects(): Map<string, Agent[]> {
    const known = new Map<string, Agent[]>();
    for (const p of listProjects()) known.set(p.path, p.agents);
    for (const e of readBacklog(logs)) addPath(known, expandHome(e.project), e.agent);
    for (const s of sessions) if (s.project) addPath(known, s.project, s.agent);
    return known;
  }

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const route = `${req.method} ${url.pathname}`;
    const q = (k: string) => url.searchParams.get(k) ?? "";
    switch (route) {
      case "GET /api/stream": {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`event: backlog\ndata: ${JSON.stringify(readBacklog(logs))}\n\n`);
        res.write(`event: sessions\ndata: ${JSON.stringify(sessions)}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
        req.on("close", () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }
      case "GET /api/events":
        return send(res, 200, readBacklog(logs, Number(q("limit")) || BACKLOG));
      case "GET /api/sessions":
        return send(res, 200, sessions);
      case "GET /api/projects":
        return send(res, 200, await Promise.all([...knownProjects()].map(([p, a]) => projectView(p, a))));
      case "POST /api/projects/add": {
        const { path } = await body<{ path: string }>(req);
        const dir = resolve(expandHome(path.trim()));
        if (!existsSync(dir) || !statSync(dir).isDirectory()) return send(res, 400, { error: `dossier introuvable : ${dir}` });
        const found = detectAgents();
        const agents = (Object.keys(found) as Agent[]).filter((a) => found[a]);
        for (const a of agents) install(a, dir);
        if (!agents.length) saveProjectConfig(dir, {});
        return send(res, 200, await projectView(dir, agents));
      }
      case "GET /api/usage":
        return send(res, 200, { ...getUsage(), statusline: isStatuslineInstalled() });
      case "POST /api/usage/statusline": {
        const { on } = await body<{ on: boolean }>(req);
        return send(res, 200, on ? installStatusline() : uninstallStatusline());
      }
      case "GET /api/guides":
        return send(res, 200, listGuides(q("path")));
      case "GET /api/meta":
        return send(res, 200, { home: homedir(), platform: process.platform, log: logPath() });
      case "GET /api/agents":
        return send(res, 200, detectAgents());
      case "GET /api/favicon": {
        const file = findProjectIcon(q("path"));
        if (file) return sendFile(res, file);
        res.writeHead(404).end();
        return;
      }
      case "GET /api/preview": {
        // Aperçu du state qui serait envoyé à Jev, construit sur la dernière session du projet.
        const dir = q("path");
        const config = loadProjectConfig(dir);
        const s = sessions.find((x) => samePath(x.project, dir));
        if (!s) return send(res, 200, { level: config.state_level, state: null });
        const ctx = STOP_ADAPTERS[s.agent].context({ cwd: s.project, session_id: s.session, transcript_path: s.file });
        return send(res, 200, { level: config.state_level, agent: s.agent, state: buildStopState(ctx, config.state_level) });
      }
      case "GET /api/install/preview": {
        const agent = q("agent") as Agent;
        return send(res, 200, { ...preview(agent, q("path")), script: HOOK_SCRIPT, source: readFileSync(fileURLToPath(new URL("./hook.js", import.meta.url)), "utf8") });
      }
      case "POST /api/install": {
        const { agent, path } = await body<{ agent: Agent; path: string }>(req);
        return send(res, 200, install(agent, path));
      }
      case "POST /api/uninstall": {
        const { agent, path } = await body<{ agent: Agent; path: string }>(req);
        return send(res, 200, uninstall(agent, path));
      }
      case "POST /api/uninstall-all": {
        const done = [];
        for (const p of listProjects()) for (const a of p.agents) done.push(uninstall(a, p.path));
        return send(res, 200, done);
      }
      case "POST /api/config": {
        const { path, patch } = await body<{ path: string; patch: Partial<ProjectConfig> }>(req);
        return send(res, 200, saveProjectConfig(path, patch));
      }
      case "POST /api/key": {
        // all : même clé pour tous les projets suivis (chaque projet garde sa propre entrée dans le trousseau).
        const { path, key, all } = await body<{ path: string; key: string; all?: boolean }>(req);
        const targets = all ? [...new Set([path, ...listProjects().map((p) => p.path)])] : [path];
        for (const t of targets) await setApiKey(t, key.trim());
        return send(res, 200, { ok: true, count: targets.length });
      }
      case "POST /api/key/delete": {
        const { path } = await body<{ path: string }>(req);
        await deleteApiKey(path);
        return send(res, 200, { ok: true });
      }
      case "POST /api/key/test": {
        // Vérifie la clé (celle fournie, sinon celle du projet) avec une question minuscule.
        const { path, key } = await body<{ path: string; key?: string }>(req);
        const apiKey = key?.trim() || (await getApiKey(path)).key;
        if (!apiKey) return send(res, 200, { ok: false, error: "aucune clé pour ce projet" });
        const started = Date.now();
        try {
          const r = await askJev({ state: "ping", model: loadProjectConfig(path).model, questions: { ok: { type: "noul", instructions: "Is this a ping?" } } }, { apiKey, timeoutMs: 8000 });
          return send(res, 200, { ok: true, ms: Date.now() - started, model: r.model });
        } catch (err) {
          return send(res, 200, { ok: false, error: (err as Error).message });
        }
      }
      default:
        return send(res, 404, { error: "route inconnue" });
    }
  }

  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const actual = (server.address() as { port: number }).port;
      resolveStart({
        port: actual,
        close: () => {
          clearInterval(poll);
          void watcher.close();
          for (const c of clients) c.end();
          server.close();
        },
      });
    });
  });
}

function addPath(map: Map<string, Agent[]>, path: string, agent: Agent): void {
  const key = [...map.keys()].find((k) => samePath(k, path)) ?? path;
  map.set(key, [...new Set([...(map.get(key) ?? []), agent])]);
}

function sessionKey(s: SessionStatus): string {
  return `${s.agent}:${s.session}:${s.status}`;
}

function safeSessions(): SessionStatus[] {
  try {
    return listSessions();
  } catch {
    return [];
  }
}

function isLocalHost(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendFile(res: ServerResponse, file: string): void {
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}

function serveStatic(res: ServerResponse, dir: string, pathname: string): void {
  const file = resolve(dir, "." + decodeURIComponent(pathname));
  if (!file.startsWith(resolve(dir))) return send(res, 403, { error: "chemin refusé" });
  if (existsSync(file) && statSync(file).isFile()) return sendFile(res, file);
  const index = join(dir, "index.html");
  if (existsSync(index)) return sendFile(res, index);
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Misogi tourne. L'interface n'est pas construite : lance `npm run build -w app`.");
}

async function body<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}
