// Outils partagés par les adaptateurs : lecture de transcripts JSONL et résumé d'un tour.

import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import type { Agent, StopContext, TestRun } from "../types.js";
import { projectRoot } from "../platform.js";

/** Ce qu'un adaptateur retire du transcript pour le dernier tour. */
export interface Turn {
  request: string;
  filesModified: string[];
  lastTest: TestRun | null;
  lastAssistantText: string;
  /** Vérifications lancées pendant le tour (tests, build, lint, typecheck), dans l'ordre. */
  checks: Check[];
  /** Nombre de modifications vues (outils d'édition + commandes shell qui écrivent). */
  editCount: number;
  /** Début du tour (epoch ms), pour repérer les fichiers modifiés depuis via git. */
  startedAt: number | null;
}

export function emptyTurn(): Turn {
  return { request: "", filesModified: [], lastTest: null, lastAssistantText: "", checks: [], editCount: 0, startedAt: null };
}

export interface Check {
  command: string;
  failed: boolean;
  /** Lancée après la dernière modification : elle prouve (ou non) l'état final du code. */
  afterLastEdit: boolean;
  /** Fin de la vérification (epoch ms), si le transcript la donne. */
  at: number | null;
  output: string;
}

/**
 * Vérifications reconnues : tests, build, lint, typecheck. (jev-belay mesure qu'avec ces faits,
 * Jev distingue bien mieux les faux « c'est fini » : AUROC 0,976 contre 0,777 sur la phrase seule.)
 */
export const CHECK_COMMAND =
  /\b(test|tests|vitest|jest|pytest|mocha|playwright|cypress|phpunit|rspec|ctest|tsc|typecheck|type-check|lint|eslint|biome|ruff|mypy|pyright|clippy|flake8|golangci-lint)\b|\bgo (test|vet|build)\b|\bcargo (test|nextest|check|build|clippy)\b|\b(npm|pnpm|yarn|bun) (run )?(build|check)\b|\bgradle\w* (test|build|check)\b|\bmvn\w* (test|verify|package)\b|\bdotnet (test|build)\b|\bflutter (test|analyze)\b/i;

/** Commandes shell qui modifient des fichiers : les modifications faites hors des outils d'édition comptent aussi. */
export const WRITE_COMMAND =
  /\bsed\s+-i\b|\btee\b|(^|[^>2&\d])>{1,2}\s*[^&\s|]|\b(cp|mv|rm|mkdir|touch|patch|Set-Content|Add-Content|Out-File|New-Item|Copy-Item|Move-Item|Remove-Item)\b|\bpython[0-9.]*\s+\S+\.py\b|\bnode\s+\S+\.(m?js|ts)\b|\bgit\s+(apply|checkout|restore|reset|merge|rebase|cherry-pick|stash\s+pop)\b|\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove|uninstall)\b/i;

/** La sortie d'une vérification dit-elle qu'elle a échoué ? (utile quand un `| grep` masque le code de sortie) */
export function outputLooksFailed(output: string): boolean {
  if (/\b[1-9]\d* (failed|failing|errors?)\b|\bFAIL\b|\berror TS\d+|\berror\[E\d+\]|Traceback \(most recent|npm ERR!|\bERR_\w+|BUILD FAILED|FAILURE:/.test(output)) {
    return !/\b0 (failed|errors?)\b/.test(output) || /\bFAIL\b/.test(output);
  }
  return false;
}

/** Suit l'ordre des modifications et des vérifications d'un tour, pour tous les agents. */
export class TurnTracker {
  private seq = 0;
  private lastEditSeq = -1;
  private pending = new Map<string, { command: string; seq: number }>();
  private checks: (Omit<Check, "afterLastEdit"> & { seq: number })[] = [];
  edits = 0;

  edit(): void {
    this.lastEditSeq = ++this.seq;
    this.edits++;
  }

  /** Commande shell lancée : vérification (on attend son résultat) ou écriture. */
  shell(id: string, command: string): void {
    if (CHECK_COMMAND.test(command)) this.pending.set(id, { command, seq: ++this.seq });
    else if (WRITE_COMMAND.test(command)) this.edit();
  }

  result(id: string, isError: boolean, output: string, at: number | null): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    this.checks.push({ command: p.command, failed: isError || outputLooksFailed(output), output: tail(output, OUTPUT_TAIL_CHARS), at, seq: p.seq });
  }

  finish(turn: Turn): Turn {
    turn.checks = this.checks.map(({ seq, ...c }) => ({ ...c, afterLastEdit: seq > this.lastEditSeq }));
    const last = turn.checks.at(-1);
    turn.lastTest = last ? { command: last.command, failed: last.failed, output: last.output } : null;
    turn.editCount = this.edits;
    return turn;
  }
}

export function parseTime(v: unknown): number | null {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Comment répondre à l'agent pour qu'il continue au lieu de s'arrêter. */
export interface HookReply {
  stdout?: string;
  stderr?: string;
  exitCode: number;
}

export interface StopAdapter {
  agent: Agent;
  context(input: Record<string, unknown>): StopContext;
  block(reason: string): HookReply;
  /** Hook avant outil : la commande shell, ou null si l'outil n'est pas un shell. */
  tool(input: Record<string, unknown>): { project: string; session: string; command: string } | null;
  /** Refuser l'appel d'outil. */
  deny(reason: string): HookReply;
}

/** Commande shell dans tool_input, quelle que soit sa forme (chaîne ou tableau d'arguments). */
export function shellCommand(input: Record<string, unknown>, shellTools: RegExp): { project: string; session: string; command: string } | null {
  if (!shellTools.test(str(input.tool_name))) return null;
  const ti = (input.tool_input ?? {}) as Record<string, unknown>;
  const raw = ti.command ?? ti.cmd;
  const command = Array.isArray(raw) ? raw.join(" ") : str(raw);
  return command ? { project: projectRoot(str(input.cwd) || process.cwd()), session: str(input.session_id), command } : null;
}

/** Refus au format Claude Code / Codex (hookSpecificOutput.permissionDecision). */
export function denyJson(reason: string): HookReply {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }), exitCode: 0 };
}

/** Ancien nom, gardé pour compatibilité. */
export const TEST_COMMAND = /b(test|tests|vitest|jest|pytest|mocha|playwright|phpunit|rspec|ctest)b|bgo testb|bcargo (test|nextest)b/;
/** On ne lit que la fin du transcript : le tour courant y est toujours. */
export const TRANSCRIPT_TAIL_BYTES = 4 * 1024 * 1024;
export const OUTPUT_TAIL_CHARS = 1500;

export function toProjectPath(p: string, cwd: string): string {
  if (!isAbsolute(p)) return p.replace(/\\/g, "/");
  const rel = relative(cwd, p);
  return (rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : p).replace(/\\/g, "/");
}

export function tail(s: string, n: number): string {
  return s.length > n ? "…" + s.slice(-n) : s;
}

export function readTail(path: string, maxBytes: number): string {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const text = buf.toString("utf8");
    // Si on a coupé au milieu d'une ligne, on la jette.
    return len < size ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    closeSync(fd);
  }
}

/** JSONL tolérant : \r\n ou \n, lignes vides ou abîmées ignorées. */
export function parseJsonl<T = unknown>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // ligne partielle ou corrompue
    }
  }
  return out;
}

export function readJsonlTail<T>(path: string): T[] {
  try {
    return parseJsonl<T>(readTail(path, TRANSCRIPT_TAIL_BYTES));
  } catch {
    return [];
  }
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  try {
    const v = JSON.parse(str(raw));
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
