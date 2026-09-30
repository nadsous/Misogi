import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contextAfterCompact, pickKept, runCompact, userMessages } from "../src/compact.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { eventKey, suggestThreshold, type Verdict } from "../src/feedback.js";
import { addJsonHook, removeJsonHook } from "../src/install.js";
import { loopSignal } from "../src/loops.js";
import { contextFor, readPrompt, runPrompt, sectionCandidates, skillCandidates, type Candidate } from "../src/prompt.js";
import { checkCandidates, extractClaims, readReview, reviewNotes } from "../src/review.js";
import { emptyTurn } from "../src/adapters/common.js";
import type { MisogiEvent } from "../src/types.js";

afterEach(() => {
  for (const k of ["MISOGI_HOME", "CLAUDE_CONFIG_DIR"]) delete process.env[k];
});

const n = (p: number) => ({ answer: p, confidence: Math.max(p, 1 - p) });
const c = (answer: string, p = 0.8) => ({ answer, confidence: p, probabilities: { [answer]: p } });

describe("relecture de la demande", () => {
  const skills: Candidate[] = [{ id: "k1", name: "skill billing", description: "Factures et paiements", path: "/s/billing/SKILL.md" }];
  const sections: Candidate[] = [{ id: "s1", name: "CLAUDE.md › Tests", description: "Toujours lancer npm test" }];

  it("lit clarté, modèle conseillé, skill et section ; ne propose rien d'incertain", () => {
    const v = readPrompt({ clear: n(0.2), missing: c("location"), size: c("trivial"), skill: c("k1", 0.9), section: c("s1", 0.4) }, skills, sections);
    expect(v).toMatchObject({ missing: "location", model: "Haiku", skill: { name: "skill billing" }, section: null });
    expect(contextFor(v)).toContain("skill billing");
    expect(contextFor(v)).toContain("l'endroit à modifier");
    // Demande claire, rien à proposer : pas de contexte ajouté.
    expect(contextFor(readPrompt({ clear: n(0.9), missing: c("none"), size: c("large"), skill: c("none") }, skills, sections))).toBeNull();
  });

  it("n'injecte du contexte qu'en mode Protéger", async () => {
    const ask = async () => ({ model: "jev", inputTokens: 10, answers: { clear: n(0.9), missing: c("none"), size: c("small"), skill: c("k1", 0.9), section: c("none") } });
    const ctx = { agent: "claude" as const, project: tmpdir(), session: "s", prompt: "Ajoute la TVA sur les factures", previous: "" };
    const shadow = await runPrompt(ctx, DEFAULT_CONFIG, { apiKey: "k", mock: false, ask, skills, sections });
    expect(shadow.context).toBeNull();
    expect(shadow.event.prompt).toMatchObject({ model: "Sonnet", injected: false });
    const active = await runPrompt(ctx, { ...DEFAULT_CONFIG, mode: "active" }, { apiKey: "k", mock: false, ask, skills, sections });
    expect(active.context).toContain("skill billing");
    expect(active.event.prompt?.injected).toBe(true);
  });

  it("trouve les skills avec leur description et les sections de CLAUDE.md", () => {
    const project = mkdtempSync(join(tmpdir(), "prompt-"));
    process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "claude-"));
    mkdirSync(join(project, ".claude", "skills", "deploy"), { recursive: true });
    writeFileSync(join(project, ".claude", "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: >\n  Déploie l'appli\n  sur Lightsail\n---\n# Deploy");
    writeFileSync(join(project, "CLAUDE.md"), "# Projet\n## Facturation\nLes montants sont en centimes.\n## Tests\nnpm test");
    expect(skillCandidates(project)).toEqual([{ id: "k1", name: "skill deploy", description: "Déploie l'appli sur Lightsail", path: expect.stringContaining("SKILL.md") }]);
    expect(sectionCandidates(project).map((s) => s.name)).toEqual(["CLAUDE.md › Facturation", "CLAUDE.md › Tests"]);
  });
});

describe("relecture du diff", () => {
  it("extrait les affirmations d'action, pas les projets ni les questions", () => {
    const msg = "Voilà :\n- J'ai ajouté les tests de la TVA\n- Corrigé le calcul des remises\n- Je vais ensuite migrer la base\nTu veux que je déploie ?\n```\ncode ajouté\n```";
    expect(extractClaims(msg)).toEqual(["J'ai ajouté les tests de la TVA", "Corrigé le calcul des remises"]);
  });

  it("trouve les commandes de vérification du projet, jusque dans les sous-dossiers", () => {
    const root = mkdtempSync(join(tmpdir(), "checks-"));
    mkdirSync(join(root, "apps", "backend", "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { lint: "eslint .", dev: "vite", "test:watch": "vitest" } }));
    writeFileSync(join(root, "apps", "backend", "package.json"), JSON.stringify({ scripts: { test: "jest", start: "node ." } }));
    writeFileSync(join(root, "pnpm-lock.yaml"), "");
    expect(checkCandidates(root, ["apps/backend/src/billing.ts"])).toEqual(["pnpm lint", "cd apps/backend && pnpm test"]);
  });

  it("trie les fichiers à relire et résume ce qui cloche", () => {
    const input = { claims: ["Ajouté les tests"], files: [{ path: "README.md", diff: "" }, { path: "billing.ts", diff: "" }], checks: ["npm test"] };
    const r = readReview({ claim_0: c("not_in_diff", 0.85), related_0: n(0.1), sensitive_0: n(0.05), related_1: n(0.95), sensitive_1: n(0.9), check: c("c0", 0.7) }, input);
    expect(r.files.map((f) => f.path)).toEqual(["billing.ts", "README.md"]);
    expect(r.suggested_check).toEqual({ command: "npm test", p: 0.7 });
    const notes = reviewNotes(r).join(" | ");
    expect(notes).toContain("n'apparaît pas");
    expect(notes).toContain("hors sujet (README.md)");
    expect(notes).toContain("zone sensible à relire toi-même : billing.ts");
  });
});

describe("compaction", () => {
  it("garde tes consignes durables, mot pour mot et dans l'ordre, et les redonne après", async () => {
    process.env.MISOGI_HOME = mkdtempSync(join(tmpdir(), "compact-"));
    const transcript = join(process.env.MISOGI_HOME, "t.jsonl");
    const lines = [
      { type: "user", message: { content: "Ne touche jamais au dossier migrations/ sans me demander" } },
      { type: "assistant", message: { content: [{ type: "text", text: "Compris." }] } },
      { type: "user", message: { content: "ok" } },
      { type: "user", message: { content: "Corrige le bug d'affichage du panier" } },
      { type: "user", isMeta: true, message: { content: "<system-reminder>x</system-reminder>" } },
    ];
    writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join("\n"));
    expect(userMessages(transcript)).toEqual(["Ne touche jamais au dossier migrations/ sans me demander", "Corrige le bug d'affichage du panier"]);
    expect(pickKept({ keep_0: n(0.3), keep_1: n(0.9) }, ["a", "b"])).toEqual(["b"]);

    const event = await runCompact({ agent: "claude", project: tmpdir(), session: "s1", transcript }, DEFAULT_CONFIG, { mock: true });
    expect(event?.compact?.kept).toEqual(["Ne touche jamais au dossier migrations/ sans me demander"]);
    expect(contextAfterCompact("claude", "s1")).toContain("« Ne touche jamais au dossier migrations/ sans me demander »");
    expect(contextAfterCompact("claude", "autre")).toBeNull();
  });
});

describe("agent qui tourne en rond", () => {
  const check = (command: string, failed: boolean) => ({ command, failed, afterLastEdit: true, at: null, output: "" });
  it("signale la même vérification en échec 3 fois, pas un échec suivi d'une réussite", () => {
    expect(loopSignal({ ...emptyTurn(), checks: [check("npm test", true), check("npm  test", true), check("npm test", true)] })).toContain("3 fois");
    expect(loopSignal({ ...emptyTurn(), checks: [check("npm test", true), check("npm test", true), check("npm test", true), check("npm test", false)] })).toBeNull();
    expect(loopSignal({ ...emptyTurn(), checks: [check("npm test", true), check("tsc", true)] })).toBeNull();
  });
});

describe("seuil conseillé d'après tes avis", () => {
  it("attend assez d'avis, puis propose le seuil qui aurait fait le moins d'erreurs", () => {
    // « Fini » annoncé à 0,75 sans preuve : signalé au seuil 0,7. Tu dis que Jev avait tort (c'était vraiment fini).
    const mk = (i: number, claims: number): MisogiEvent =>
      ({
        ts: `2026-09-30T10:00:${String(i).padStart(2, "0")}+02:00`,
        agent: "claude",
        project: "~/p",
        session: `s${i}`,
        hook: "stop",
        decision: claims > 0.7 ? "would_block" : "allow",
        answers: { claims_done: n(claims), claims_verified: n(0.1), verification_applies: n(0.9), outcome: c("complete") },
        facts: { file_changes: 2, checks_run: 0, verified_after_last_edit: false, failed_after_last_edit: false },
      }) as unknown as MisogiEvent;
    const events = Array.from({ length: 8 }, (_, i) => mk(i, i < 4 ? 0.75 : 0.95));
    const feedback: Record<string, Verdict> = {};
    events.forEach((e, i) => (feedback[eventKey(e)] = i < 4 ? "wrong" : "right"));
    expect(suggestThreshold(events.slice(0, 5), feedback, 0.7)).toMatchObject({ threshold: null, rated: 5, needed: 8 });
    const s = suggestThreshold(events, feedback, 0.7);
    expect(s.threshold).toBe(0.75);
    expect(s.gain).toBe(4);
  });
});

describe("installation des hooks de Claude", () => {
  it("ajoute demande et compaction, et les retire proprement", () => {
    const extras = { UserPromptSubmit: { command: 'node "/h/hook.js" claude prompt', timeout: 10 }, SessionStart: { matcher: "compact", command: 'node "/h/hook.js" claude session', timeout: 5 } };
    const json = addJsonHook({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] } }, 'node "/h/hook.js" claude stop', undefined, "Bash", extras);
    expect(json.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toContain("claude prompt");
    expect(json.hooks?.SessionStart).toHaveLength(2);
    expect(json.hooks?.SessionStart?.[1]?.matcher).toBe("compact");
    expect(removeJsonHook(json)).toEqual({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] } });
  });
});
