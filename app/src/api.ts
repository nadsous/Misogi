// Contrat avec le serveur local (hooks/src/server.ts) et le format de log (hooks/src/types.ts).

import { useEffect, useRef, useState } from "react";

export type Agent = "claude" | "codex" | "kimi";
export type Decision = "allow" | "block" | "would_block" | "error";
export type StateLevel = "full" | "reduced" | "minimal";

export interface Answer {
  answer: string | number;
  confidence: number;
  probabilities?: Record<string, number>;
}

export interface MisogiEvent {
  ts: string;
  agent: Agent;
  project: string;
  session: string;
  hook: string;
  mode: "shadow" | "active";
  model: string;
  questions: Record<string, string>;
  answers: Record<string, Answer>;
  decision: Decision;
  latency_ms: number;
  input_tokens: number;
  state_level: StateLevel;
  state_hash: string;
  state?: unknown;
  reason?: string;
}

export interface SessionStatus {
  agent: Agent;
  session: string;
  project: string;
  status: "working" | "waiting" | "done";
  updatedAt: number;
}

export interface ProjectConfig {
  mode: "shadow" | "active";
  profile: "default" | "client";
  threshold: number;
  state_level: StateLevel;
  log_state: boolean;
  model: string;
  timeout_ms: number;
}

export interface Project {
  path: string;
  name: string;
  agents: Agent[];
  installed: Record<Agent, boolean>;
  config: ProjectConfig;
  key: "env" | "keychain" | "none";
}

export interface QuotaWindow {
  label: "5h" | "7d";
  usedPercent: number;
  resetsAt: number | null;
}

export interface AgentUsage {
  windows: QuotaWindow[];
  tokens5h: number;
  tokens24h: number;
  seenAt: number | null;
  plan?: string;
}

export interface Usage {
  claude: AgentUsage | null;
  codex: AgentUsage | null;
  kimi: AgentUsage | null;
  jev: { callsToday: number; tokensToday: number; tokens7d: number; costToday: number; cost7d: number; avgLatencyMs: number | null; errorsToday: number };
  statusline: boolean;
}

export interface Guide {
  agent: Agent | "all";
  kind: "instructions" | "skill" | "agent" | "command" | "hook" | "mcp";
  name: string;
  path: string;
  scope: "project" | "global";
  updatedAt: number;
  detail?: string;
}

export const AGENTS: Agent[] = ["claude", "codex", "kimi"];
export const AGENT_LABEL: Record<Agent, string> = { claude: "Claude", codex: "GPT", kimi: "Kimi" };

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: method === "POST" ? { "content-type": "application/json", "x-misogi": "1" } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

export const api = {
  usage: () => call<Usage>("GET", "/api/usage"),
  setStatusline: (on: boolean) => call("POST", "/api/usage/statusline", { on }),
  guides: (path: string) => call<Guide[]>("GET", `/api/guides?path=${encodeURIComponent(path)}`),
  meta: () => call<{ home: string; platform: string; log: string }>("GET", "/api/meta"),
  projects: () => call<Project[]>("GET", "/api/projects"),
  agents: () => call<Record<Agent, string | null>>("GET", "/api/agents"),
  saveConfig: (path: string, patch: Partial<ProjectConfig>) => call<ProjectConfig>("POST", "/api/config", { path, patch }),
  setKey: (path: string, key: string, all = false) => call<{ ok: true; count: number }>("POST", "/api/key", { path, key, all }),
  deleteKey: (path: string) => call<{ ok: true }>("POST", "/api/key/delete", { path }),
  testKey: (path: string, key?: string) => call<{ ok: boolean; ms?: number; model?: string; error?: string }>("POST", "/api/key/test", { path, key }),
  addProject: (path: string) => call<Project>("POST", "/api/projects/add", { path }),
  install: (agent: Agent, path: string) => call("POST", "/api/install", { agent, path }),
  uninstall: (agent: Agent, path: string) => call("POST", "/api/uninstall", { agent, path }),
  uninstallAll: () => call("POST", "/api/uninstall-all", {}),
  installPreview: (agent: Agent, path: string) =>
    call<{ file: string; command: string; source: string }>("GET", `/api/install/preview?agent=${agent}&path=${encodeURIComponent(path)}`),
  statePreview: (path: string) => call<{ level: StateLevel; agent?: Agent; state: unknown }>("GET", `/api/preview?path=${encodeURIComponent(path)}`),
  favicon: (path: string) => `/api/favicon?path=${encodeURIComponent(path)}`,
};

/** Flux temps réel : historique au branchement, puis chaque nouvelle décision. */
export function useStream(onDecision: (e: MisogiEvent) => void) {
  const [events, setEvents] = useState<MisogiEvent[]>([]);
  const [sessions, setSessions] = useState<SessionStatus[]>([]);
  const [online, setOnline] = useState(true);
  const cb = useRef(onDecision);
  cb.current = onDecision;

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("backlog", (m) => setEvents(JSON.parse((m as MessageEvent).data)));
    es.addEventListener("sessions", (m) => setSessions(JSON.parse((m as MessageEvent).data)));
    es.addEventListener("decision", (m) => {
      const e = JSON.parse((m as MessageEvent).data) as MisogiEvent;
      setEvents((prev) => [...prev.slice(-999), e]);
      cb.current(e);
    });
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    return () => es.close();
  }, []);

  return { events, sessions, online };
}

/** Chemins comparables : le journal écrit ~/..., les sessions des chemins absolus Windows ou POSIX. */
export function normPath(p: string, home?: string): string {
  let n = p.replace(/\\/g, "/").replace(/\/+$/, "");
  if (home && n.startsWith("~")) n = home.replace(/\\/g, "/") + n.slice(1);
  return /^[a-z]:/i.test(n) ? n.toLowerCase() : n;
}

export function baseName(p: string): string {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
}
