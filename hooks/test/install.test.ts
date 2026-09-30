import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listProjects } from "../src/config.js";
import { addKimiHook, hookCommand, install, installStatusline, refreshHooks, isInstalled, isStatuslineInstalled, previousStatusline, removeKimiHook, uninstall, uninstallStatusline } from "../src/install.js";

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "misogi-proj-"));
  process.env.MISOGI_HOME = mkdtempSync(join(tmpdir(), "misogi-home-"));
  process.env.KIMI_HOME = mkdtempSync(join(tmpdir(), "kimi-home-"));
  // Jamais la vraie config Claude (~/.claude/settings.json) : la statusline y est globale.
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "claude-home-"));
});

afterEach(() => {
  delete process.env.MISOGI_HOME;
  delete process.env.KIMI_HOME;
  delete process.env.CLAUDE_CONFIG_DIR;
});

describe("hooks après une mise à jour de l'appli", () => {
  it("réécrit les configs qui pointent vers l'ancien dossier d'installation", () => {
    const settings = join(project, ".claude", "settings.local.json");
    install("claude", project);
    const old = readFileSync(settings, "utf8").replaceAll(hookCommand("claude").split('"')[1]!, "C:/Program Files/Misogi/misogi/hook.js");
    writeFileSync(settings, old);
    process.env.MISOGI_BUNDLED = "1";
    try {
      expect(refreshHooks()).toBe(1);
      const cmd = JSON.parse(readFileSync(settings, "utf8")).hooks.Stop[0].hooks[0].command as string;
      expect(cmd).toContain(join(process.env.MISOGI_HOME!, "bin").replaceAll("\\", "/"));
      expect(cmd).not.toContain("Program Files");
      expect(refreshHooks()).toBe(0); // déjà à jour
    } finally {
      delete process.env.MISOGI_BUNDLED;
    }
  });
});

describe("installation Claude / Codex", () => {
  it("ajoute le hook sans toucher au reste, sauvegarde, puis restaure", () => {
    const settings = join(project, ".claude", "settings.local.json");
    mkdirSync(join(project, ".claude"));
    const original = { permissions: { allow: ["Bash(npm test)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo fini" }] }] } };
    writeFileSync(settings, JSON.stringify(original));

    const r = install("claude", project);
    expect(r.backup).toBe(settings + ".misogi-backup");
    const after = JSON.parse(readFileSync(settings, "utf8"));
    expect(after.permissions).toEqual(original.permissions);
    expect(after.hooks.Stop).toHaveLength(2);
    expect(after.hooks.Stop[1].hooks[0].command).toBe(hookCommand("claude"));
    expect(isInstalled("claude", project)).toBe(true);
    expect(existsSync(join(project, ".misogi", "config.json"))).toBe(true);
    expect(listProjects()[0]?.agents).toEqual(["claude"]);

    install("claude", project); // idempotent
    expect(JSON.parse(readFileSync(settings, "utf8")).hooks.Stop).toHaveLength(2);

    uninstall("claude", project);
    expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual(original);
    expect(existsSync(r.backup!)).toBe(false);
    expect(listProjects()).toEqual([]);
  });

  it("migre une ancienne installation de settings.json vers settings.local.json (jamais commité)", () => {
    mkdirSync(join(project, ".claude"));
    const shared = join(project, ".claude", "settings.json");
    writeFileSync(shared, JSON.stringify({ permissions: { allow: [] }, hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "C:/old/hook.js" claude stop' }] }] } }));
    expect(isInstalled("claude", project)).toBe(true);
    install("claude", project);
    expect(JSON.parse(readFileSync(shared, "utf8"))).toEqual({ permissions: { allow: [] } });
    expect(readFileSync(join(project, ".claude", "settings.local.json"), "utf8")).toContain("claude stop");
  });

  it("Codex : crée .codex/hooks.json", () => {
    install("codex", project);
    const json = JSON.parse(readFileSync(join(project, ".codex", "hooks.json"), "utf8"));
    expect(json.hooks.Stop[0].hooks[0].command).toContain("codex stop");
    uninstall("codex", project);
    expect(JSON.parse(readFileSync(join(project, ".codex", "hooks.json"), "utf8"))).toEqual({});
  });

  it("refuse un settings.json invalide plutôt que de l'écraser", () => {
    mkdirSync(join(project, ".claude"));
    writeFileSync(join(project, ".claude", "settings.json"), "{ cassé");
    expect(() => install("claude", project)).toThrow(/JSON valide/);
  });
});

describe("statusline Claude (quotas)", () => {
  it("s'installe en gardant la statusline existante, puis la restaure", () => {
    const home = mkdtempSync(join(tmpdir(), "claude-home-"));
    process.env.CLAUDE_CONFIG_DIR = home;
    const original = { model: "opus", statusLine: { type: "command", command: "echo mine" } };
    writeFileSync(join(home, "settings.json"), JSON.stringify(original));
    try {
      const r = installStatusline();
      expect(r.kept).toBe("echo mine");
      expect(isStatuslineInstalled()).toBe(true);
      expect(previousStatusline()).toBe("echo mine");
      expect(JSON.parse(readFileSync(join(home, "settings.json"), "utf8")).model).toBe("opus");
      uninstallStatusline();
      expect(JSON.parse(readFileSync(join(home, "settings.json"), "utf8"))).toEqual(original);
    } finally {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
  });
});

describe("installation Kimi", () => {
  const config = 'default_model = "k"\nhooks = []\nmerge_all_available_skills = false\n\n[models."k"]\nprovider = "p"\n';

  it("remplace hooks = [] par un bloc [[hooks]] valide, puis remet l'original", () => {
    const withHook = addKimiHook(config, 'node "C:/x/hook.js" kimi stop --tracked-only');
    const parsed = parse(withHook) as { hooks: { event: string; command: string }[]; default_model: string };
    expect(parsed.default_model).toBe("k");
    expect(parsed.hooks).toEqual([{ event: "Stop", command: 'node "C:/x/hook.js" kimi stop --tracked-only', timeout: 75 }]);
    expect(removeKimiHook(withHook)).toBe(config);
  });

  it("n'agit que sur les projets suivis", () => {
    expect(hookCommand("kimi")).toContain("--tracked-only");
  });

  it("refuse des hooks déclarés en ligne", () => {
    expect(() => addKimiHook('hooks = [{ event = "Stop", command = "x" }]\n', "c")).toThrow(/\[\[hooks\]\]/);
  });

  it("écrit dans ~/.kimi/config.toml", () => {
    writeFileSync(join(process.env.KIMI_HOME!, "config.toml"), config);
    install("kimi", project);
    expect(isInstalled("kimi", project)).toBe(true);
    uninstall("kimi", project);
    expect(readFileSync(join(process.env.KIMI_HOME!, "config.toml"), "utf8")).toBe(config);
  });
});
