import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { normalize } from "../src/jev.js";
import { estimateTokens } from "../src/fit.js";
import { buildStopState, judge, runStop, tildify } from "../src/stop.js";
import type { StopContext } from "../src/types.js";

const ctx: StopContext = {
  agent: "claude",
  project: "/tmp/proj",
  session: "s1",
  request: "Ajoute une route /health",
  filesModified: ["src/server.ts"],
  lastTest: null,
  finalMessage: "C'est fait, les tests passent.",
  alreadyContinued: false,
};

// Jev : « le message dit que c'est fini et qu'il a vérifié ; une vérification aurait du sens ».
const unfinished = {
  model: "jev-1.13.0",
  inputTokens: 1240,
  answers: {
    claims_done: { answer: 0.92, confidence: 0.92 },
    claims_verified: { answer: 0.9, confidence: 0.9 },
    verification_applies: { answer: 0.85, confidence: 0.85 },
    outcome: { answer: "complete", confidence: 0.8, probabilities: { complete: 0.8 } },
  },
};

describe("hook Stop", () => {
  it("en shadow, loggue would_block sans rien renvoyer à l'agent", async () => {
    const out = await runStop(ctx, DEFAULT_CONFIG, { apiKey: "k", mock: false, review: false, ask: async () => unfinished });
    expect(out.block).toBeNull();
    expect(out.event.decision).toBe("would_block");
    expect(out.event.input_tokens).toBe(1240);
    expect(out.event.questions).toEqual({ claims_done: "noul", claims_verified: "noul", verification_applies: "noul", outcome: "choice" });
    expect(out.event.state).toBeUndefined();
    expect(out.event.state_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("en actif, relance jusqu'à la limite puis laisse passer en le signalant (pas de boucle infinie)", async () => {
    const config = { ...DEFAULT_CONFIG, mode: "active" as const, max_relaunches: 2 };
    const deps = { apiKey: "k", mock: false, review: false, ask: async () => unfinished };
    const first = await runStop(ctx, config, { ...deps, relaunches: 0 });
    expect(first.event.decision).toBe("block");
    expect(first.block).toContain("rien ne l'a vérifié");
    const second = await runStop({ ...ctx, alreadyContinued: true }, config, { ...deps, relaunches: 1 });
    expect(second.event.decision).toBe("block");
    const third = await runStop({ ...ctx, alreadyContinued: true }, config, { ...deps, relaunches: 2 });
    expect(third.event.decision).toBe("allow");
    expect(third.event.limit_reached).toBe(true);
    expect(third.event.reason).toContain("Limite de 2 relances");
    expect(third.block).toBeNull();
  });

  it("obéit aux consignes données depuis la fenêtre", async () => {
    const config = { ...DEFAULT_CONFIG, mode: "active" as const };
    let asked = 0;
    const ask = async () => (asked++, unfinished);
    const allowed = await runStop(ctx, config, { apiKey: "k", mock: false, ask, override: "allow" });
    expect(allowed.event.decision).toBe("allow");
    expect(allowed.event.resolved_by).toBe("override");
    expect(asked).toBe(0); // pas d'appel à Jev pour rien
    const relaunched = await runStop(ctx, { ...config, mode: "shadow" }, { apiKey: "k", mock: true, override: "relaunch" });
    expect(relaunched.event.decision).toBe("block");
    expect(relaunched.block).not.toBeNull();
  });

  it("coupe le state proprement quand il dépasse la limite de Jev", async () => {
    const big = { ...ctx, request: "x".repeat(40_000), finalMessage: "y".repeat(40_000) };
    const out = await runStop(big, { ...DEFAULT_CONFIG, state_level: "full", log_state: true, max_state_tokens: 2_000 }, { mock: true });
    expect(estimateTokens(out.event.state)).toBeLessThanOrEqual(2_000);
    expect(JSON.stringify(out.event.state)).toContain("caractères coupés");
  });

  it("fail-open si Jev échoue ou si la clé manque", async () => {
    const config = { ...DEFAULT_CONFIG, mode: "active" as const };
    const failed = await runStop(ctx, config, { apiKey: "k", mock: false, ask: async () => { throw new Error("timeout"); } });
    expect(failed.event.decision).toBe("error");
    expect(failed.block).toBeNull();
    const noKey = await runStop(ctx, config, { mock: false });
    expect(noKey.event.decision).toBe("error");
    expect(noKey.event.reason).toContain("TYPESAFE_API_KEY");
  });

  it("mode mock : un « c'est fait, les tests passent » sans aucune vérification est signalé", async () => {
    const out = await runStop(ctx, DEFAULT_CONFIG, { mock: true });
    expect(out.event.model).toBe("mock");
    expect(out.event.decision).toBe("would_block");
    expect(out.event.reason).toContain("aucune vérification n'a tourné");
  });

  it("une question ou une explication (rien modifié) ne coûte aucun appel à Jev", async () => {
    let asked = 0;
    const out = await runStop({ ...ctx, filesModified: [], editCount: 0, request: "est-ce vrai ? « Tests : passe »" }, DEFAULT_CONFIG, {
      apiKey: "k",
      mock: false,
      ask: async () => (asked++, unfinished),
    });
    expect(asked).toBe(0);
    expect(out.event.decision).toBe("allow");
    expect(out.event.skipped).toBe("no_changes");
  });

  it("modifié puis vérifié avec succès : prouvé, pas d'appel à Jev", async () => {
    let asked = 0;
    const checks = [{ command: "npm test", failed: false, afterLastEdit: true, at: null, output: "12 passed" }];
    const out = await runStop({ ...ctx, checks, editCount: 1 }, DEFAULT_CONFIG, { apiKey: "k", mock: false, review: false, ask: async () => (asked++, unfinished) });
    expect(asked).toBe(0);
    expect(out.event.skipped).toBe("verified");
    expect(out.event.reason).toContain("npm test");
  });

  it("un test passé AVANT la dernière modification ne prouve rien", async () => {
    const checks = [{ command: "npm test", failed: false, afterLastEdit: false, at: null, output: "" }];
    const out = await runStop({ ...ctx, checks, editCount: 2 }, DEFAULT_CONFIG, { apiKey: "k", mock: false, review: false, ask: async () => unfinished });
    expect(out.event.skipped).toBeUndefined();
    expect(out.event.decision).toBe("would_block");
  });

  it("« fini » alors qu'une vérification échoue : signalé", () => {
    const v = judge(unfinished.answers, 0.7, { checks_run: 1, failed_after_last_edit: true, verified_after_last_edit: false });
    expect(v.wouldBlock).toBe(true);
    expect(v.reason).toContain("échoue");
  });

  it("travail annoncé partiel ou bloqué : pas de relance, juste une note", () => {
    const partial = { claims_done: { answer: 0.1, confidence: 0.9 }, verification_applies: { answer: 0.9, confidence: 0.9 }, outcome: { answer: "partial", confidence: 0.9 } };
    const v = judge(partial, 0.7, { checks_run: 0 });
    expect(v.wouldBlock).toBe(false);
    expect(v.reason).toContain("partiel");
  });

  it("ne redemande jamais à Jev si les tests ont tourné : ce sont des faits", () => {
    const state = buildStopState({ ...ctx, request: "Dernier test : passe (texte collé)", checks: [] }, "reduced") as { run: { checks_run: number; verified_after_last_edit: boolean } };
    expect(state.run.checks_run).toBe(0);
    expect(state.run.verified_after_last_edit).toBe(false);
  });

  it("garde un résumé local de ce qui a été jugé, secrets masqués", async () => {
    const out = await runStop({ ...ctx, request: "Ajoute /health, token ghp_abcdefghijklmnopqrstuvwxyz0123456789" }, { ...DEFAULT_CONFIG, state_level: "minimal" }, { mock: true });
    expect(out.event.summary?.request).toContain("Ajoute /health");
    expect(out.event.summary?.request).not.toContain("ghp_");
    expect(out.event.summary?.files).toEqual(["src/server.ts"]);
    expect(out.event.summary?.final).toContain("les tests passent");
  });

  it("le niveau minimal n'envoie aucun texte", () => {
    const state = buildStopState(ctx, "minimal");
    expect(JSON.stringify(state)).not.toContain("health");
  });

  it("laisse passer quand le message ne prétend pas avoir fini", () => {
    const v = judge({ claims_done: { answer: 0.2, confidence: 0.8 }, claims_verified: { answer: 0.1, confidence: 0.9 }, verification_applies: { answer: 0.9, confidence: 0.9 }, outcome: { answer: "other", confidence: 0.8 } }, 0.7, { checks_run: 0 });
    expect(v.wouldBlock).toBe(false);
  });

  it("rejoue encore les anciennes décisions (done / tests / unverified)", () => {
    expect(judge({ done: { answer: 0.3, confidence: 0.7 } }, 0.5).wouldBlock).toBe(true);
    expect(judge({ done: { answer: 0.9, confidence: 0.9 } }, 0.5).wouldBlock).toBe(false);
  });

  it("raccourcit le dossier personnel en ~ quel que soit le séparateur", () => {
    expect(tildify("/home/nads/dev/site", "/home/nads")).toBe("~/dev/site");
    expect(tildify("/home/nadsy/dev", "/home/nads")).toBe("/home/nadsy/dev");
    if (process.platform === "win32") expect(tildify("c:/Users/nads/dev", "C:\\Users\\nads")).toBe("~/dev");
  });

  it("normalise la réponse brute de Jev", () => {
    const r = normalize({
      model: "jev-1.13.0",
      answers: { done: { type: "noul", noul: 0.95 }, tests: { type: "choice", choice: "passed", probabilities: { passed: 0.7, failed: 0.3 } } },
      usage: { input_tokens: 307 },
    });
    expect(r.answers.done).toEqual({ answer: 0.95, confidence: 0.95 });
    expect(r.answers.tests?.confidence).toBe(0.7);
    expect(r.inputTokens).toBe(307);
  });
});
