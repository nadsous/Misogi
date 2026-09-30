// Lecture ciblée (Claude Code, PreToolUse sur Read) : quand l'agent lit un gros fichier en entier, Misogi
// demande à Jev quelle partie répond à ce qu'il cherche, et ne lui donne que cette fenêtre (environ un
// cinquième du fichier), avec une note pour relire le reste. Tout ce qui entre dans le contexte de l'agent
// y reste pour chaque tour suivant : c'est là que se font les économies.
// Chaque garde échoue vers « ne rien faire » : lecture avec offset/limit explicite, petit ou très gros
// fichier, besoin du fichier entier, réponse incertaine → la lecture passe telle quelle.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { humanText, type Entry } from "./adapters/claude.js";
import { misogiHome } from "./config.js";
import { readJsonlTail } from "./adapters/common.js";
import { askJev, questionTypes, type JevResult, type Question } from "./jev.js";
import { redactDeep } from "./redact.js";
import { isoLocal, tildify } from "./stop.js";
import type { MisogiEvent, ProjectConfig } from "./types.js";

export const MIN_LINES = 400;
export const MAX_BYTES = 80 * 1024;
const CHUNK_LINES = 40;
const CHUNK_CHARS = 4000;
/** Au-dessus, les chunks ne tiennent plus dans une seule requête comparable : on ne resserre pas. */
const MAX_CHUNKS = 60;
/** Jev est net quand il sait (0,96 à 0,98 mesurés) ; en dessous, la fenêtre risquerait de manquer la cible. */
const PART_AT = 0.75;
/** Un deuxième endroit, éloigné, avec au moins cette part : la cible est ambiguë, on ne resserre pas. */
const RIVAL_AT = 0.2;

export interface ReadRequest {
  project: string;
  session: string;
  filePath: string;
  offset?: unknown;
  limit?: unknown;
  /** Dernière demande de l'utilisateur et dernier message de l'agent : ce qu'il cherche. */
  request: string;
  agentNote: string;
}

export interface Chunk {
  id: string;
  from: number; // première ligne, 1-based
  to: number;
  text: string;
}

/** Fichier à resserrer, découpé en chunks ; null si une garde dit « laisse passer ». */
export function readCandidate(req: ReadRequest): { lines: number; chars: number; chunks: Chunk[] } | null {
  if (req.offset !== undefined || req.limit !== undefined) return null; // lecture déjà ciblée
  let text: string;
  try {
    const size = statSync(req.filePath).size;
    if (size > MAX_BYTES) return null;
    text = readFileSync(req.filePath, "utf8");
  } catch {
    return null;
  }
  if (text.includes("\u0000")) return null; // binaire
  const lines = text.split(/\r?\n/);
  if (lines.length < MIN_LINES) return null;
  const chunks: Chunk[] = [];
  for (let i = 0; i < lines.length; i += CHUNK_LINES) {
    const part = lines.slice(i, i + CHUNK_LINES).join("\n");
    chunks.push({ id: `c${chunks.length}`, from: i + 1, to: Math.min(i + CHUNK_LINES, lines.length), text: part.length > CHUNK_CHARS ? part.slice(0, CHUNK_CHARS) + "…" : part });
  }
  if (chunks.length > MAX_CHUNKS) return null;
  return { lines: lines.length, chars: text.length, chunks };
}

export function readQuestions(chunks: Chunk[]): Record<string, Question> {
  return {
    whole: {
      type: "noul",
      instructions: "Does the coding agent need the whole file `file` for what `request` and `agent_note` describe, rather than one part of it?",
      criteria: {
        true: "It must review, refactor, summarize, translate or otherwise work on the whole file",
        false: "It is looking for one function, section, setting or behavior inside the file",
      },
    },
    part: {
      type: "choice",
      instructions: "Which chunk of `file` (listed in `chunks`, with their line ranges) contains what `request` and `agent_note` are looking for?",
      criteria: { none: "No chunk clearly contains it", ...Object.fromEntries(chunks.map((c) => [c.id, `lines ${c.from}-${c.to}`])) },
    },
  };
}

/** Fenêtre d'environ un cinquième du fichier (120 à 400 lignes), centrée sur le chunk choisi. */
export function windowFor(chunk: Chunk, total: number): { offset: number; limit: number } {
  const limit = Math.max(120, Math.min(400, Math.round(total / 5)));
  const center = Math.round((chunk.from + chunk.to) / 2);
  const start = Math.max(1, Math.min(center - Math.floor(limit / 2), total - limit + 1));
  return { offset: start, limit };
}

export interface ReadOutcome {
  event: MisogiEvent | null;
  /** Lecture à faire à la place, et note pour l'agent ; null = lecture inchangée. */
  narrowed: { offset: number; limit: number; note: string } | null;
}

export async function runRead(req: ReadRequest, config: ProjectConfig, deps: { apiKey?: string; mock: boolean; ask?: typeof askJev; now?: () => Date }): Promise<ReadOutcome> {
  // Seulement dans le projet : répondre « allow » saute aussi la demande de permission, qu'un fichier
  // hors du projet doit garder.
  const rel = relative(req.project, req.filePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return { event: null, narrowed: null };
  const candidate = readCandidate(req);
  if (!candidate || (!deps.apiKey && !deps.mock)) return { event: null, narrowed: null };
  const { lines, chars, chunks } = candidate;
  const shown = rel.replace(/\\/g, "/");
  const questions = readQuestions(chunks);
  const state = redactDeep({
    request: req.request.slice(0, 2000),
    agent_note: req.agentNote.slice(-1500),
    file: shown,
    chunks: chunks.map((c) => ({ id: c.id, lines: `${c.from}-${c.to}`, text: c.text })),
  });
  const started = Date.now();
  let result: JevResult;
  try {
    result = deps.mock
      ? { model: "mock", inputTokens: 0, answers: { whole: { answer: 0.2, confidence: 0.8 }, part: { answer: "c1", confidence: 0.7, probabilities: { c1: 0.7 } } } }
      : await (deps.ask ?? askJev)({ state, model: config.model, questions }, { apiKey: deps.apiKey!, timeoutMs: Math.max(config.timeout_ms * 2, 3000) });
  } catch {
    return { event: null, narrowed: null }; // Jev injoignable : l'agent lit le fichier entier, comme sans Misogi
  }
  const whole = Number(result.answers.whole?.answer ?? 1);
  const part = result.answers.part;
  const pPart = part?.probabilities?.[String(part.answer)] ?? part?.confidence ?? 0;
  const chunk = chunks.find((c) => c.id === part?.answer);
  const base = {
    ts: isoLocal((deps.now ?? (() => new Date()))()),
    agent: "claude" as const,
    project: tildify(req.project),
    session: req.session,
    hook: "read" as const,
    mode: config.mode,
    model: result.model,
    questions: questionTypes(questions),
    answers: result.answers,
    decision: "allow" as const,
    latency_ms: Date.now() - started,
    input_tokens: result.inputTokens,
    state_level: config.state_level,
    state_hash: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
    subject: shown,
  };
  // Deux endroits éloignés plausibles (ex. la même clé en français et en anglais) : la fenêtre en manquerait un.
  const index = (id: string) => Number(id.slice(1));
  const rival = chunk
    ? Object.entries(part?.probabilities ?? {}).some(([id, p]) => id !== "none" && id !== chunk.id && Math.abs(index(id) - index(chunk.id)) > 1 && p >= RIVAL_AT)
    : false;
  if (whole >= 0.5 || !chunk || pPart < PART_AT || rival) {
    // Laissé entier : consigné aussi, pour que tu voies pourquoi Misogi n'a rien resserré.
    const why = whole >= 0.5 ? "l'agent a besoin de tout le fichier" : rival ? "deux endroits du fichier correspondent" : "aucune partie ne ressortait clairement";
    return { narrowed: null, event: { ...base, reason: `Lecture laissée entière : ${why}.`, read: { file: shown, lines, window: null, p: pPart } } };
  }
  const w = windowFor(chunk, lines);
  const end = Math.min(lines, w.offset + w.limit - 1);
  const note = `Misogi a limité cette lecture de ${shown} aux lignes ${w.offset}–${end} sur ${lines} : la partie la plus liée à ce qui est cherché, choisie par Jev. Pour voir le reste, relis le fichier avec offset et limit.`;
  return {
    narrowed: { ...w, note },
    event: { ...base, reason: `Lecture resserrée aux lignes ${w.offset}–${end} sur ${lines} (${Math.round((w.limit / lines) * 100)} % du fichier).`, read: { file: shown, lines, window: [w.offset, end], p: pPart, saved: Math.round((chars * (1 - w.limit / lines)) / 4) } },
  };
}

/** Ce que cherche l'agent : ta dernière demande et son dernier message, lus dans le transcript. */
export function readIntent(transcript: string): { request: string; agentNote: string } {
  if (!transcript) return { request: "", agentNote: "" };
  const entries = readJsonlTail<Entry>(transcript).filter((e) => !e.isSidechain);
  let request = "";
  let agentNote = "";
  for (let i = entries.length - 1; i >= 0 && (!request || !agentNote); i--) {
    const e = entries[i]!;
    if (!request) request = humanText(e) ?? "";
    if (!agentNote && e.type === "assistant" && Array.isArray(e.message?.content)) {
      agentNote = e.message.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
    }
  }
  return { request, agentNote };
}

export function resolveFile(project: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(project, filePath);
}

// --- Kimi et Codex : leurs hooks ne peuvent pas réécrire une lecture, seulement la refuser avec une raison que
// l'agent lit. Misogi refuse donc la lecture entière en indiquant la partie utile ; si l'agent redemande quand
// même le fichier entier, la deuxième lecture passe (pas de boucle).

/** Fichier lu en entier par une commande shell simple (cat, type, Get-Content), ou null. */
export function shellReadTarget(command: string): string | null {
  const m = /^\s*(?:cat|type|Get-Content|gc)\s+(?:-(?:Raw|Encoding\s+\S+)\s+)*(["']?)([^\s"'|;&<>]+)\1\s*$/i.exec(command);
  return m ? m[2]! : null;
}

function redirectFile(agent: string, session: string): string {
  return join(misogiHome(), "read-redirects", `${agent}-${session.replace(/[^\w-]/g, "")}.json`);
}

export function wasRedirected(agent: string, session: string, file: string): boolean {
  try {
    return (JSON.parse(readFileSync(redirectFile(agent, session), "utf8")) as string[]).includes(file);
  } catch {
    return false;
  }
}

export function markRedirected(agent: string, session: string, file: string): void {
  const path = redirectFile(agent, session);
  let list: string[] = [];
  try {
    list = JSON.parse(readFileSync(path, "utf8")) as string[];
  } catch {
    // premier fichier de la session
  }
  mkdirSync(join(misogiHome(), "read-redirects"), { recursive: true });
  writeFileSync(path, JSON.stringify([...new Set([...list, file])].slice(-200)));
}

/** Ce que l'agent lit à la place du fichier : où regarder, comment relire, et comment avoir tout si besoin. */
export function redirectMessage(how: "tool" | "shell", file: string, offset: number, limit: number, lines: number): string {
  const end = Math.min(lines, offset + limit - 1);
  const reread = how === "tool" ? `Relis-le avec line_offset=${offset} et n_lines=${limit}` : `Lis seulement ces lignes, par exemple : sed -n '${offset},${end}p' ${file}`;
  return `Misogi : ${file} fait ${lines} lignes ; d'après ce que tu cherches, la partie utile est aux lignes ${offset}–${end} (choisie par Jev). ${reread}. Si tu as vraiment besoin du fichier entier, relance exactement la même lecture : elle passera.`;
}
