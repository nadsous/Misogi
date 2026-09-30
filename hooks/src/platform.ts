// Couche plateforme : le seul endroit qui connaît les différences Windows / macOS / Linux.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import type { Agent } from "./types.js";

export const AGENT_BINARIES: Record<Agent, string> = { claude: "claude", codex: "codex", kimi: "kimi" };

export function agentHome(agent: Agent): string {
  if (agent === "claude") return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  if (agent === "codex") return process.env.CODEX_HOME || join(homedir(), ".codex");
  return process.env.KIMI_HOME || join(homedir(), ".kimi");
}

/** Cherche un exécutable dans le PATH, extensions Windows comprises. */
export function which(bin: string): string | null {
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").concat([""]) : [""];
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, bin + ext.toLowerCase());
      if (existsSync(p)) return p;
    }
  }
  return null;
}

export function detectAgents(): Record<Agent, string | null> {
  return { claude: which("claude"), codex: which("codex"), kimi: which("kimi") };
}

const rootCache = new Map<string, string>();

/**
 * Racine du projet pour un dossier de travail : l'agent peut avoir fait `cd` dans un sous-dossier
 * (ex. app/src-tauri), le projet reste celui qui contient `.misogi/config.json`, sinon `.git`.
 */
export function projectRoot(cwd: string): string {
  if (!cwd) return cwd;
  const hit = rootCache.get(cwd);
  if (hit) return hit;
  let dir = resolve(cwd);
  let gitRoot: string | null = null;
  for (let i = 0; i < 25; i++) {
    if (existsSync(join(dir, ".misogi", "config.json"))) {
      rootCache.set(cwd, dir);
      return dir;
    }
    if (!gitRoot && existsSync(join(dir, ".git"))) gitRoot = dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const root = gitRoot ?? cwd;
  rootCache.set(cwd, root);
  return root;
}

/** Chemins en barres obliques : acceptés par Node, cmd, PowerShell et Git Bash (utilisé par Kimi sous Windows). */
export function portablePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Agent lancé dans WSL, appli sous Windows : journaux Misogi des distributions WSL,
 * lus via \\wsl$\<distro>\home\<user>\.misogi\events.jsonl.
 */
export function wslLogFiles(): string[] {
  if (process.platform !== "win32") return [];
  let distros: string[];
  try {
    // wsl.exe écrit en UTF-16LE.
    const out = execFileSync("wsl.exe", ["-l", "-q"], { timeout: 2000, windowsHide: true });
    distros = out.toString("utf16le").replace(/\0/g, "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const d of distros) {
    const home = `\\\\wsl$\\${d}\\home`;
    try {
      for (const user of readdirSync(home)) {
        const f = join(home, user, ".misogi", "events.jsonl");
        if (existsSync(f)) files.push(f);
      }
    } catch {
      // distribution arrêtée ou inaccessible
    }
  }
  return files;
}
