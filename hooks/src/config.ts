import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Agent, ProjectConfig } from "./types.js";

export const DEFAULT_CONFIG: ProjectConfig = {
  mode: "shadow",
  profile: "default",
  threshold: 0.5,
  state_level: "reduced",
  log_state: false,
  model: "jev-latest",
  timeout_ms: 1500,
};

/** Dossier des données Misogi (journal, etc.). */
export function misogiHome(): string {
  return process.env.MISOGI_HOME || join(homedir(), ".misogi");
}

export function projectConfigPath(projectDir: string): string {
  return join(projectDir, ".misogi", "config.json");
}

/** Un projet est suivi dès qu'il a un `.misogi/config.json` (créé par `misogi install`). */
export function isTracked(projectDir: string): boolean {
  return existsSync(projectConfigPath(projectDir));
}

/** Réglages du projet : `<projet>/.misogi/config.json`, sinon les valeurs par défaut sûres. */
export function loadProjectConfig(projectDir: string): ProjectConfig {
  try {
    const raw = JSON.parse(readFileSync(projectConfigPath(projectDir), "utf8"));
    return sanitize({ ...DEFAULT_CONFIG, ...raw });
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveProjectConfig(projectDir: string, patch: Partial<ProjectConfig>): ProjectConfig {
  const next = sanitize({ ...loadProjectConfig(projectDir), ...patch });
  mkdirSync(join(projectDir, ".misogi"), { recursive: true });
  writeFileSync(projectConfigPath(projectDir), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

function sanitize(c: ProjectConfig): ProjectConfig {
  const profile = c.profile === "client" ? "client" : "default";
  return {
    mode: c.mode === "active" ? "active" : "shadow",
    profile,
    threshold: typeof c.threshold === "number" && c.threshold >= 0 && c.threshold <= 1 ? c.threshold : DEFAULT_CONFIG.threshold,
    state_level: profile === "client" ? "minimal" : ["full", "reduced", "minimal"].includes(c.state_level) ? c.state_level : DEFAULT_CONFIG.state_level,
    log_state: profile === "client" ? false : c.log_state === true,
    model: typeof c.model === "string" && c.model ? c.model : DEFAULT_CONFIG.model,
    timeout_ms: typeof c.timeout_ms === "number" && c.timeout_ms > 0 ? c.timeout_ms : DEFAULT_CONFIG.timeout_ms,
  };
}

export function mockEnabled(): boolean {
  return process.env.MISOGI_MOCK === "1" || process.env.MISOGI_MOCK === "true";
}

// --- Registre des projets suivis (~/.misogi/projects.json), pour « Tout désinstaller » et la colonne des projets.

export interface ProjectEntry {
  path: string;
  agents: Agent[];
}

function registryPath(): string {
  return join(misogiHome(), "projects.json");
}

export function listProjects(): ProjectEntry[] {
  try {
    const list = JSON.parse(readFileSync(registryPath(), "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function updateProject(path: string, agents: (current: Agent[]) => Agent[]): void {
  const list = listProjects();
  const i = list.findIndex((p) => samePath(p.path, path));
  const next = agents(i === -1 ? [] : list[i]!.agents);
  if (i === -1 && next.length) list.push({ path, agents: next });
  else if (i !== -1 && next.length) list[i] = { path: list[i]!.path, agents: next };
  else if (i !== -1) list.splice(i, 1);
  mkdirSync(misogiHome(), { recursive: true });
  writeFileSync(registryPath(), JSON.stringify(list, null, 2) + "\n", "utf8");
}

export function samePath(a: string, b: string): boolean {
  const n = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
}
