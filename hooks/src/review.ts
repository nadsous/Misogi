// Relecture du diff à la fin du tour, en un appel Jev séparé du contrôle « fini ? » (qui reste seul juge
// du verdict ; si la relecture échoue, rien ne change) :
//   - chaque affirmation du message final est confrontée au diff (cookbook « citation check ») ;
//   - chaque fichier modifié : sert-il la demande ? touche-t-il une zone sensible ? (« composite scoring ») ;
//   - quand rien n'a vérifié le travail : quelle commande de vérification du projet lancer (sélection, pas génération).
// Les candidats (affirmations, fichiers, commandes) sont trouvés par le code ; Jev ne fait que juger ou choisir.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { askJev, type JevResult, type Question } from "./jev.js";
import { redactDeep } from "./redact.js";
import type { Review, StopContext } from "./types.js";

const MAX_CLAIMS = 6;
const MAX_FILES = 12;
const MAX_FILE_DIFF = 2500;
const MAX_CHECKS = 20;

// --- Affirmations : phrases ou puces du message final qui décrivent un changement fait.

const ACTION = /\b(ajout|ajouté|added?|adds|corrig|fix(e[ds])?|mis à jour|updated?|géré|gère|handles?|handled|créé|created?|supprim|removed?|renomm|renamed?|refactor|implément|implemented?|remplac|replaced?|déplac|moved?|migr|branch|wired?|connect|protég|protected|validat|vérifie désormais|now (checks|returns|handles|uses))/i;
const NOT_DONE = /\b(je vais|i will|i'll|next|prochaine|à faire|todo|pourrait|could|should|devrait|si tu veux|if you want)\b|\?\s*$/i;

export function extractClaims(message: string, max = MAX_CLAIMS): string[] {
  const units = message
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\r?\n|(?<=[.!])\s+(?=[A-ZÀ-Ý])/)
    .map((s) =>
      s
        .replace(/^\s*([-*+•]|\d+[.)])\s+/, "")
        .replace(/[*_`#>]/g, "")
        .trim(),
    )
    .filter((s) => s.length >= 12 && s.length <= 400 && ACTION.test(s) && !NOT_DONE.test(s));
  return [...new Set(units)].slice(0, max).map((s) => (s.length > 220 ? s.slice(0, 220) + "…" : s));
}

// --- Diff des fichiers modifiés pendant le tour (par rapport au dernier commit).

export function fileDiffs(root: string, files: string[], max = MAX_FILES): { path: string; diff: string }[] {
  const out: { path: string; diff: string }[] = [];
  for (const path of files.slice(0, max)) {
    let diff = "";
    try {
      diff = execFileSync("git", ["-C", root, "diff", "HEAD", "--unified=2", "--", path], { timeout: 1500, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      // pas de dépôt git, ou pas encore de commit
    }
    if (!diff.trim()) {
      // Nouveau fichier (non suivi) ou dépôt sans git : son début tient lieu de diff.
      try {
        diff = `(nouveau fichier)\n${readFileSync(join(root, path), "utf8")}`;
      } catch {
        diff = "(fichier supprimé ou illisible)";
      }
    }
    out.push({ path, diff: diff.length > MAX_FILE_DIFF ? diff.slice(0, MAX_FILE_DIFF) + "\n… (coupé)" : diff });
  }
  return out;
}

// --- Commandes de vérification disponibles dans le projet.

export function checkCandidates(root: string, files: string[], max = MAX_CHECKS): string[] {
  const out = new Set<string>();
  // package.json de la racine et des dossiers des fichiers modifiés (monorepos : apps/backend, packages/x…).
  const dirs = new Set<string>([""]);
  for (const f of files) {
    let d = dirname(f.replace(/\\/g, "/"));
    while (d && d !== "." && d !== "/") {
      dirs.add(d);
      d = dirname(d);
    }
  }
  const runner = existsSync(join(root, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(root, "yarn.lock")) ? "yarn" : existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock")) ? "bun run" : "npm run";
  for (const d of [...dirs].sort((a, b) => a.length - b.length)) {
    const pkg = join(root, d, "package.json");
    if (!existsSync(pkg)) continue;
    try {
      const scripts = (JSON.parse(readFileSync(pkg, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
      for (const name of Object.keys(scripts)) {
        if (!/test|spec|check|lint|type|build|verify|e2e/i.test(name) || /watch|dev|serve|start|prepare|release|publish/i.test(name)) continue;
        out.add(d ? `cd ${d} && ${runner} ${name}` : `${runner} ${name}`);
      }
    } catch {
      // package.json illisible
    }
  }
  if (existsSync(join(root, "go.mod"))) out.add("go test ./...");
  if (existsSync(join(root, "Cargo.toml"))) out.add("cargo test");
  if (["pyproject.toml", "pytest.ini", "setup.cfg"].some((f) => existsSync(join(root, f)))) out.add("pytest");
  if (existsSync(join(root, "Makefile"))) {
    const targets = readFileSync(join(root, "Makefile"), "utf8").match(/^(test|check|lint)[\w-]*(?=:)/gm) ?? [];
    for (const t of targets) out.add(`make ${t}`);
  }
  return [...out].slice(0, max);
}

// --- Questions

export function reviewQuestions(claims: string[], files: { path: string }[], checks: string[]): Record<string, Question> {
  const q: Record<string, Question> = {};
  claims.forEach((_, i) => {
    q[`claim_${i}`] = {
      type: "choice",
      instructions: `The agent's final message says: \`claims[${i}]\`. Compare this claim with the changes shown in \`files\` (each file's diff against the last commit).`,
      criteria: {
        supported: "The diff shows the change the claim describes",
        contradicted: "The diff shows something different from, or opposite to, what the claim describes",
        not_in_diff: "The claim describes a code change, but no such change appears in the diff",
        not_a_change: "The claim is not about a change in these files (an explanation, a command that was run, a plan)",
      },
    };
  });
  files.forEach((f, i) => {
    q[`related_${i}`] = {
      type: "noul",
      instructions: `Does the change to \`files[${i}].path\`, shown in \`files[${i}].diff\`, serve what \`task\` asks?`,
      criteria: {
        true: "It is needed for the request or directly supports it (including its tests and docs)",
        false: "It is an unrelated cleanup, refactor or change the request did not ask for",
      },
    };
    q[`sensitive_${i}`] = {
      type: "noul",
      instructions: `Does the change in \`files[${i}].diff\` touch security, authentication, permissions, money or billing, data deletion, database schema or migrations, secrets, or deployment configuration?`,
      criteria: { true: "Yes: a mistake here could leak data, lose money or data, or break production", false: "No: ordinary code, UI, docs or tests" },
    };
  });
  if (checks.length) {
    q.check = {
      type: "choice",
      instructions: "Which command listed in `check_commands` is the most relevant automated check for the changed files in `files`?",
      criteria: { none: "None of the listed commands would check these changes", ...Object.fromEntries(checks.map((c, i) => [`c${i}`, c])) },
    };
  }
  return q;
}

export interface ReviewInput {
  claims: string[];
  files: { path: string; diff: string }[];
  checks: string[];
}

/** Ce que la relecture enverrait : candidats trouvés en local. Null quand il n'y a rien à relire. */
export function prepareReview(ctx: StopContext, verified: boolean): ReviewInput | null {
  if (!ctx.filesModified.length) return null;
  const files = fileDiffs(ctx.project, ctx.filesModified);
  return { claims: extractClaims(ctx.finalMessage), files, checks: verified ? [] : checkCandidates(ctx.project, ctx.filesModified) };
}

export function buildReviewState(ctx: StopContext, input: ReviewInput): Record<string, unknown> {
  return redactDeep({
    task: ctx.request.slice(0, 3000),
    claims: input.claims,
    files: input.files,
    ...(input.checks.length ? { check_commands: input.checks.map((c, i) => ({ id: `c${i}`, command: c })) } : {}),
  });
}

export function readReview(answers: JevResult["answers"], input: ReviewInput): Review {
  const p = (k: string) => Number(answers[k]?.answer ?? 0.5);
  const claims = input.claims.map((text, i) => {
    const a = answers[`claim_${i}`];
    const verdict = (a?.answer ?? "not_a_change") as Review["claims"][number]["verdict"];
    return { text, verdict, p: a?.probabilities?.[verdict] ?? a?.confidence ?? 0 };
  });
  const files = input.files
    .map((f, i) => ({ path: f.path, related: p(`related_${i}`), sensitive: p(`sensitive_${i}`) }))
    // À relire en premier : le plus sensible, puis le plus hors sujet.
    .sort((a, b) => b.sensitive - a.sensitive || a.related - b.related);
  const check = answers.check;
  const idx = typeof check?.answer === "string" && check.answer.startsWith("c") ? Number(check.answer.slice(1)) : -1;
  const pc = check?.probabilities?.[String(check.answer)] ?? check?.confidence ?? 0;
  return { claims, files, ...(idx >= 0 && input.checks[idx] && pc >= 0.4 ? { suggested_check: { command: input.checks[idx]!, p: pc } } : {}) };
}

/** Ce que la relecture ajoute à la raison du verdict : des constats, jamais un blocage à elle seule. */
export function reviewNotes(r: Review): string[] {
  const notes: string[] = [];
  const unsupported = r.claims.filter((c) => (c.verdict === "not_in_diff" || c.verdict === "contradicted") && c.p >= 0.6);
  if (unsupported.length) notes.push(`${unsupported.length === 1 ? "une affirmation de l'agent n'apparaît pas" : `${unsupported.length} affirmations de l'agent n'apparaissent pas`} dans le diff (« ${unsupported[0]!.text} »)`);
  const off = r.files.filter((f) => f.related < 0.3);
  if (off.length) notes.push(`${off.length} fichier${off.length > 1 ? "s semblent" : " semble"} hors sujet (${off.map((f) => f.path).slice(0, 3).join(", ")})`);
  const sensitive = r.files.filter((f) => f.sensitive >= 0.7);
  if (sensitive.length) notes.push(`zone sensible à relire toi-même : ${sensitive.map((f) => f.path).slice(0, 3).join(", ")}`);
  return notes;
}

export function mockReviewAnswers(input: ReviewInput): JevResult {
  const answers: JevResult["answers"] = {};
  input.claims.forEach((c, i) => {
    const word = c.toLowerCase().match(/[a-zà-ÿ_]{5,}/g)?.find((w) => !ACTION.test(w)) ?? "";
    const found = input.files.some((f) => word && f.diff.toLowerCase().includes(word));
    const v = found ? "supported" : "not_in_diff";
    answers[`claim_${i}`] = { answer: v, confidence: 0.7, probabilities: { [v]: 0.7 } };
  });
  input.files.forEach((f, i) => {
    answers[`related_${i}`] = { answer: 0.8, confidence: 0.8 };
    const s = /auth|billing|payment|migration|secret|\.env|security|permission/i.test(f.path + f.diff) ? 0.8 : 0.1;
    answers[`sensitive_${i}`] = { answer: s, confidence: Math.max(s, 1 - s) };
  });
  if (input.checks.length) answers.check = { answer: "c0", confidence: 0.6, probabilities: { c0: 0.6 } };
  return { model: "mock", inputTokens: 0, answers };
}

export async function runReview(
  ctx: StopContext,
  input: ReviewInput,
  opts: { apiKey?: string; mock: boolean; model: string; timeoutMs: number; ask?: typeof askJev },
): Promise<{ review: Review; inputTokens: number } | null> {
  const questions = reviewQuestions(input.claims, input.files, input.checks);
  if (!Object.keys(questions).length) return null;
  try {
    const result = opts.mock ? mockReviewAnswers(input) : opts.apiKey ? await (opts.ask ?? askJev)({ state: buildReviewState(ctx, input), model: opts.model, questions }, { apiKey: opts.apiKey, timeoutMs: opts.timeoutMs }) : null;
    return result ? { review: readReview(result.answers, input), inputTokens: result.inputTokens } : null;
  } catch {
    return null; // la relecture est un plus : son échec ne change rien au verdict
  }
}
