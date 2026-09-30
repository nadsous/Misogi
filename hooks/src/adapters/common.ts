// Outils partagés par les adaptateurs : lecture de transcripts JSONL et résumé d'un tour.

import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import type { Agent, StopContext, TestRun } from "../types.js";

/** Ce qu'un adaptateur retire du transcript pour le dernier tour. */
export interface Turn {
  request: string;
  filesModified: string[];
  lastTest: TestRun | null;
  lastAssistantText: string;
}

export function emptyTurn(): Turn {
  return { request: "", filesModified: [], lastTest: null, lastAssistantText: "" };
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
}

export const TEST_COMMAND = /\b(test|tests|vitest|jest|pytest|mocha|playwright|phpunit|rspec|ctest)\b|\bgo test\b|\bcargo (test|nextest)\b/;
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
