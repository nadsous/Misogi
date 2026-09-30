import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, hiddenProjects, hideProject, unhideProject } from "../src/config.js";
import { eventKey, reliability, replay } from "../src/feedback.js";
import { projectRoot } from "../src/platform.js";
import { runStop } from "../src/stop.js";
import { extractCriteria, findRef, gitInfo, parseRemote } from "../src/tickets.js";
import type { MisogiEvent, StopContext } from "../src/types.js";

afterEach(() => {
  delete process.env.MISOGI_HOME;
});

describe("racine du projet", () => {
  it("remonte d'un sous-dossier (ex. app/src-tauri) jusqu'au projet", () => {
    const root = mkdtempSync(join(tmpdir(), "misogi-root-"));
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "app", "src-tauri"), { recursive: true });
    expect(projectRoot(join(root, "app", "src-tauri"))).toBe(root);
    mkdirSync(join(root, "app", ".misogi"));
    writeFileSync(join(root, "app", ".misogi", "config.json"), "{}");
    // Un .misogi plus proche gagne (monorepo avec plusieurs projets suivis).
    expect(projectRoot(join(root, "app", "src-tauri", "x"))).toBe(join(root, "app"));
  });
});

describe("tickets", () => {
  it("lit l'hôte et le dépôt depuis l'URL du remote", () => {
    expect(parseRemote("git@github.com:nadsous/Misogi.git")).toEqual({ host: "github.com", repo: "nadsous/Misogi" });
    expect(parseRemote("https://gitlab.example.com/team/sub/app.git")).toEqual({ host: "gitlab.example.com", repo: "team/sub/app" });
    expect(parseRemote("https://github.com/owner/repo")).toEqual({ host: "github.com", repo: "owner/repo" });
  });

  it("trouve la référence dans la branche ou la demande", () => {
    expect(findRef("feat/123-contact", "", "github.com", "o/r", false)).toMatchObject({ provider: "github", id: "123" });
    expect(findRef("issue-42", "", "gitlab.com", "o/r", false)).toMatchObject({ provider: "gitlab", id: "42" });
    expect(findRef("main", "Corrige #7 stp", "github.com", "o/r", false)).toMatchObject({ id: "7" });
    expect(findRef("eng-88-login", "", "github.com", "o/r", true)).toMatchObject({ provider: "linear", id: "ENG-88" });
    expect(findRef("release/2026", "", "github.com", "o/r", false)).toBeNull();
    expect(findRef("main", "passe en UTF-8", "github.com", "o/r", true)).toBeNull();
  });

  it("extrait les critères d'acceptation", () => {
    const body = "Contexte blabla\n\n## Acceptance criteria\n- [ ] Le formulaire envoie un e-mail\n- [ ] Tests e2e\n\n## Notes\nrien";
    expect(extractCriteria(body)).toBe("- [ ] Le formulaire envoie un e-mail\n- [ ] Tests e2e");
    expect(extractCriteria("Intro\n- [x] A\n- [ ] B")).toBe("- [x] A\n- [ ] B");
    expect(extractCriteria("Juste une description.")).toBe("Juste une description.");
  });

  it("lit la branche et le remote dans .git", () => {
    const root = mkdtempSync(join(tmpdir(), "misogi-git-"));
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/feat/12-contact\n");
    writeFileSync(join(root, ".git", "config"), '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:o/r.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n');
    expect(gitInfo(root)).toEqual({ branch: "feat/12-contact", host: "github.com", repo: "o/r" });
  });

  it("ajoute la question des critères et bloque s'ils ne sont pas remplis", async () => {
    const ctx: StopContext = { agent: "claude", project: "/p", session: "s", request: "fais #1", filesModified: ["src/contact.ts"], lastTest: null, finalMessage: "C'est fait.", alreadyContinued: false };
    const ticket = { provider: "github" as const, id: "#1", title: "Contact", url: "https://x", criteria: "- [ ] e-mail envoyé" };
    const out = await runStop(ctx, { ...DEFAULT_CONFIG, log_state: true }, { mock: true, ticket });
    expect(out.event.questions.criteria).toBe("noul");
    expect(out.event.ticket?.id).toBe("#1");
    expect(JSON.stringify(out.event.state)).toContain("e-mail envoyé");
    expect(out.event.reason).toContain("critères du ticket");
    // Au niveau minimal, le texte du ticket ne part pas.
    const minimal = await runStop(ctx, { ...DEFAULT_CONFIG, state_level: "minimal" }, { mock: true, ticket });
    expect(minimal.event.questions.criteria).toBeUndefined();
  });
});

describe("avis et rejeu", () => {
  const ev = (done: number, decision: MisogiEvent["decision"], i: number): MisogiEvent => ({
    ts: `2026-09-30T10:0${i}:00Z`,
    agent: "claude",
    project: "/p",
    session: `s${i}`,
    hook: "stop",
    mode: "shadow",
    model: "jev",
    questions: {},
    answers: { done: { answer: done, confidence: Math.max(done, 1 - done) } },
    decision,
    latency_ms: 1,
    input_tokens: 1,
    state_level: "reduced",
    state_hash: `h${i}`,
  });

  it("mesure la fiabilité et montre ce qu'un autre seuil changerait", () => {
    const events = [ev(0.45, "would_block", 1), ev(0.3, "would_block", 2), ev(0.8, "allow", 3)];
    const feedback = { [eventKey(events[0]!)]: "wrong" as const, [eventKey(events[1]!)]: "right" as const, [eventKey(events[2]!)]: "right" as const };
    const r = reliability(events, feedback);
    expect(r).toMatchObject({ rated: 3, right: 2, falseAlarms: 1, missed: 0 });
    expect(r.accuracy).toBeCloseTo(2 / 3);
    // Seuil 0,40 : la fausse alerte à 0,45 disparaît, la vraie à 0,30 reste.
    const lower = replay(events, 0.4, feedback);
    expect(lower).toMatchObject({ total: 3, flaggedBefore: 2, flaggedAfter: 1, fixed: 1, broken: 0 });
    // Seuil 0,90 : la bonne décision « laissé passer » à 0,80 deviendrait une alerte.
    expect(replay(events, 0.9, feedback)).toMatchObject({ flaggedAfter: 3, broken: 1 });
  });

  it("un projet retiré ne réapparaît pas, sauf si on le ré-ajoute", () => {
    process.env.MISOGI_HOME = mkdtempSync(join(tmpdir(), "misogi-hide-"));
    hideProject("C:/dev/site");
    expect(hiddenProjects()).toEqual(["C:/dev/site"]);
    unhideProject("C:/dev/site");
    expect(hiddenProjects()).toEqual([]);
  });
});
