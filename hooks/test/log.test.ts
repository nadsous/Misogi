import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendEvent } from "../src/log.js";
import type { MisogiEvent } from "../src/types.js";

const event: MisogiEvent = {
  ts: "2026-09-30T08:52:11+02:00",
  agent: "claude",
  project: "~/dev/nads-site",
  session: "01HZ",
  hook: "stop",
  mode: "shadow",
  model: "jev-latest",
  questions: { done: "noul" },
  answers: { done: { answer: 0.82, confidence: 0.82 } },
  decision: "allow",
  latency_ms: 610,
  input_tokens: 1240,
  state_level: "reduced",
  state_hash: "abc",
};

afterEach(() => {
  delete process.env.MISOGI_HOME;
});

describe("journal", () => {
  it("ajoute une ligne JSON par décision", () => {
    const home = mkdtempSync(join(tmpdir(), "misogi-"));
    process.env.MISOGI_HOME = home;
    appendEvent(event);
    appendEvent(event);
    const lines = readFileSync(join(home, "events.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual(event);
  });

  it("fait tourner le fichier au-delà de la taille maximale", () => {
    const home = mkdtempSync(join(tmpdir(), "misogi-"));
    process.env.MISOGI_HOME = home;
    appendEvent(event, 10);
    appendEvent(event, 10);
    expect(existsSync(join(home, "events.1.jsonl"))).toBe(true);
    expect(readFileSync(join(home, "events.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
  });
});
