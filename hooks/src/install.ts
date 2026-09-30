// Installation et désinstallation des hooks, agent par agent.
// Avant toute modification, le fichier de config de l'agent est sauvegardé (<fichier>.misogi-backup).
// La désinstallation retire uniquement ce que Misogi a ajouté.

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { agentEnabled, hiddenProjects, isTracked, listProjects, misogiHome, samePath, saveProjectConfig, unhideProject, updateProject } from "./config.js";
import { agentHome, portablePath } from "./platform.js";
import type { Agent } from "./types.js";

export const HOOK_SCRIPT = portablePath(fileURLToPath(new URL("./hook.js", import.meta.url)));

/**
 * Chemin du hook à écrire dans la config des agents. Lancé via `npx misogi` (cache que npm peut vider) ou par
 * l'appli desktop (dossier d'installation qui change d'une version à l'autre), on copie le hook (un seul fichier)
 * et le module du trousseau dans ~/.misogi/bin : un chemin qui survit aux mises à jour.
 */
export function stableHookScript(): string {
  const source = fileURLToPath(new URL("./hook.js", import.meta.url));
  const ephemeral = /[\\/]_npx[\\/]/.test(source) || source.toLowerCase().startsWith(tmpdir().toLowerCase());
  if (!ephemeral && process.env.MISOGI_BUNDLED !== "1") return portablePath(source);
  const bin = join(misogiHome(), "bin");
  mkdirSync(bin, { recursive: true });
  if (existsSync(source)) copyFileSync(source, join(bin, "hook.js")); // absent seulement dans les tests (sources .ts)
  // La CLI aussi : l'agent l'appelle pour misogi find / ask (voir le skill misogi-search).
  const cli = join(dirname(source), "cli.js");
  if (existsSync(cli)) copyFileSync(cli, join(bin, "cli.js"));
  writeFileSync(join(bin, "package.json"), '{ "type": "module" }\n');
  try {
    const scope = dirname(dirname(createRequire(import.meta.url).resolve("@napi-rs/keyring/package.json")));
    for (const d of readdirSync(scope).filter((n) => n === "keyring" || n.startsWith("keyring-"))) {
      const dest = join(bin, "node_modules", "@napi-rs", d);
      // Déjà là : un hook en cours d'exécution peut verrouiller le module natif (Windows).
      if (!existsSync(dest)) cpSync(join(scope, d), dest, { recursive: true });
    }
  } catch {
    // sans module natif, le hook lit la clé dans TYPESAFE_API_KEY
  }
  return portablePath(join(bin, "hook.js"));
}

/**
 * Au démarrage : réécrit les configs d'agents dont le hook pointe ailleurs que vers le chemin stable
 * (ancienne installation, ancien dossier de l'appli). Rend le nombre de fichiers mis à jour.
 */
export function refreshHooks(): number {
  const script = stableHookScript();
  if (script === HOOK_SCRIPT) return 0; // lancé depuis les sources : rien à migrer
  const hidden = hiddenProjects();
  let n = 0;
  for (const { path, agents } of listProjects()) {
    if (!existsSync(path) || hidden.some((h) => samePath(h, path))) continue;
    for (const agent of agents) {
      try {
        if (!isInstalled(agent, path)) continue;
        const text = readFileSync(configFile(agent, path), "utf8");
        // À jour : bon chemin, et pour Claude les hooks ajoutés depuis (demande, compaction).
        if (text.includes(script) && text.includes(agent === "codex" ? "codex prompt" : agent === "kimi" ? "kimi prompt" : "claude read")) continue;
        install(agent, path);
        n++;
      } catch {
        // config illisible : on laisse l'utilisateur la corriger depuis la fenêtre
      }
    }
  }
  try {
    const file = claudeGlobalSettings();
    const json = readJson(file) as HooksJson & { statusLine?: { type?: string; command?: string } };
    const command = statuslineCommand(script);
    if (isStatuslineInstalled() && json.statusLine?.command !== command) {
      writeJson(file, { ...json, statusLine: { ...json.statusLine, command } });
      n++;
    }
  } catch {
    // statusline laissée telle quelle
  }
  return n;
}
// Le guillemet est échappé (\") quand on teste le texte brut d'un fichier JSON.
const OURS = /hook\.js\\?"? (claude|codex|kimi) (stop|pretool|prompt|precompact|session|read)/;
/** Stop : assez long pour te laisser trancher depuis la fenêtre (attente réglable, 60 s au plus). */
const STOP_TIMEOUT_S = 75;
/** Avant outil : le garde-fou ne consulte Jev que pour les commandes risquées, 1,5 s au plus. */
const PRETOOL_TIMEOUT_S = 10;
/** Nom de l'outil shell pour le matcher du hook avant outil. */
const SHELL_MATCHER: Record<Agent, string> = { claude: "Bash", codex: "Bash", kimi: "Shell" };

/** Relire la demande, garder les consignes à la compaction : hooks propres à Claude Code (format vérifié). */
const PROMPT_TIMEOUT_S = 10;
const COMPACT_TIMEOUT_S = 20;

export function hookCommand(agent: Agent, script = stableHookScript(), hook: "stop" | "pretool" | "prompt" | "precompact" | "session" | "read" = "stop"): string {
  return `node "${script}" ${agent} ${hook}${agent === "kimi" ? " --tracked-only" : ""}`;
}

/** Fichier de config touché pour cet agent et ce projet. */
export function configFile(agent: Agent, project: string): string {
  // settings.local.json : propre à ta machine (le chemin du hook y est absolu), jamais commité.
  if (agent === "claude") return join(project, ".claude", "settings.local.json");
  if (agent === "codex") return join(project, ".codex", "hooks.json");
  // Kimi ne lit ses hooks que dans la config globale ; le hook filtre ensuite les projets suivis.
  return join(agentHome("kimi"), "config.toml");
}

export interface InstallResult {
  file: string;
  backup: string | null;
  command: string;
}

/** Ce que l'installation va écrire, pour l'afficher avant d'agir. */
export function preview(agent: Agent, project: string): { file: string; command: string } {
  return { file: configFile(agent, resolve(project)), command: hookCommand(agent) };
}

export function install(agent: Agent, project: string): InstallResult {
  project = resolve(project);
  const file = configFile(agent, project);
  const script = stableHookScript();
  const command = hookCommand(agent, script);
  const backup = backupOnce(file);
  const pretool = hookCommand(agent, script, "pretool");
  // Recherche par le sens (misogi find / ask) : un skill dans le dossier de skills de chaque agent.
  installSearchSkill(script, agent);
  if (agent === "claude") {
    removeFromJsonFile(legacyClaudeFile(project));
  }
  if (agent === "kimi") writeFileSync(file, addKimiHook(readOr(file, ""), command, pretool, hookCommand("kimi", script, "read"), hookCommand("kimi", script, "prompt")), "utf8");
  else writeJson(file, addJsonHook(readJson(file), command, pretool, SHELL_MATCHER[agent], agent === "claude" ? claudeExtras(script) : codexExtras(script)));
  if (!isTracked(project)) saveProjectConfig(project, {});
  updateProject(project, (a) => [...new Set([...a, agent])]);
  unhideProject(project);
  return { file, backup, command };
}

/** Anciennes versions : le hook Claude était écrit dans .claude/settings.json. */
function legacyClaudeFile(project: string): string {
  return join(project, ".claude", "settings.json");
}

function removeFromJsonFile(file: string): boolean {
  if (!existsSync(file)) return false;
  const before = readFileSync(file, "utf8");
  const json = removeJsonHook(readJson(file));
  const changed = JSON.stringify(json) !== JSON.stringify(JSON.parse(before || "{}"));
  if (changed) writeJson(file, json);
  rmSync(file + ".misogi-backup", { force: true });
  return changed;
}

export function uninstall(agent: Agent, project: string): { file: string; changed: boolean } {
  project = resolve(project);
  const file = configFile(agent, project);
  updateProject(project, (a) => a.filter((x) => x !== agent));
  // Plus aucun projet avec Claude : le skill de recherche n'a plus de raison d'être.
  if (!listProjects().some((p) => p.agents.includes(agent))) rmSync(searchSkillDir(agent), { recursive: true, force: true });
  // Sans hooks, plus de décision de routage : Claude Code ne doit plus passer par Misogi.
  if (agent === "claude") {
    try {
      setRouterEnv(project, false);
    } catch {
      // settings.local.json illisible : laissé tel quel
    }
  }
  const legacy = agent === "claude" && removeFromJsonFile(legacyClaudeFile(project));
  if (!existsSync(file)) return { file, changed: legacy };
  const before = readFileSync(file, "utf8");
  if (agent === "kimi") {
    // Les hooks de Kimi sont globaux : on ne retire le bloc que si plus aucun projet suivi n'utilise Kimi.
    // Le hook filtre déjà les projets (--tracked-only) : ce projet-ci n'est plus suivi par Kimi.
    if (listProjects().some((p) => p.agents.includes("kimi"))) return { file, changed: false };
    const after = removeKimiHook(before);
    if (after !== before) writeFileSync(file, after, "utf8");
    return { file, changed: after !== before };
  }
  return { file, changed: removeFromJsonFile(file) || legacy };
}

export function isInstalled(agent: Agent, project: string): boolean {
  const file = configFile(agent, resolve(project));
  if (agent === "claude" && existsSync(legacyClaudeFile(resolve(project))) && OURS.test(readFileSync(legacyClaudeFile(resolve(project)), "utf8"))) return true;
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "utf8");
  return agent === "kimi" ? text.includes(KIMI_BEGIN) && agentEnabled(resolve(project), "kimi") : OURS.test(text);
}

// --- Statusline Claude (globale) : donne à Misogi les quotas 5 h / 7 j du forfait.
// La statusline existante n'est pas perdue : elle est gardée dans ~/.misogi/statusline-prev.json et appelée à la suite.

function claudeGlobalSettings(): string {
  return join(agentHome("claude"), "settings.json");
}

function prevStatuslineFile(): string {
  return join(misogiHome(), "statusline-prev.json");
}

export function statuslineCommand(script = stableHookScript()): string {
  return `node "${script}" claude statusline`;
}

export function previousStatusline(): string | null {
  try {
    const prev = JSON.parse(readFileSync(prevStatuslineFile(), "utf8")) as { command?: string } | null;
    return prev?.command ?? null;
  } catch {
    return null;
  }
}

export function isStatuslineInstalled(): boolean {
  try {
    const cmd = (readJson(claudeGlobalSettings()) as { statusLine?: { command?: string } }).statusLine?.command ?? "";
    return /hook\.js"? claude statusline/.test(cmd);
  } catch {
    return false;
  }
}

export function installStatusline(): { file: string; kept: string | null } {
  const file = claudeGlobalSettings();
  const json = readJson(file) as HooksJson & { statusLine?: { type?: string; command?: string } };
  if (isStatuslineInstalled()) return { file, kept: previousStatusline() };
  backupOnce(file);
  const kept = json.statusLine?.command ?? null;
  mkdirSync(misogiHome(), { recursive: true });
  writeFileSync(prevStatuslineFile(), JSON.stringify(json.statusLine ?? null));
  writeJson(file, { ...json, statusLine: { type: "command", command: statuslineCommand() } });
  return { file, kept };
}

export function uninstallStatusline(): { file: string; changed: boolean } {
  const file = claudeGlobalSettings();
  if (!isStatuslineInstalled()) return { file, changed: false };
  const json = readJson(file) as HooksJson & { statusLine?: unknown };
  let prev: unknown = null;
  try {
    prev = JSON.parse(readFileSync(prevStatuslineFile(), "utf8"));
  } catch {
    // rien à restaurer
  }
  const next: Record<string, unknown> = { ...json };
  if (prev) next.statusLine = prev;
  else delete next.statusLine;
  writeJson(file, next as HooksJson);
  rmSync(prevStatuslineFile(), { force: true });
  return { file, changed: true };
}

// --- Claude et Codex : même structure JSON { hooks: { Stop: [{ hooks: [{ type, command, timeout }] }] } }

type HookGroup = { matcher?: string; hooks?: { type?: string; command?: string; timeout?: number }[] };
type HooksJson = { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>;

/** Hooks en plus pour Claude Code : événement → groupe (matcher éventuel, commande, délai). */
type Extras = Record<string, { matcher?: string; command: string; timeout: number } | { matcher?: string; command: string; timeout: number }[]>;

/** Codex : relire la demande (et choisir le modèle si Codex passe par le relais). */
function codexExtras(script: string): Extras {
  return { UserPromptSubmit: { command: hookCommand("codex", script, "prompt"), timeout: PROMPT_TIMEOUT_S } };
}

function claudeExtras(script: string): Extras {
  return {
    UserPromptSubmit: { command: hookCommand("claude", script, "prompt"), timeout: PROMPT_TIMEOUT_S },
    PreCompact: { command: hookCommand("claude", script, "precompact"), timeout: COMPACT_TIMEOUT_S },
    SessionStart: { matcher: "compact", command: hookCommand("claude", script, "session"), timeout: 5 },
    // Lecture ciblée : un groupe à part, à côté du garde-fou shell (matcher Bash).
    PreToolUse: { matcher: "Read", command: hookCommand("claude", script, "read"), timeout: 10 },
  };
}

export function addJsonHook(json: HooksJson, command: string, pretool?: string, matcher = "Bash", extras?: Extras): HooksJson {
  const clean = removeJsonHook(json);
  const hooks = { ...(clean.hooks ?? {}) };
  for (const [event, list] of Object.entries(extras ?? {})) {
    for (const h of Array.isArray(list) ? list : [list]) {
      hooks[event] = [...(hooks[event] ?? []), { ...(h.matcher ? { matcher: h.matcher } : {}), hooks: [{ type: "command", command: h.command, timeout: h.timeout }] }];
    }
  }
  hooks.Stop = [...(hooks.Stop ?? []), { hooks: [{ type: "command", command, timeout: STOP_TIMEOUT_S }] }];
  if (pretool) hooks.PreToolUse = [...(hooks.PreToolUse ?? []), { matcher, hooks: [{ type: "command", command: pretool, timeout: PRETOOL_TIMEOUT_S }] }];
  return { ...clean, hooks };
}

export function removeJsonHook(json: HooksJson): HooksJson {
  if (!json.hooks) return json;
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(json.hooks)) {
    const kept = (groups ?? []).map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !OURS.test(h.command ?? "")) })).filter((g) => g.hooks.length > 0);
    if (kept.length) hooks[event] = kept;
  }
  const out: HooksJson = { ...json, hooks };
  if (!Object.keys(hooks).length) delete out.hooks;
  return out;
}

// --- Kimi : bloc [[hooks]] délimité par des marqueurs dans ~/.kimi/config.toml

const KIMI_BEGIN = "# >>> misogi";
const KIMI_END = "# <<< misogi";
const EMPTY_HOOKS = /^hooks[ \t]*=[ \t]*\[[ \t]*\][ \t]*(\r?\n|$)/m;

export function addKimiHook(toml: string, command: string, pretool?: string, read?: string, prompt?: string): string {
  let text = removeKimiHook(toml);
  let note = "";
  if (EMPTY_HOOKS.test(text)) {
    // `hooks = []` et `[[hooks]]` ne peuvent pas coexister : on retire la ligne et on note sa place.
    const line = text.slice(0, text.search(EMPTY_HOOKS)).split("\n").length;
    text = text.replace(EMPTY_HOOKS, "");
    note = ` (a remplacé « hooks = [] » ligne ${line})`;
  } else if (/^hooks\s*=\s*\[/m.test(text)) {
    throw new Error("~/.kimi/config.toml déclare « hooks = [...] » en ligne : passe-les au format [[hooks]] puis relance");
  }
  const lines = [KIMI_BEGIN + note, "[[hooks]]", 'event = "Stop"', `command = '${command}'`, `timeout = ${STOP_TIMEOUT_S}`];
  if (pretool) lines.push("", "[[hooks]]", 'event = "PreToolUse"', `matcher = "${SHELL_MATCHER.kimi}"`, `command = '${pretool}'`, `timeout = ${PRETOOL_TIMEOUT_S}`);
  // Lecture ciblée : Kimi lit avec ReadFile ; Misogi redirige vers la partie utile des gros fichiers.
  if (read) lines.push("", "[[hooks]]", 'event = "PreToolUse"', 'matcher = "ReadFile"', `command = '${read}'`, `timeout = ${PRETOOL_TIMEOUT_S}`);
  // Relire la demande (et choisir le modèle si Kimi passe par le relais).
  if (prompt) lines.push("", "[[hooks]]", 'event = "UserPromptSubmit"', `command = '${prompt}'`, `timeout = ${PROMPT_TIMEOUT_S}`);
  const block = [...lines, KIMI_END].join("\n");
  const out = text.replace(/\s*$/, "") + "\n\n" + block + "\n";
  parseToml(out); // lève une erreur plutôt que d'écrire une config cassée
  return out;
}

export function removeKimiHook(toml: string): string {
  const start = toml.indexOf(KIMI_BEGIN);
  if (start === -1) return toml;
  const end = toml.indexOf(KIMI_END, start);
  const header = toml.slice(start, toml.indexOf("\n", start));
  let text = (toml.slice(0, start).replace(/\s*$/, "") + "\n" + toml.slice(end === -1 ? toml.length : end + KIMI_END.length).replace(/^\s*/, "\n")).replace(/\n+$/, "\n");
  const line = /ligne (\d+)/.exec(header)?.[1];
  if (line && !/^\[\[hooks\]\]/m.test(text)) {
    const lines = text.split("\n");
    lines.splice(Number(line) - 1, 0, "hooks = []");
    text = lines.join("\n");
  }
  return text;
}

// --- fichiers

function backupOnce(file: string): string | null {
  if (!existsSync(file)) return null;
  const backup = file + ".misogi-backup";
  if (!existsSync(backup)) copyFileSync(file, backup);
  return backup;
}

function readOr(file: string, fallback: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : fallback;
}

function readJson(file: string): HooksJson {
  const text = readOr(file, "").trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as HooksJson;
  } catch {
    throw new Error(`${file} n'est pas un JSON valide : corrige-le avant d'installer`);
  }
}

function writeJson(file: string, json: HooksJson): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n", "utf8");
}

// --- Skill « misogi-search » (Claude Code) : dit à l'agent quand et comment utiliser misogi find / ask.

export function searchSkillDir(agent: Agent = "claude"): string {
  return join(agentHome(agent), "skills", "misogi-search");
}

export function searchSkill(cli: string): string {
  return `---
name: misogi-search
description: Find code by describing what it does, or ask a yes/no question across many files, without reading them into your context. Use it when you don't know a symbol's name or grep finds nothing (the wording differs, another language), or to audit a property over a directory (e.g. which files build SQL by string concatenation).
---

# Recherche par le sens (Misogi + Jev)

Run from the project folder:

- \`node "${cli}" find "<what the code does>" [folder] [-n 5]\`: files and lines that match, best first.
- \`node "${cli}" ask "<yes/no question>" [folder]\`: files for which the answer is yes, with the line.

Each result line reads \`score  path:line\`; scores are probabilities, so open the cited line when it matters.
"aucune correspondance" is a real answer: the thing described probably doesn't exist in the project.
Grep stays better for an exact name you already know: it is instant and free.
Each search shows up in the user's Misogi window.
`;
}

export function installSearchSkill(script: string, agent: Agent = "claude"): void {
  try {
    const dir = searchSkillDir(agent);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), searchSkill(script.replace(/hook\.js$/, "cli.js")), "utf8");
  } catch {
    // sans skill, l'agent peut toujours lancer misogi find / ask si on le lui demande
  }
}

// --- Routeur : Claude Code passe par Misogi pour ce projet (variables d'environnement de settings.local.json).

const ROUTER_ENV = { ANTHROPIC_BASE_URL: "http://127.0.0.1:4318", CLAUDE_CODE_GATEWAY_HINT_HEADERS: "1" };

export function setRouterEnv(project: string, on: boolean): void {
  const file = configFile("claude", resolve(project));
  const json = readJson(file) as HooksJson & { env?: Record<string, string> };
  const env = { ...(json.env ?? {}) };
  const current = env.ANTHROPIC_BASE_URL;
  if (on) {
    // Une passerelle d'entreprise est déjà là : la remplacer enverrait ses identifiants à Anthropic.
    if (current && current !== ROUTER_ENV.ANTHROPIC_BASE_URL) throw new Error(`ce projet passe déjà par ${current} : retire-le d'abord de .claude/settings.local.json`);
    Object.assign(env, ROUTER_ENV);
  } else if (current === ROUTER_ENV.ANTHROPIC_BASE_URL) {
    delete env.ANTHROPIC_BASE_URL;
    delete env.CLAUDE_CODE_GATEWAY_HINT_HEADERS;
  }
  const next: HooksJson & { env?: Record<string, string> } = { ...json, env };
  if (!Object.keys(env).length) delete next.env;
  backupOnce(file);
  writeJson(file, next);
}

export function routerEnvSet(project: string): boolean {
  try {
    return (readJson(configFile("claude", resolve(project))) as { env?: Record<string, string> }).env?.ANTHROPIC_BASE_URL === ROUTER_ENV.ANTHROPIC_BASE_URL;
  } catch {
    return false;
  }
}
