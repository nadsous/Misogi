import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getUsage } from "../src/usage.js";

afterEach(() => {
  for (const k of ["MISOGI_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "KIMI_HOME"]) delete process.env[k];
});

describe("quotas", () => {
  it("lit les pourcentages Claude de la statusline, Codex de ses sessions, et la conso Jev", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    const root = mkdtempSync(join(tmpdir(), "usage-"));
    for (const d of ["misogi/usage", "claude/projects/p", "codex/sessions/2026/09/30", "kimi/sessions"]) mkdirSync(join(root, d), { recursive: true });
    process.env.MISOGI_HOME = join(root, "misogi");
    process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
    process.env.CODEX_HOME = join(root, "codex");
    process.env.KIMI_HOME = join(root, "kimi");

    writeFileSync(
      join(root, "misogi/usage/claude.json"),
      JSON.stringify({ rate_limits: { five_hour: { used_percentage: 23.5, resets_at: now / 1000 + 3600 }, seven_day: { used_percentage: 41, resets_at: now / 1000 - 10 } }, seenAt: now }),
    );
    writeFileSync(
      join(root, "claude/projects/p/s.jsonl"),
      JSON.stringify({ type: "assistant", timestamp: new Date(now - 3600_000).toISOString(), message: { usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10 } } }) + "\n",
    );
    writeFileSync(
      join(root, "codex/sessions/2026/09/30/rollout.jsonl"),
      JSON.stringify({
        timestamp: new Date(now - 60_000).toISOString(),
        type: "event_msg",
        payload: { type: "token_count", info: { last_token_usage: { total_tokens: 500 } }, rate_limits: { plan_type: "plus", primary: { used_percent: 12, window_minutes: 300, resets_at: now / 1000 + 600 }, secondary: { used_percent: 60, window_minutes: 10080, resets_at: now / 1000 + 86400 } } },
      }) + "\n",
    );
    writeFileSync(
      join(root, "misogi/events.jsonl"),
      JSON.stringify({ ts: new Date(now - 60_000).toISOString(), agent: "claude", decision: "allow", model: "jev-1.13.0", input_tokens: 1_000_000, latency_ms: 600 }) + "\n",
    );

    const u = getUsage(now);
    // La fenêtre 7 j a expiré : on ne l'affiche plus.
    expect(u.claude?.windows).toEqual([{ label: "5h", usedPercent: 23.5, resetsAt: now + 3600_000 }]);
    expect(u.claude?.tokens5h).toBe(160);
    expect(u.codex?.windows.map((w) => [w.label, w.usedPercent])).toEqual([["5h", 12], ["7d", 60]]);
    expect(u.codex?.plan).toBe("plus");
    expect(u.codex?.tokens24h).toBe(500);
    expect(u.jev.callsToday).toBe(1);
    expect(u.jev.costToday).toBeCloseTo(0.042);
  });
});
