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
  subject?: string;
  relaunches?: number;
  limit_reached?: boolean;
  resolved_by?: "user" | "override" | "timeout";
  origin?: string;
  ticket?: { provider: "github" | "gitlab" | "linear"; id: string; title: string; url: string };
  summary?: { request: string; files: string[]; test?: { command: string; failed: boolean }; checks?: { command: string; failed: boolean; after_last_edit: boolean }[]; final: string };
  facts?: { file_changes: number; checks_run: number; verified_after_last_edit: boolean; failed_after_last_edit: boolean };
  skipped?: "no_changes" | "verified";
}

export type Verdict = "right" | "wrong";

export interface Reliability {
  rated: number;
  right: number;
  accuracy: number | null;
  falseAlarms: number;
  missed: number;
}

export interface Replay {
  threshold: number;
  total: number;
  flaggedBefore: number;
  flaggedAfter: number;
  changes: { ts: string; session: string; before: boolean; after: boolean; feedback?: Verdict }[];
  fixed: number;
  broken: number;
}

export interface Integrations {
  github: "env" | "keychain" | "none";
  githubCli: boolean;
  gitlab: "env" | "keychain" | "none";
  linear: "env" | "keychain" | "none";
}

export type OverrideAction = "allow" | "relaunch";

/** Jev en train de juger une décision de ce projet. */
export interface Busy {
  agent: Agent;
  project: string;
  hook: "stop" | "pretool";
  since: number;
}

/** Ce qui se passe sur un projet, pour les pastilles autour de son avatar. */
export interface ProjectActivity {
  /** L'IA travaille (ou attend ton approbation). */
  working?: Agent;
  /** L'IA a terminé son travail récemment. */
  done?: Agent;
  jevBusy?: boolean;
  jevDone?: boolean;
}

export interface Pending {
  id: string;
  event: MisogiEvent;
  deadline: number;
  fallback: OverrideAction;
}

export interface GlobalSettings {
  retention_days: number;
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
  max_relaunches: number;
  ask_before_relaunch: boolean;
  ask_timeout_ms: number;
  max_state_tokens: number;
  guard: { enabled: boolean; mode: "shadow" | "active"; threshold: number };
  tickets: boolean;
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
  feedback: () => call<Record<string, Verdict>>("GET", "/api/feedback"),
  setFeedback: (key: string, verdict: Verdict | null) => call<Record<string, Verdict>>("POST", "/api/feedback", { key, verdict }),
  reliability: (path: string) => call<Reliability>("GET", `/api/reliability?path=${encodeURIComponent(path)}`),
  replay: (path: string, threshold: number) => call<Replay>("GET", `/api/replay?path=${encodeURIComponent(path)}&threshold=${threshold}`),
  removeProject: (path: string) => call("POST", "/api/projects/remove", { path }),
  integrations: () => call<Integrations>("GET", "/api/integrations"),
  setIntegration: (name: "github" | "gitlab" | "linear", token: string | null) => call("POST", "/api/integrations", { name, token }),
  answerPending: (id: string, action: OverrideAction) => call("POST", "/api/pending/answer", { id, action }),
  override: (agent: Agent, session: string, action: OverrideAction) => call("POST", "/api/override", { agent, session, action }),
  settings: () => call<GlobalSettings>("GET", "/api/settings"),
  saveSettings: (patch: Partial<GlobalSettings>) => call<GlobalSettings & { purged: number }>("POST", "/api/settings", patch),
  remote: () => call<{ token: string; port: number; listen: string; addresses: string[] }>("GET", "/api/remote"),
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
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<Busy[]>([]);
  const [sessions, setSessions] = useState<SessionStatus[]>([]);
  const [online, setOnline] = useState(true);
  const cb = useRef(onDecision);
  cb.current = onDecision;

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("backlog", (m) => setEvents(JSON.parse((m as MessageEvent).data)));
    es.addEventListener("sessions", (m) => setSessions(JSON.parse((m as MessageEvent).data)));
    es.addEventListener("pending", (m) => setPending(JSON.parse((m as MessageEvent).data)));
    es.addEventListener("busy", (m) => setBusy(JSON.parse((m as MessageEvent).data)));
    es.addEventListener("decision", (m) => {
      const e = JSON.parse((m as MessageEvent).data) as MisogiEvent;
      setEvents((prev) => [...prev.slice(-999), e]);
      cb.current(e);
    });
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    return () => es.close();
  }, []);

  return { events, sessions, online, pending, busy };
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
