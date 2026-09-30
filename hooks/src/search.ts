// Recherche par le sens, pour l'agent comme pour toi, sans rien faire entrer dans son contexte :
//   misogi find "où est le flow d'inscription"         → les fichiers et la ligne qui correspondent
//   misogi ask  "construit-il du SQL par concaténation ?" api/ → les fichiers pour lesquels c'est oui
// Le code liste les fichiers (git ls-files) et prépare des extraits ; Jev ne fait que juger (oui/non) et choisir
// (quel chunk). Chaque recherche est consignée dans le journal : tu vois dans la fenêtre ce que l'agent a cherché.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { askJev, type JevResult, type Question } from "./jev.js";
import { redactDeep } from "./redact.js";
import { isoLocal, tildify } from "./stop.js";
import type { Agent, MisogiEvent, ProjectConfig } from "./types.js";

const TEXT = new Set(
  ".ts .tsx .js .jsx .mjs .cjs .vue .svelte .astro .py .rb .go .rs .java .kt .kts .swift .dart .c .h .cc .cpp .hpp .cs .php .scala .ex .exs .erl .clj .lua .r .jl .sh .bash .ps1 .sql .graphql .prisma .proto .html .css .scss .less .md .mdx .txt .json .yaml .yml .toml .ini .env.example .tf .hcl .dockerfile .xml".split(" "),
);
const SKIP = /(^|\/)(node_modules|\.git|dist|build|out|target|vendor|coverage|\.next|\.nuxt|\.turbo|\.cache|__pycache__)(\/|$)|\.(min\.js|lock|map)$|package-lock\.json$/;
const MAX_FILES = 600;
const MAX_FILE_BYTES = 200 * 1024;
// Par 10 : au-delà, les réponses de Jev s'aplatissent (tout autour de 0,7) et le bon fichier se perd dans le lot.
const SCREEN_BATCH = 10;
const ASK_BATCH = 8;
const CHUNK_LINES = 40;
const CONCURRENCY = 4;

export interface SearchDeps {
  apiKey?: string;
  mock: boolean;
  ask?: typeof askJev;
  now?: () => Date;
}

/** Fichiers texte du dossier, suivis par git quand c'est un dépôt (les ignorés restent dehors). */
export function listFiles(root: string, dir = "."): string[] {
  let files: string[] = [];
  try {
    files = execFileSync("git", ["-C", root, "ls-files", "-co", "--exclude-standard", "--", dir], { encoding: "utf8", timeout: 5000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter(Boolean);
  } catch {
    const walk = (d: string): void => {
      for (const n of readdirSync(join(root, d), { withFileTypes: true })) {
        const rel = d === "." ? n.name : `${d}/${n.name}`;
        if (SKIP.test(rel)) continue;
        if (n.isDirectory()) walk(rel);
        else files.push(rel);
        if (files.length > MAX_FILES * 3) return;
      }
    };
    try {
      walk(dir);
    } catch {
      return [];
    }
  }
  return files
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => !SKIP.test(f) && (TEXT.has(extname(f).toLowerCase()) || /(^|\/)(Dockerfile|Makefile)$/.test(f)))
    .filter((f) => {
      try {
        return statSync(join(root, f)).size <= MAX_FILE_BYTES;
      } catch {
        return false;
      }
    })
    .slice(0, MAX_FILES);
}

const DECL = /^\s*(export\s|pub\s|public\s|private\s|protected\s|func\s|def\s|class\s|interface\s|type\s|struct\s|enum\s|impl\s|fn\s|async\s+function|function\s|const\s+\w+\s*=\s*(async\s*)?\(|@(Get|Post|Put|Patch|Delete|Controller|Injectable|Component|Entity|Module)|router\.|app\.(get|post|put|delete)|#{1,3}\s|CREATE\s|\w+:\s*\{)/i;

/** Signature d'un fichier pour le premier tri : son chemin et ses déclarations (sans le corps). */
export function signature(root: string, file: string): string {
  try {
    const lines = readFileSync(join(root, file), "utf8").split(/\r?\n/);
    // Le commentaire d'en-tête dit souvent mieux que les noms ce que fait le fichier.
    const header = lines.slice(0, 15).filter((l) => /^\s*(\/\/|#(?!!)|\/?\*|--|"""|''')/.test(l)).slice(0, 6).map((l) => l.trim().slice(0, 160));
    const all = lines.filter((l) => DECL.test(l));
    const decl = all.slice(0, 30).map((l) => l.trim().slice(0, 120));
    // Au-delà de 30 déclarations, le tri ne voit pas tout : on le dit, et le fichier passe à la vérification.
    if (all.length > 30) decl.push(`… et ${all.length - 30} autres déclarations`);
    return [...header, ...(decl.length ? decl : lines.slice(0, 8).map((l) => l.trim().slice(0, 120)))].join("\n");
  } catch {
    return "";
  }
}

export function chunksOf(text: string): { id: string; from: number; text: string }[] {
  const lines = text.split(/\r?\n/);
  const out: { id: string; from: number; text: string }[] = [];
  for (let i = 0; i < lines.length && out.length < 60; i += CHUNK_LINES) out.push({ id: `c${out.length}`, from: i + 1, text: lines.slice(i, i + CHUNK_LINES).join("\n").slice(0, 3000) });
  return out;
}

async function pool<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

async function call(deps: SearchDeps, config: ProjectConfig, state: unknown, questions: Record<string, Question>, mock: () => JevResult): Promise<JevResult> {
  if (deps.mock) return mock();
  if (!deps.apiKey) throw new Error("clé Jev absente pour ce projet : ajoute-la dans Misogi (Projets et clés)");
  return (deps.ask ?? askJev)({ state: redactDeep(state), model: config.model, questions }, { apiKey: deps.apiKey, timeoutMs: Math.max(config.timeout_ms * 4, 8000) });
}

export interface SearchResult {
  results: { path: string; line?: number; p: number }[];
  scanned: number;
  inputTokens: number;
}

/** Trouver du code en le décrivant : tri sur les déclarations, puis vérification sur le contenu et la ligne. */
export async function find(root: string, query: string, dir: string, config: ProjectConfig, deps: SearchDeps, opts: { n?: number; min?: number } = {}): Promise<SearchResult> {
  const files = listFiles(root, dir);
  let tokens = 0;
  // 1. Tri : chemin, commentaire d'en-tête et déclarations, 10 fichiers par requête.
  const batches: string[][] = [];
  for (let i = 0; i < files.length; i += SCREEN_BATCH) batches.push(files.slice(i, i + SCREEN_BATCH));
  const screened = (
    await pool(batches, async (batch) => {
      const questions: Record<string, Question> = Object.fromEntries(
        batch.map((_, i) => [`f${i}`, { type: "noul", instructions: `Could the file \`files[${i}]\` (its path and declarations) contain the code described in \`query\`?`, criteria: { true: "Likely: its path or declarations match what is described", false: "Unlikely: unrelated to what is described" } }]),
      );
      const sigs = batch.map((f) => signature(root, f));
      const state = { query, files: batch.map((f, i) => ({ path: f, declarations: sigs[i] })) };
      const r = await call(deps, config, state, questions, () => mockAnswers(batch, query, root));
      tokens += r.inputTokens;
      return batch.map((f, i) => {
        const p = Number(r.answers[`f${i}`]?.answer ?? 0);
        // Déclarations tronquées : le tri n'a pas tout vu, la vérification lira le contenu.
        return { path: f, p: sigs[i]!.includes("autres déclarations") ? Math.max(p, 0.3) : p };
      });
    })
  ).flat();
  const candidates = screened.filter((s) => s.p >= 0.3).sort((a, b) => b.p - a.p).slice(0, 8);
  // 2. Vérification : le contenu du fichier, et le chunk qui correspond.
  const verified = await pool(candidates, async (c) => {
    const chunks = chunksOf(readFileSync(join(root, c.path), "utf8"));
    const questions: Record<string, Question> = {
      has: { type: "noul", instructions: "Does the file `file` contain the code described in `query`?", criteria: { true: "Yes, this file implements or clearly contains it", false: "No, it only mentions or uses something related" } },
      where: { type: "choice", instructions: "Which chunk of `file` contains the code described in `query`?", criteria: { none: "No chunk contains it", ...Object.fromEntries(chunks.map((k) => [k.id, `from line ${k.from}`])) } },
    };
    const r = await call(deps, config, { query, file: { path: c.path, chunks }, }, questions, () => ({ model: "mock", inputTokens: 0, answers: { has: { answer: c.p, confidence: c.p }, where: { answer: "c0", confidence: 0.6, probabilities: { c0: 0.6 } } } }));
    tokens += r.inputTokens;
    const k = chunks.find((x) => x.id === r.answers.where?.answer);
    return { path: c.path, p: Number(r.answers.has?.answer ?? 0), ...(k ? { line: firstCodeLine(k) } : {}) };
  });
  const min = opts.min ?? 0.5;
  return { results: verified.filter((v) => v.p >= min).sort((a, b) => b.p - a.p).slice(0, opts.n ?? 5), scanned: files.length, inputTokens: tokens };
}

/** Une question oui/non posée à chaque fichier d'un dossier ; la ligne pour ceux qui répondent oui. */
export async function askFiles(root: string, question: string, dir: string, config: ProjectConfig, deps: SearchDeps, opts: { min?: number } = {}): Promise<SearchResult> {
  // Les « oui » de Jev sont nets (0,9 et plus) : 0,7 écarte les cas limites sans perdre les vrais.
  const files = listFiles(root, dir).slice(0, 200);
  let tokens = 0;
  const batches: string[][] = [];
  for (let i = 0; i < files.length; i += ASK_BATCH) batches.push(files.slice(i, i + ASK_BATCH));
  const judged = (
    await pool(batches, async (batch) => {
      const questions: Record<string, Question> = Object.fromEntries(
        batch.map((_, i) => [`f${i}`, { type: "noul", instructions: `For the file \`files[${i}]\` (path and content), is the answer to \`question\` yes? Judge what this file's own code does, not what functions imported from other files do.`, criteria: { true: "Yes, this file's own code does what the question asks about", false: "No: the file does not, or only calls another file that does" } }]),
      );
      const state = { question, files: batch.map((f) => ({ path: f, content: safeRead(root, f).slice(0, 6000) })) };
      const r = await call(deps, config, state, questions, () => mockAnswers(batch, question, root));
      tokens += r.inputTokens;
      return batch.map((f, i) => ({ path: f, p: Number(r.answers[`f${i}`]?.answer ?? 0) }));
    })
  ).flat();
  const min = opts.min ?? 0.7;
  const yes = judged.filter((j) => j.p >= min).sort((a, b) => b.p - a.p).slice(0, 15);
  const located = await pool(yes, async (y) => {
    const chunks = chunksOf(safeRead(root, y.path));
    const r = await call(deps, config, { question, file: { path: y.path, chunks } }, { where: { type: "choice", instructions: "Which chunk of `file` is the part that makes the answer to `question` yes?", criteria: { none: "No single chunk", ...Object.fromEntries(chunks.map((k) => [k.id, `from line ${k.from}`])) } } }, () => ({ model: "mock", inputTokens: 0, answers: { where: { answer: "c0", confidence: 0.6 } } }));
    tokens += r.inputTokens;
    const k = chunks.find((x) => x.id === r.answers.where?.answer);
    return { ...y, ...(k ? { line: firstCodeLine(k) } : {}) };
  });
  return { results: located, scanned: files.length, inputTokens: tokens };
}

function safeRead(root: string, f: string): string {
  try {
    return readFileSync(join(root, f), "utf8");
  } catch {
    return "";
  }
}

function firstCodeLine(k: { from: number; text: string }): number {
  const offset = k.text.split("\n").findIndex((l) => l.trim().length > 0);
  return k.from + Math.max(0, offset);
}

/** Réponses simulées (MISOGI_MOCK=1) : les mots de la requête présents dans le fichier. */
function mockAnswers(batch: string[], query: string, root: string): JevResult {
  const words = query.toLowerCase().match(/[a-zà-ÿ]{4,}/g) ?? [];
  return {
    model: "mock",
    inputTokens: 0,
    answers: Object.fromEntries(
      batch.map((f, i) => {
        const text = (f + safeRead(root, f).slice(0, 4000)).toLowerCase();
        const hit = words.filter((w) => text.includes(w)).length / Math.max(1, words.length);
        return [`f${i}`, { answer: hit, confidence: Math.max(hit, 1 - hit) }];
      }),
    ),
  };
}

/** Texte affiché dans le terminal (et rendu à l'agent) : court, une ligne par résultat. */
export function formatResults(kind: "find" | "ask", r: SearchResult): string {
  if (!r.results.length) return `aucune correspondance dans ${r.scanned} fichiers`;
  const head = kind === "find" ? `${r.scanned} fichiers parcourus, ${r.results.length} correspondance${r.results.length > 1 ? "s" : ""} :` : `${r.scanned} fichiers parcourus, ${r.results.length} répondent oui :`;
  return [head, ...r.results.map((x) => `  ${x.p.toFixed(2)}  ${x.path}${x.line ? `:${x.line}` : ""}`)].join("\n");
}

export function searchEvent(kind: "find" | "ask", agent: Agent | null, project: string, query: string, r: SearchResult, config: ProjectConfig, latency: number, now = new Date()): MisogiEvent {
  return {
    ts: isoLocal(now),
    agent: agent ?? "claude",
    project: tildify(project),
    session: process.env.CLAUDE_SESSION_ID ?? process.env.MISOGI_SESSION ?? "",
    hook: kind,
    mode: config.mode,
    model: config.model,
    questions: {},
    answers: {},
    decision: "allow",
    latency_ms: latency,
    input_tokens: r.inputTokens,
    state_level: config.state_level,
    state_hash: createHash("sha256").update(query).digest("hex"),
    subject: query,
    reason: r.results.length ? `${r.results.length} fichier${r.results.length > 1 ? "s" : ""} sur ${r.scanned} : ${r.results.slice(0, 3).map((x) => x.path).join(", ")}` : `Aucune correspondance dans ${r.scanned} fichiers.`,
    search: { query, scanned: r.scanned, results: r.results },
  };
}
