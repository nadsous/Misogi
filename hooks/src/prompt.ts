// Hook « relire la demande » (UserPromptSubmit) : avant que l'agent parte, Jev lit ta demande et répond,
// en un seul appel, à quelques questions indépendantes (pattern « speculative fan-out » de TypeSafe) :
//   - la demande est-elle assez claire pour commencer sans deviner ? sinon, qu'est-ce qui manque ?
//   - quelle taille de travail, donc quel modèle suffit (Misogi le suggère : un hook ne change pas le modèle) ;
//   - quel skill ou sous-agent, quelle section de CLAUDE.md s'applique (cookbook « skill suggestion »).
// En mode Protéger, les pistes sûres sont données à l'agent comme contexte ; en mode Observer, seulement affichées.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readJsonlTail } from "./adapters/common.js";
import { listGuides } from "./guides.js";
import { askJev, questionTypes, type JevResult, type Question } from "./jev.js";
import { redactDeep } from "./redact.js";
import { isoLocal, tildify } from "./stop.js";
import type { Agent, MisogiEvent, ProjectConfig } from "./types.js";

export interface PromptContext {
  agent: Agent;
  project: string;
  session: string;
  prompt: string;
  /** Dernier message de l'agent : donne son sens à une relance courte (« oui vas-y »). */
  previous: string;
}

export interface Candidate {
  id: string;
  name: string;
  description: string;
  path?: string;
}

/** Seuils d'affichage : en dessous, la piste est trop incertaine pour être proposée. */
const SUGGEST_AT = 0.55;
const UNCLEAR_AT = 0.5;

export const MODEL_FOR_SIZE: Record<string, string> = { question: "Haiku", trivial: "Haiku", small: "Sonnet", medium: "Sonnet", large: "Opus" };

/** Skills et sous-agents disponibles, avec la description de leur en-tête (projet d'abord, puis global). */
export function skillCandidates(projectDir: string, max = 40): Candidate[] {
  const out: Candidate[] = [];
  for (const g of listGuides(projectDir)) {
    if ((g.kind !== "skill" && g.kind !== "agent") || out.length >= max) continue;
    const description = frontmatterDescription(g.path);
    if (!description) continue; // sans description, Jev ne peut pas juger
    out.push({ id: `k${out.length + 1}`, name: `${g.kind === "agent" ? "sous-agent" : "skill"} ${g.name}`, description, path: g.path });
  }
  return out;
}

function frontmatterDescription(path: string): string {
  try {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, "utf8").slice(0, 6000));
    const lines = (fm?.[1] ?? "").split(/\r?\n/);
    const i = lines.findIndex((l) => /^description:/.test(l));
    if (i === -1) return "";
    let d = lines[i]!.replace(/^description:\s*/, "");
    // Valeur sur plusieurs lignes (description: > ou |) : les lignes indentées qui suivent.
    if (/^[>|][+-]?$/.test(d.trim()) || !d.trim()) d = lines.slice(i + 1).filter((l, k, all) => /^\s/.test(l) && all.slice(0, k).every((x) => /^\s/.test(x))).join(" ");
    return d.replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    return "";
  }
}

/** Sections (titres ##) des instructions du projet : CLAUDE.md, AGENTS.md. */
export function sectionCandidates(projectDir: string, max = 25): Candidate[] {
  const out: Candidate[] = [];
  for (const name of ["CLAUDE.md", ".claude/CLAUDE.md", "AGENTS.md"]) {
    const path = join(projectDir, name);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length && out.length < max; i++) {
      const h = /^#{2,3}\s+(.+)/.exec(lines[i]!);
      if (!h) continue;
      const body = lines.slice(i + 1, i + 6).filter((l) => l.trim() && !l.startsWith("#")).join(" ").slice(0, 200);
      out.push({ id: `s${out.length + 1}`, name: `${basename(name)} › ${h[1]!.trim()}`, description: body, path });
    }
  }
  return out;
}

export function promptQuestions(skills: Candidate[], sections: Candidate[]): Record<string, Question> {
  const q: Record<string, Question> = {
    clear: {
      type: "noul",
      instructions:
        "Is the user's request in `request` specific enough for a coding agent to start the right work without guessing? A short follow-up (e.g. 'yes, do it') is clear when `previous_agent_message` makes its meaning obvious.",
      criteria: {
        true: "The expected result and where to make it are clear from the request and the previous agent message",
        false: "The agent would have to guess the expected result, the place to change, or how far to go",
      },
    },
    missing: {
      type: "choice",
      instructions: "What is the most important thing missing from `request` for the agent to do the right work?",
      criteria: {
        none: "Nothing important is missing",
        goal: "The expected result or the problem to solve is unclear",
        location: "Which file, screen, component or part of the project is meant is unclear",
        behavior: "The exact expected behavior or how to know it is done is unclear",
        scope: "How far to go (one case or all, quick fix or refactor) is unclear",
      },
    },
    size: {
      type: "choice",
      instructions: "How much work does `request` ask the coding agent to do in this project?",
      criteria: {
        question: "Only a question or an explanation, no change to make",
        trivial: "A tiny mechanical change: rename, typo, one-line fix, formatting",
        small: "A small focused change in one or two files",
        medium: "A feature or a fix across several files, with some design choices",
        large: "A large or delicate change: architecture, refactor, migration, security or money-related logic",
      },
    },
  };
  if (skills.length) {
    q.skill = {
      type: "choice",
      instructions: "Which listed skill or sub-agent, described in `skills`, is clearly meant for doing what `request` asks? Pick one only if its description matches the task itself.",
      criteria: { none: "No listed skill or sub-agent clearly fits this request", ...Object.fromEntries(skills.map((s) => [s.id, `${s.name}: ${s.description}`])) },
    };
  }
  if (sections.length) {
    q.section = {
      type: "choice",
      instructions: "Which section of the project instructions, listed in `instructions`, gives rules that directly apply to what `request` asks?",
      criteria: { none: "No listed section applies specifically to this request", ...Object.fromEntries(sections.map((s) => [s.id, `${s.name}: ${s.description}`])) },
    };
  }
  return q;
}

export function buildPromptState(ctx: PromptContext, skills: Candidate[], sections: Candidate[]): Record<string, unknown> {
  return redactDeep({
    request: clip(stripPasted(ctx.prompt), 4000),
    previous_agent_message: clip(ctx.previous, 1500),
    project: basename(ctx.project),
    ...(skills.length ? { skills: skills.map((s) => ({ id: s.id, name: s.name, description: s.description })) } : {}),
    ...(sections.length ? { instructions: sections.map((s) => ({ id: s.id, section: s.name, excerpt: s.description })) } : {}),
  });
}

/** Le texte collé peut être long ; il reste du contexte, pas la demande elle-même. */
function stripPasted(prompt: string): string {
  return prompt.replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, "[texte collé]");
}

export function mockPromptAnswers(ctx: PromptContext, skills: Candidate[], sections: Candidate[]): JevResult {
  const words = ctx.prompt.trim().split(/\s+/).length;
  const clear = words >= 6 ? 0.8 : 0.3;
  const size = /\?\s*$/.test(ctx.prompt.trim()) ? "question" : words < 10 ? "small" : "medium";
  const n = (p: number) => ({ answer: p, confidence: Math.max(p, 1 - p) });
  const c = (answer: string) => ({ answer, confidence: 0.7, probabilities: { [answer]: 0.7 } });
  return {
    model: "mock",
    inputTokens: 0,
    answers: {
      clear: n(clear),
      missing: c(clear > 0.5 ? "none" : "goal"),
      size: c(size),
      ...(skills.length ? { skill: c("none") } : {}),
      ...(sections.length ? { section: c("none") } : {}),
    },
  };
}

export interface PromptVerdict {
  clear: number;
  missing: string | null;
  size: string;
  model: string;
  skill: { name: string; path?: string; p: number } | null;
  section: { name: string; p: number } | null;
}

/** Pour Kimi et Codex, les noms Haiku / Sonnet / Opus n'ont pas de sens : le niveau de modèle, en clair. */
const TIER_FOR_SIZE: Record<string, string> = { question: "le modèle rapide", trivial: "le modèle rapide", small: "le modèle intermédiaire", medium: "le modèle intermédiaire", large: "le modèle le plus capable" };

export function readPrompt(answers: JevResult["answers"], skills: Candidate[], sections: Candidate[], agent: Agent = "claude"): PromptVerdict {
  const pick = (key: string, list: Candidate[]) => {
    const a = answers[key];
    if (!a || a.answer === "none") return null;
    const p = a.probabilities?.[String(a.answer)] ?? a.confidence;
    const found = list.find((c) => c.id === a.answer);
    return found && p >= SUGGEST_AT ? { name: found.name, path: found.path, p } : null;
  };
  const clear = Number(answers.clear?.answer ?? 1);
  const missing = answers.missing?.answer;
  const size = String(answers.size?.answer ?? "medium");
  // Une simple question n'a pas à dire quel fichier changer : jamais « floue » pour ça.
  const question = size === "question" && (answers.size?.probabilities?.question ?? answers.size?.confidence ?? 0) >= 0.5;
  return {
    clear,
    missing: !question && clear < UNCLEAR_AT && typeof missing === "string" && missing !== "none" ? missing : null,
    size,
    model: agent === "claude" ? (MODEL_FOR_SIZE[size] ?? "Sonnet") : (TIER_FOR_SIZE[size] ?? "le modèle intermédiaire"),
    skill: pick("skill", skills),
    section: pick("section", sections),
  };
}

const MISSING_FR: Record<string, string> = {
  goal: "le résultat attendu",
  location: "l'endroit à modifier (fichier, écran, composant)",
  behavior: "le comportement exact attendu, ou comment savoir que c'est fini",
  scope: "jusqu'où aller",
};

/** Contexte donné à l'agent (mode Protéger) : des faits, formulés comme tels, jamais des ordres. */
export function contextFor(v: PromptVerdict): string | null {
  const lines: string[] = [];
  if (v.skill) lines.push(`Le ${v.skill.name} correspond probablement à cette demande${v.skill.path ? ` (${v.skill.path})` : ""}.`);
  if (v.section) lines.push(`La section « ${v.section.name} » des instructions du projet s'applique à cette demande.`);
  if (v.missing) lines.push(`Point peut-être ambigu dans la demande : ${MISSING_FR[v.missing] ?? v.missing}. S'il n'est pas évident d'après le contexte, une question courte à l'utilisateur évite de partir dans la mauvaise direction.`);
  return lines.length ? `Misogi (relecture de la demande par Jev) :\n- ${lines.join("\n- ")}` : null;
}

export function reasonFor(v: PromptVerdict): string {
  const parts: string[] = [];
  if (v.missing) parts.push(`Demande peut-être floue : il manque ${MISSING_FR[v.missing] ?? v.missing}.`);
  else parts.push("Demande claire.");
  parts.push(`${v.model.charAt(0).toUpperCase()}${v.model.slice(1)} suffirait probablement (${SIZE_FR[v.size] ?? v.size}).`);
  if (v.skill) parts.push(`Utile ici : ${v.skill.name}.`);
  if (v.section) parts.push(`Section qui s'applique : « ${v.section.name} ».`);
  return parts.join(" ");
}

const SIZE_FR: Record<string, string> = { question: "simple question", trivial: "changement minime", small: "petit changement", medium: "changement moyen", large: "gros changement délicat" };

export interface PromptDeps {
  apiKey?: string;
  mock: boolean;
  ask?: typeof askJev;
  now?: () => Date;
  /** Pour les tests : candidats fournis directement. */
  skills?: Candidate[];
  sections?: Candidate[];
}

export async function runPrompt(ctx: PromptContext, config: ProjectConfig, deps: PromptDeps): Promise<{ event: MisogiEvent; context: string | null }> {
  const skills = deps.skills ?? skillCandidates(ctx.project);
  const sections = deps.sections ?? sectionCandidates(ctx.project);
  const questions = promptQuestions(skills, sections);
  const state = buildPromptState(ctx, skills, sections);
  const started = Date.now();
  const base = {
    ts: isoLocal((deps.now ?? (() => new Date()))()),
    agent: ctx.agent,
    project: tildify(ctx.project),
    session: ctx.session,
    hook: "prompt" as const,
    mode: config.mode,
    questions: questionTypes(questions),
    state_level: config.state_level,
    state_hash: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
    ...(config.log_state ? { state } : {}),
    summary: redactDeep({ request: clip(ctx.prompt, 2000), files: [], final: "" }),
  };
  let result: JevResult;
  try {
    if (deps.mock) result = mockPromptAnswers(ctx, skills, sections);
    else if (!deps.apiKey) throw new Error("clé Jev absente");
    else result = await (deps.ask ?? askJev)({ state, model: config.model, questions }, { apiKey: deps.apiKey, timeoutMs: config.timeout_ms });
  } catch (err) {
    return { context: null, event: { ...base, model: config.model, answers: {}, decision: "error", latency_ms: Date.now() - started, input_tokens: 0, reason: (err as Error).message } };
  }
  const verdict = readPrompt(result.answers, skills, sections, ctx.agent);
  const context = config.mode === "active" ? contextFor(verdict) : null;
  return {
    context,
    event: {
      ...base,
      model: result.model,
      answers: result.answers,
      decision: "allow",
      latency_ms: Date.now() - started,
      input_tokens: result.inputTokens,
      reason: reasonFor(verdict),
      prompt: { clear: verdict.clear, missing: verdict.missing, size: verdict.size, model: verdict.model, skill: verdict.skill, section: verdict.section, injected: !!context },
    },
  };
}

/** Dernier message de l'agent dans le transcript Claude, pour comprendre une relance courte. */
export function previousAgentMessage(transcript: string | undefined): string {
  if (!transcript) return "";
  type Line = { type?: string; isSidechain?: boolean; message?: { content?: string | { type: string; text?: string }[] } };
  const lines = readJsonlTail<Line>(transcript);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (l.type !== "assistant" || l.isSidechain) continue;
    const c = l.message?.content;
    const text = typeof c === "string" ? c : (c ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
    if (text.trim()) return text.trim();
  }
  return "";
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
