import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { readCandidate, runRead, windowFor } from "../src/read.js";
import { currentRoute, decideRoute, fitToModel, rewriteBody, tierForSize, usageOf } from "../src/router.js";
import { chunksOf, formatResults, listFiles } from "../src/search.js";

afterEach(() => {
  delete process.env.MISOGI_HOME;
});

describe("lecture ciblée", () => {
  const big = (n: number) => Array.from({ length: n }, (_, i) => `ligne ${i + 1}`).join("\n");

  it("ne touche ni aux petits fichiers, ni aux lectures déjà ciblées, ni aux fichiers hors projet", async () => {
    const dir = mkdtempSync(join(tmpdir(), "read-"));
    writeFileSync(join(dir, "small.ts"), big(100));
    writeFileSync(join(dir, "big.ts"), big(800));
    expect(readCandidate({ project: dir, session: "s", filePath: join(dir, "small.ts"), request: "", agentNote: "" })).toBeNull();
    expect(readCandidate({ project: dir, session: "s", filePath: join(dir, "big.ts"), offset: 10, request: "", agentNote: "" })).toBeNull();
    expect(readCandidate({ project: dir, session: "s", filePath: join(dir, "big.ts"), request: "", agentNote: "" })?.chunks).toHaveLength(20);
    const outside = await runRead({ project: join(dir, "sub"), session: "s", filePath: join(dir, "big.ts"), request: "", agentNote: "" }, DEFAULT_CONFIG, { mock: true });
    expect(outside.narrowed).toBeNull();
  });

  it("donne une fenêtre d'environ un cinquième, centrée sur la partie choisie", () => {
    expect(windowFor({ id: "c10", from: 401, to: 440, text: "" }, 1000)).toEqual({ offset: 321, limit: 200 });
    expect(windowFor({ id: "c0", from: 1, to: 40, text: "" }, 1000)).toEqual({ offset: 1, limit: 200 });
    expect(windowFor({ id: "c24", from: 961, to: 1000, text: "" }, 1000)).toEqual({ offset: 801, limit: 200 });
  });

  it("laisse la lecture entière quand deux endroits éloignés correspondent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "read-"));
    writeFileSync(join(dir, "i18n.ts"), big(800));
    const ask = async () => ({ model: "jev", inputTokens: 100, answers: { whole: { answer: 0.1, confidence: 0.9 }, part: { answer: "c2", confidence: 0.8, probabilities: { c2: 0.78, c15: 0.21 } } } });
    const r = await runRead({ project: dir, session: "s", filePath: join(dir, "i18n.ts"), request: "x", agentNote: "" }, DEFAULT_CONFIG, { apiKey: "k", mock: false, ask });
    expect(r.narrowed).toBeNull();
    expect(r.event?.reason).toContain("deux endroits");
  });
});

describe("recherche find / ask", () => {
  it("liste les fichiers texte sans node_modules ni fichiers générés", () => {
    const dir = mkdtempSync(join(tmpdir(), "search-"));
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;");
    writeFileSync(join(dir, "src", "a.min.js"), "x");
    writeFileSync(join(dir, "node_modules", "x", "i.js"), "x");
    writeFileSync(join(dir, "logo.png"), "x");
    expect(listFiles(dir)).toEqual(["src/a.ts"]);
    expect(chunksOf(Array.from({ length: 90 }, () => "l").join("\n")).map((c) => c.from)).toEqual([1, 41, 81]);
    expect(formatResults("find", { results: [], scanned: 12, inputTokens: 0 })).toBe("aucune correspondance dans 12 fichiers");
    expect(formatResults("find", { results: [{ path: "src/a.ts", line: 3, p: 0.95 }], scanned: 12, inputTokens: 0 })).toContain("0.95  src/a.ts:3");
  });
});

describe("routeur", () => {
  it("choisit le niveau d'après la taille, et ne redescend jamais dans une session", () => {
    process.env.MISOGI_HOME = mkdtempSync(join(tmpdir(), "route-"));
    expect([tierForSize("question"), tierForSize("small"), tierForSize("large")]).toEqual(["fast", "balanced", "frontier"]);
    const config = { ...DEFAULT_CONFIG, router: { ...DEFAULT_CONFIG.router, enabled: true } };
    expect(decideRoute("s1", "trivial", config)).toMatchObject({ tier: "fast", model: "claude-haiku-4-5", escalated: false });
    expect(decideRoute("s1", "large", config)).toMatchObject({ tier: "frontier", previous: "fast", escalated: true });
    expect(decideRoute("s1", "trivial", config)).toMatchObject({ tier: "frontier", escalated: false });
    expect(currentRoute("s1")?.model).toBe("claude-opus-5-5");
  });

  it("ne change que les tours principaux, et adapte la requête à Haiku", () => {
    const body = Buffer.from(
      JSON.stringify({
        model: "claude-opus-5-5",
        max_tokens: 128000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        context_management: { edits: [{ type: "clear_thinking_20251015" }] },
        messages: [{ role: "user", content: "a" }, { role: "system", content: [{ type: "text", text: "rappel" }] }, { role: "user", content: "b", output_config: { effort: "high" } }],
      }),
    );
    const route = () => ({ model: "claude-haiku-4-5" });
    expect(rewriteBody({ "x-claude-code-request-class": "auxiliary", "x-claude-code-session-id": "s" }, body, route)).toBeNull();
    const r = rewriteBody({ "x-claude-code-request-class": "main", "x-claude-code-session-id": "s" }, body, route);
    const json = JSON.parse(r!.body.toString());
    expect(r!.from).toBe("claude-opus-5-5");
    expect(json).toMatchObject({ model: "claude-haiku-4-5", max_tokens: 64000 });
    expect(json.thinking).toBeUndefined();
    expect(json.output_config).toBeUndefined();
    expect(json.context_management).toBeUndefined();
    expect(json.messages[1]).toEqual({ role: "user", content: [{ type: "text", text: "<system-reminder>\nrappel\n</system-reminder>" }] });
    expect(json.messages[2].output_config).toBeUndefined();
  });

  it("garde la réflexion pour Sonnet, sous son plafond", () => {
    const json: Record<string, unknown> = { max_tokens: 128000, thinking: { type: "enabled", budget_tokens: 100000 } };
    fitToModel(json, "claude-sonnet-5-5");
    expect(json).toEqual({ max_tokens: 64000, thinking: { type: "enabled", budget_tokens: 59904 } });
  });

  it("lit les tokens d'une réponse en streaming", () => {
    const sse = 'event: message_start\ndata: {"message":{"usage":{"input_tokens":12,"cache_read_input_tokens":3000,"output_tokens":1}}}\n\nevent: message_delta\ndata: {"usage":{"output_tokens":321}}\n';
    expect(usageOf(sse)).toEqual({ input: 3012, output: 321 });
  });
});
