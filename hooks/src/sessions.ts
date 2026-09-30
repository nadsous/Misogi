// Statut des sessions en cours, lu directement dans les fichiers de session des agents,
// même sans hook Misogi : travaille, terminé, attend ton approbation.

import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseJsonl, readTail, str } from "./adapters/common.js";
import { agentHome } from "./platform.js";
import type { Agent } from "./types.js";

export type SessionState = "working" | "waiting" | "done";

export interface SessionStatus {
  agent: Agent;
  session: string;
  project: string;
  status: SessionState;
  updatedAt: number;
  /** Chemin du fichier de session, pour l'aperçu du state. */
  file: string;
}

const TAIL_BYTES = 256 * 1024;
/** Un outil sans résultat depuis plus longtemps attend sans doute une approbation. */
const WAITING_AFTER_MS = 8_000;
/** Une session muette depuis plus longtemps est considérée comme terminée. */
const IDLE_AFTER_MS = 15 * 60_000;

export function listSessions(maxAgeMs = 6 * 3600_000, now = Date.now()): SessionStatus[] {
  const out = [...claudeSessions(maxAgeMs, now), ...kimiSessions(maxAgeMs, now), ...codexSessions(maxAgeMs, now)];
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

function recentFiles(files: string[], maxAgeMs: number, now: number): { file: string; mtime: number }[] {
  const out: { file: string; mtime: number }[] = [];
  for (const file of files) {
    try {
      const mtime = statSync(file).mtimeMs;
      if (now - mtime <= maxAgeMs) out.push({ file, mtime });
    } catch {
      // fichier disparu entre-temps
    }
  }
  return out;
}

function ls(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function settle(pendingTool: boolean, finished: boolean, age: number): SessionState {
  if (finished || age > IDLE_AFTER_MS) return "done";
  if (pendingTool && age > WAITING_AFTER_MS) return "waiting";
  return "working";
}

// --- Claude : ~/.claude/projects/<dossier>/<session>.jsonl

interface ClaudeLine {
  type?: string;
  cwd?: string;
  isSidechain?: boolean;
  message?: { content?: unknown; stop_reason?: string | null };
}

export function claudeState(lines: ClaudeLine[], age: number): SessionState {
  const main = lines.filter((l) => !l.isSidechain && (l.type === "user" || l.type === "assistant"));
  const last = main.at(-1);
  if (!last) return "done";
  const content = Array.isArray(last.message?.content) ? (last.message!.content as { type?: string }[]) : [];
  const pending = last.type === "assistant" && content.some((b) => b.type === "tool_use");
  const finished = last.type === "assistant" && !pending && last.message?.stop_reason !== null;
  return settle(pending, finished, age);
}

function claudeSessions(maxAgeMs: number, now: number): SessionStatus[] {
  const root = join(agentHome("claude"), "projects");
  const files = ls(root).flatMap((d) => ls(join(root, d)).filter((f) => f.endsWith(".jsonl")).map((f) => join(root, d, f)));
  return recentFiles(files, maxAgeMs, now).map(({ file, mtime }) => {
    const lines = parseJsonl<ClaudeLine>(readTail(file, TAIL_BYTES));
    const cwd = [...lines].reverse().find((l) => l.cwd)?.cwd ?? "";
    return { agent: "claude", session: file.replace(/^.*[\\/]/, "").replace(/\.jsonl$/, ""), project: cwd, status: claudeState(lines, now - mtime), updatedAt: mtime, file };
  });
}

// --- Kimi : ~/.kimi/sessions/<md5(cwd)>/<session>/wire.jsonl, dossiers connus dans ~/.kimi/kimi.json

interface WireLine {
  message?: { type?: string; payload?: Record<string, unknown> };
}

export function kimiState(lines: WireLine[], age: number): SessionState {
  const msgs = lines.map((l) => l.message).filter((m) => m?.type);
  const turnEnd = msgs.findLastIndex((m) => m!.type === "TurnEnd");
  const turnBegin = msgs.findLastIndex((m) => m!.type === "TurnBegin");
  const finished = turnEnd > turnBegin;
  const calls = new Set<string>();
  for (const m of msgs.slice(turnBegin + 1)) {
    if (m!.type === "ToolCall") calls.add(str(m!.payload?.id));
    if (m!.type === "ToolResult") calls.delete(str(m!.payload?.tool_call_id));
  }
  return settle(calls.size > 0, finished, age);
}

function kimiProjects(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const { work_dirs } = JSON.parse(readFileSync(join(agentHome("kimi"), "kimi.json"), "utf8")) as { work_dirs?: { path: string }[] };
    for (const w of work_dirs ?? []) map.set(createHash("md5").update(w.path).digest("hex"), w.path);
  } catch {
    // pas de kimi.json
  }
  return map;
}

function kimiSessions(maxAgeMs: number, now: number): SessionStatus[] {
  const root = join(agentHome("kimi"), "sessions");
  const projects = kimiProjects();
  const files = ls(root).flatMap((h) => ls(join(root, h)).map((s) => join(root, h, s, "wire.jsonl")));
  return recentFiles(files.filter(existsSync), maxAgeMs, now).map(({ file, mtime }) => {
    const parts = file.split(/[\\/]/);
    return {
      agent: "kimi",
      session: parts.at(-2) ?? "",
      project: projects.get(parts.at(-3) ?? "") ?? "",
      status: kimiState(parseJsonl<WireLine>(readTail(file, TAIL_BYTES)), now - mtime),
      updatedAt: mtime,
      file,
    };
  });
}

// --- Codex : ~/.codex/sessions/AAAA/MM/JJ/rollout-*.jsonl

interface RolloutLine {
  type?: string;
  payload?: Record<string, unknown>;
}

export function codexState(lines: RolloutLine[], age: number): SessionState {
  const lastStart = lines.findLastIndex((l) => l.type === "event_msg" && l.payload?.type === "task_started");
  const lastDone = lines.findLastIndex((l) => l.type === "event_msg" && l.payload?.type === "task_complete");
  const calls = new Set<string>();
  for (const l of lines.slice(lastStart + 1)) {
    if (l.type !== "response_item") continue;
    const t = l.payload?.type;
    if (t === "function_call" || t === "custom_tool_call") calls.add(str(l.payload?.call_id));
    if (t === "function_call_output" || t === "custom_tool_call_output") calls.delete(str(l.payload?.call_id));
  }
  return settle(calls.size > 0, lastDone > lastStart, age);
}

function readHead(file: string, bytes: number): string {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function codexSessions(maxAgeMs: number, now: number): SessionStatus[] {
  const root = join(agentHome("codex"), "sessions");
  const days = [0, 1].map((d) => new Date(now - d * 86400_000));
  const files = days.flatMap((d) => {
    const dir = join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
    return ls(dir).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f));
  });
  return recentFiles(files, maxAgeMs, now).map(({ file, mtime }) => {
    const meta = parseJsonl<RolloutLine>(readHead(file, 64 * 1024).split("\n")[0] ?? "")[0]?.payload ?? {};
    return {
      agent: "codex",
      session: str(meta.id) || file.replace(/^.*[\\/]/, ""),
      project: str(meta.cwd),
      status: codexState(parseJsonl<RolloutLine>(readTail(file, TAIL_BYTES)), now - mtime),
      updatedAt: mtime,
      file,
    };
  });
}
