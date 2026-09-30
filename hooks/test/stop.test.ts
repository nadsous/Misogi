import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { normalize } from "../src/jev.js";
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

const unfinished = {
  model: "jev-1.13.0",
  inputTokens: 1240,
  answers: {
    done: { answer: 0.3, confidence: 0.7 },
    tests: { answer: "not_run", confidence: 0.8, probabilities: { not_run: 0.8 } },
    unverified: { answer: 0.9, confidence: 0.9 },
  },
};

describe("hook Stop", () => {
  it("en shadow, loggue would_block sans rien renvoyer à l'agent", async () => {
    const out = await runStop(ctx, DEFAULT_CONFIG, { apiKey: "k", mock: false, ask: async () => unfinished });
    expect(out.block).toBeNull();
    expect(out.event.decision).toBe("would_block");
    expect(out.event.input_tokens).toBe(1240);
    expect(out.event.questions).toEqual({ done: "noul", tests: "choice", unverified: "noul" });
    expect(out.event.state).toBeUndefined();
    expect(out.event.state_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("en actif, demande à l'agent de continuer, une seule fois par tour", async () => {
    const config = { ...DEFAULT_CONFIG, mode: "active" as const };
    const first = await runStop(ctx, config, { apiKey: "k", mock: false, ask: async () => unfinished });
    expect(first.event.decision).toBe("block");
    expect(first.block).toContain("ne semble pas terminée");
    const again = await runStop({ ...ctx, alreadyContinued: true }, config, { apiKey: "k", mock: false, ask: async () => unfinished });
    expect(again.event.decision).toBe("allow");
    expect(again.block).toBeNull();
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

  it("mode mock : repère les affirmations sans test", async () => {
    const out = await runStop(ctx, DEFAULT_CONFIG, { mock: true });
    expect(out.event.model).toBe("mock");
    expect(out.event.answers.tests?.answer).toBe("not_run");
    expect(Number(out.event.answers.unverified?.answer)).toBeGreaterThan(0.5);
  });

  it("le niveau minimal n'envoie aucun texte", () => {
    const state = buildStopState(ctx, "minimal");
    expect(JSON.stringify(state)).not.toContain("health");
  });

  it("laisse passer quand Jev est d'accord", () => {
    const v = judge({ done: { answer: 0.9, confidence: 0.9 }, tests: { answer: "passed", confidence: 0.9 }, unverified: { answer: 0.1, confidence: 0.9 } }, 0.5);
    expect(v.wouldBlock).toBe(false);
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
