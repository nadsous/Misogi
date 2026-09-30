// Quotas et consommation, lus en local :
// - Claude : pourcentages 5 h / 7 j fournis à la statusline (enregistrés par `hook.js claude statusline`),
//            tokens consommés lus dans les transcripts.
// - Codex  : rate_limits écrits par Codex dans ses sessions (événements token_count).
// - Kimi   : tokens des StatusUpdate de wire.jsonl (Kimi ne publie pas de quota).
// - Jev    : appels, tokens et coût estimé, depuis le journal Misogi.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseJsonl, readTail } from "./adapters/common.js";
import { misogiHome } from "./config.js";
import { logPath } from "./log.js";
import { agentHome } from "./platform.js";
import type { MisogiEvent } from "./types.js";

export interface Window {
  /** 0–100. */
  usedPercent: number;
  /** Epoch ms. */
  resetsAt: number | null;
  label: "5h" | "7d";
}

export interface AgentUsage {
  windows: Window[];
  /** Tokens consommés sur les 5 dernières heures et les 24 dernières heures. */
  tokens5h: number;
  tokens24h: number;
  /** Quand les pourcentages ont été vus pour la dernière fois (epoch ms). */
  seenAt: number | null;
  plan?: string;
}

export interface JevUsage {
  callsToday: number;
  tokensToday: number;
  tokens7d: number;
  /** Dollars, au tarif public de 0,042 $ par million de tokens d'entrée. */
  costToday: number;
  cost7d: number;
  avgLatencyMs: number | null;
  errorsToday: number;
}

export interface Usage {
  claude: AgentUsage | null;
  codex: AgentUsage | null;
  kimi: AgentUsage | null;
  jev: JevUsage;
}

const HOUR = 3600_000;
const JEV_USD_PER_TOKEN = 0.042 / 1_000_000;

export function claudeUsagePath(): string {
  return join(misogiHome(), "usage", "claude.json");
}

export function getUsage(now = Date.now()): Usage {
  return { claude: claudeUsage(now), codex: codexUsage(now), kimi: kimiUsage(now), jev: jevUsage(now) };
}

// --- cache par fichier : on ne relit un transcript que s'il a changé

interface Burn {
  at: number;
  tokens: number;
}
const burnCache = new Map<string, { key: string; burns: Burn[] }>();

function cachedBurns(file: string, parse: (text: string) => Burn[]): Burn[] {
  let key: string;
  try {
    const s = statSync(file);
    key = `${s.size}:${s.mtimeMs}`;
  } catch {
    return [];
  }
  const hit = burnCache.get(file);
  if (hit?.key === key) return hit.burns;
  let burns: Burn[] = [];
  try {
    burns = parse(readFileSync(file, "utf8"));
  } catch {
    // fichier illisible
  }
  burnCache.set(file, { key, burns });
  return burns;
}

function recent(files: string[], since: number): string[] {
  return files.filter((f) => {
    try {
      return statSync(f).mtimeMs >= since;
    } catch {
      return false;
    }
  });
}

function ls(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function sumSince(burns: Burn[], since: number): number {
  let n = 0;
  for (const b of burns) if (b.at >= since) n += b.tokens;
  return n;
}

// --- Claude

interface ClaudeStatus {
  rate_limits?: Record<string, { used_percentage?: number; resets_at?: number } | undefined>;
  seenAt?: number;
}

function claudeUsage(now: number): AgentUsage | null {
  const root = join(agentHome("claude"), "projects");
  if (!existsSync(root)) return null;
  const files = recent(
    ls(root).flatMap((d) => ls(join(root, d)).filter((f) => f.endsWith(".jsonl")).map((f) => join(root, d, f))),
    now - 24 * HOUR,
  );
  const burns = files.flatMap((f) =>
    cachedBurns(f, (text) =>
      parseJsonl<{ type?: string; timestamp?: string; message?: { usage?: Record<string, number> } }>(text)
        .filter((l) => l.type === "assistant" && l.message?.usage && l.timestamp)
        .map((l) => {
          const u = l.message!.usage!;
          return { at: Date.parse(l.timestamp!), tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) };
        }),
    ),
  );

  let status: ClaudeStatus = {};
  try {
    status = JSON.parse(readFileSync(claudeUsagePath(), "utf8")) as ClaudeStatus;
  } catch {
    // statusline Misogi pas encore installée
  }
  const windows: Window[] = [];
  for (const [key, label] of [["five_hour", "5h"], ["seven_day", "7d"]] as const) {
    const w = status.rate_limits?.[key];
    if (!w || typeof w.used_percentage !== "number") continue;
    const resetsAt = w.resets_at ? w.resets_at * 1000 : null;
    if (resetsAt && resetsAt < now) continue; // fenêtre expirée : le pourcentage ne vaut plus rien
    windows.push({ label, usedPercent: w.used_percentage, resetsAt });
  }
  return { windows, tokens5h: sumSince(burns, now - 5 * HOUR), tokens24h: sumSince(burns, now - 24 * HOUR), seenAt: status.seenAt ?? null };
}

// --- Codex

interface RolloutLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    info?: { last_token_usage?: { total_tokens?: number } } | null;
    rate_limits?: {
      plan_type?: string | null;
      primary?: { used_percent?: number; window_minutes?: number; resets_at?: number } | null;
      secondary?: { used_percent?: number; window_minutes?: number; resets_at?: number } | null;
    };
  };
}

function codexUsage(now: number): AgentUsage | null {
  const root = join(agentHome("codex"), "sessions");
  if (!existsSync(root)) return null;
  const days = [0, 1, 2, 3, 4, 5, 6, 7].map((d) => new Date(now - d * 24 * HOUR));
  const files = days.flatMap((d) => {
    const dir = join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
    return ls(dir).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f));
  });

  // Dernier relevé de quotas, tous fichiers confondus.
  let latest: { at: number; rl: NonNullable<NonNullable<RolloutLine["payload"]>["rate_limits"]> } | null = null;
  for (const f of recent(files, now - 7 * 24 * HOUR)) {
    const lines = parseJsonl<RolloutLine>(readTail(f, 512 * 1024));
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]!;
      if (l.payload?.type === "token_count" && l.payload.rate_limits && l.timestamp) {
        const at = Date.parse(l.timestamp);
        if (!latest || at > latest.at) latest = { at, rl: l.payload.rate_limits };
        break;
      }
    }
  }
  const burns = recent(files, now - 24 * HOUR).flatMap((f) =>
    cachedBurns(f, (text) =>
      parseJsonl<RolloutLine>(text)
        .filter((l) => l.payload?.type === "token_count" && l.payload.info?.last_token_usage && l.timestamp)
        .map((l) => ({ at: Date.parse(l.timestamp!), tokens: l.payload!.info!.last_token_usage!.total_tokens ?? 0 })),
    ),
  );

  const windows: Window[] = [];
  if (latest) {
    for (const w of [latest.rl.primary, latest.rl.secondary]) {
      if (!w || typeof w.used_percent !== "number") continue;
      const resetsAt = w.resets_at ? w.resets_at * 1000 : null;
      if (resetsAt && resetsAt < now) continue;
      windows.push({ label: (w.window_minutes ?? 300) <= 300 ? "5h" : "7d", usedPercent: w.used_percent, resetsAt });
    }
  }
  return { windows, tokens5h: sumSince(burns, now - 5 * HOUR), tokens24h: sumSince(burns, now - 24 * HOUR), seenAt: latest?.at ?? null, plan: latest?.rl.plan_type ?? undefined };
}

// --- Kimi

function kimiUsage(now: number): AgentUsage | null {
  const root = join(agentHome("kimi"), "sessions");
  if (!existsSync(root)) return null;
  const files = recent(
    ls(root).flatMap((h) => ls(join(root, h)).map((s) => join(root, h, s, "wire.jsonl"))).filter(existsSync),
    now - 24 * HOUR,
  );
  const burns = files.flatMap((f) =>
    cachedBurns(f, (text) =>
      parseJsonl<{ timestamp?: number; message?: { type?: string; payload?: { token_usage?: Record<string, number> } } }>(text)
        .filter((l) => l.message?.type === "StatusUpdate" && l.message.payload?.token_usage && l.timestamp)
        .map((l) => {
          const u = l.message!.payload!.token_usage!;
          return { at: l.timestamp! * 1000, tokens: (u.input_other ?? 0) + (u.output ?? 0) + (u.input_cache_creation ?? 0) };
        }),
    ),
  );
  return { windows: [], tokens5h: sumSince(burns, now - 5 * HOUR), tokens24h: sumSince(burns, now - 24 * HOUR), seenAt: null };
}

// --- Jev

function jevUsage(now: number): JevUsage {
  const events = existsSync(logPath()) ? parseJsonl<MisogiEvent>(readFileSync(logPath(), "utf8")) : [];
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  const today = events.filter((e) => Date.parse(e.ts) >= startOfDay);
  const week = events.filter((e) => Date.parse(e.ts) >= now - 7 * 24 * HOUR);
  const calls = today.filter((e) => e.decision !== "error" && e.model !== "mock");
  const tokensToday = today.reduce((n, e) => n + (e.input_tokens || 0), 0);
  const tokens7d = week.reduce((n, e) => n + (e.input_tokens || 0), 0);
  return {
    callsToday: calls.length,
    tokensToday,
    tokens7d,
    costToday: tokensToday * JEV_USD_PER_TOKEN,
    cost7d: tokens7d * JEV_USD_PER_TOKEN,
    avgLatencyMs: calls.length ? Math.round(calls.reduce((n, e) => n + e.latency_ms, 0) / calls.length) : null,
    errorsToday: today.filter((e) => e.decision === "error").length,
  };
}
