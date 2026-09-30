import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSettings, saveSettings } from "../src/config.js";
import { recentProjects } from "../src/sessions.js";

afterEach(() => {
  for (const k of ["MISOGI_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "KIMI_HOME"]) delete process.env[k];
});

describe("projets récents à connecter", () => {
  it("trouve les dossiers de travail de Claude et Codex, sans les sessions trop anciennes", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    const root = mkdtempSync(join(tmpdir(), "recent-"));
    process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
    process.env.CODEX_HOME = join(root, "codex");
    process.env.KIMI_HOME = join(root, "kimi");
    const shop = join(root, "work", "shop");
    const old = join(root, "work", "old");
    const api = join(root, "work", "api");
    for (const d of [shop, old, api, "claude/projects/shop", "claude/projects/old", "codex/sessions/2026/09/29"]) mkdirSync(d.startsWith(root) ? d : join(root, d), { recursive: true });

    const fresh = join(root, "claude/projects/shop/s1.jsonl");
    writeFileSync(fresh, JSON.stringify({ type: "user", cwd: join(shop, "src") }) + "\n");
    utimesSync(fresh, (now - 3600_000) / 1000, (now - 3600_000) / 1000);
    const stale = join(root, "claude/projects/old/s2.jsonl");
    writeFileSync(stale, JSON.stringify({ type: "user", cwd: old }) + "\n");
    utimesSync(stale, (now - 60 * 86400_000) / 1000, (now - 60 * 86400_000) / 1000);
    const rollout = join(root, "codex/sessions/2026/09/29/rollout-1.jsonl");
    writeFileSync(rollout, JSON.stringify({ type: "session_meta", payload: { id: "c1", cwd: api } }) + "\n");
    utimesSync(rollout, (now - 86400_000) / 1000, (now - 86400_000) / 1000);

    const found = recentProjects(30 * 86400_000, now);
    expect(found.map((r) => [r.project.replace(/\\/g, "/").split("/").pop(), r.agents])).toEqual([
      ["src", ["claude"]], // pas de .git ni de .misogi : le dossier de travail tel quel
      ["api", ["codex"]],
    ]);
  });
});

describe("préférences de la fenêtre", () => {
  it("se complètent au lieu de s'écraser, et ignorent ce qui n'est pas une courte chaîne", () => {
    process.env.MISOGI_HOME = mkdtempSync(join(tmpdir(), "prefs-"));
    saveSettings({ ui: { "misogi.theme": "feu" } });
    saveSettings({ ui: { "misogi.lang": "fr", bad: 3 as unknown as string, ["x".repeat(50)]: "clé trop longue" } });
    expect(loadSettings().ui).toEqual({ "misogi.theme": "feu", "misogi.lang": "fr" });
    expect(loadSettings().retention_days).toBe(30);
  });
});
