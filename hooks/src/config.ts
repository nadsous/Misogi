import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Agent, GlobalSettings, ProjectConfig } from "./types.js";

export const DEFAULT_CONFIG: ProjectConfig = {
  mode: "shadow",
  profile: "default",
  // Probabilité que le message annonce « fini » au-delà de laquelle un « fini » sans preuve est signalé.
  threshold: 0.7,
  state_level: "reduced",
  log_state: false,
  model: "jev-latest",
  timeout_ms: 1500,
  max_relaunches: 2,
  ask_before_relaunch: true,
  ask_timeout_ms: 12_000,
  max_state_tokens: 30_000,
  guard: { enabled: false, mode: "shadow", threshold: 0.7 },
  tickets: true,
  assist: { prompt: true, review: true, compact: true, loops: true },
};

export const DEFAULT_SETTINGS: GlobalSettings = { retention_days: 30 };

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
    // Configs d'avant la v2 : le seuil portait sur « tâche terminée » (0,5 par défaut) ; il porte maintenant
    // sur « annonce fini » (0,7). On reprend le nouveau défaut si l'ancien n'avait pas été changé.
    if (raw.config_version !== 2 && raw.threshold === 0.5) delete raw.threshold;
    return sanitize({ ...DEFAULT_CONFIG, ...raw });
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveProjectConfig(projectDir: string, patch: Partial<ProjectConfig>): ProjectConfig {
  const next = sanitize({ ...loadProjectConfig(projectDir), ...patch });
  mkdirSync(join(projectDir, ".misogi"), { recursive: true });
  writeFileSync(projectConfigPath(projectDir), JSON.stringify({ config_version: 2, ...next }, null, 2) + "\n", "utf8");
  return next;
}

const num = (v: unknown, min: number, max: number, fallback: number): number => (typeof v === "number" && v >= min && v <= max ? v : fallback);

function sanitize(c: ProjectConfig): ProjectConfig {
  const profile = c.profile === "client" ? "client" : "default";
  const g = (c.guard ?? {}) as Partial<ProjectConfig["guard"]>;
  const a = (c.assist ?? {}) as Partial<ProjectConfig["assist"]>;
  // Profil « code client » : rien du code ni de la conversation ne part, donc pas de relecture du diff ni de la demande.
  const shares = profile !== "client" && c.state_level !== "minimal";
  return {
    max_relaunches: Math.round(num(c.max_relaunches, 0, 10, DEFAULT_CONFIG.max_relaunches)),
    ask_before_relaunch: c.ask_before_relaunch !== false,
    tickets: c.tickets !== false,
    ask_timeout_ms: num(c.ask_timeout_ms, 2_000, 60_000, DEFAULT_CONFIG.ask_timeout_ms),
    max_state_tokens: num(c.max_state_tokens, 1_000, 32_000, DEFAULT_CONFIG.max_state_tokens),
    guard: {
      enabled: g.enabled === true,
      mode: g.mode === "active" ? "active" : "shadow",
      threshold: num(g.threshold, 0.1, 0.99, DEFAULT_CONFIG.guard.threshold),
    },
    assist: {
      prompt: shares && a.prompt !== false,
      review: shares && a.review !== false,
      compact: shares && a.compact !== false,
      loops: a.loops !== false,
    },
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

export function loadSettings(): GlobalSettings {
  try {
    const raw = JSON.parse(readFileSync(join(misogiHome(), "settings.json"), "utf8")) as Partial<GlobalSettings>;
    return { retention_days: Math.round(num(raw.retention_days, 0, 3650, DEFAULT_SETTINGS.retention_days)), ui: cleanUi(raw.ui) };
  } catch {
    return { ...DEFAULT_SETTINGS, ui: {} };
  }
}

/** Préférences de la fenêtre : de courtes chaînes sous des clés simples, rien d'autre. */
function cleanUi(ui: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!ui || typeof ui !== "object") return out;
  for (const [k, v] of Object.entries(ui).slice(0, 30)) if (/^[\w.-]{1,40}$/.test(k) && typeof v === "string" && v.length <= 80) out[k] = v;
  return out;
}

export function saveSettings(patch: Partial<GlobalSettings>): GlobalSettings {
  const current = loadSettings();
  // Les préférences se complètent : la fenêtre n'envoie que celle qui vient de changer.
  const next = { ...current, ...patch, ui: cleanUi({ ...current.ui, ...(patch.ui ?? {}) }) };
  next.retention_days = Math.round(num(next.retention_days, 0, 3650, DEFAULT_SETTINGS.retention_days));
  mkdirSync(misogiHome(), { recursive: true });
  writeFileSync(join(misogiHome(), "settings.json"), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
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

/** Retire un projet du registre (sans toucher à ses fichiers). */
export function forgetProject(path: string): void {
  updateProject(path, () => []);
}

// --- Projets masqués : retirés de Misogi, ils ne réapparaissent pas via leurs sessions ou le journal.

function hiddenPath(): string {
  return join(misogiHome(), "hidden-projects.json");
}

export function hiddenProjects(): string[] {
  try {
    const list = JSON.parse(readFileSync(hiddenPath(), "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function hideProject(path: string): void {
  const list = hiddenProjects().filter((p) => !samePath(p, path));
  mkdirSync(misogiHome(), { recursive: true });
  writeFileSync(hiddenPath(), JSON.stringify([...list, path], null, 2) + "\n", "utf8");
}

/** Un projet ré-ajouté à la main redevient visible. */
export function unhideProject(path: string): void {
  const list = hiddenProjects();
  const next = list.filter((p) => !samePath(p, path));
  if (next.length !== list.length) writeFileSync(hiddenPath(), JSON.stringify(next, null, 2) + "\n", "utf8");
}

export function samePath(a: string, b: string): boolean {
  const n = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
}
