// « Ce qui guide ton agent » : les fichiers souvent invisibles qui orientent son travail
// (instructions, skills, sous-agents, commandes, hooks, serveurs MCP), dans le projet et en global.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { agentHome } from "./platform.js";
import type { Agent } from "./types.js";

export type GuideKind = "instructions" | "skill" | "agent" | "command" | "hook" | "mcp";

export interface Guide {
  agent: Agent | "all";
  kind: GuideKind;
  name: string;
  path: string;
  scope: "project" | "global";
  updatedAt: number;
  /** Détail court : nombre de hooks, de serveurs, taille... */
  detail?: string;
}

function stat(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function ls(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function json(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function file(out: Guide[], g: Omit<Guide, "updatedAt">): void {
  const at = stat(g.path);
  if (at !== null) out.push({ ...g, updatedAt: at });
}

function kb(path: string): string {
  try {
    return `${Math.max(1, Math.round(statSync(path).size / 1024))} Ko`;
  } catch {
    return "";
  }
}

function dirEntries(out: Guide[], dir: string, kind: GuideKind, agent: Agent, scope: Guide["scope"]): void {
  for (const n of ls(dir)) {
    const path = join(dir, n);
    if (n.startsWith(".")) continue;
    const md = existsSync(join(path, "SKILL.md")) ? join(path, "SKILL.md") : path;
    file(out, { agent, kind, name: n.replace(/\.md$/, ""), path: md, scope });
  }
}

function hooksOf(out: Guide[], path: string, agent: Agent, scope: Guide["scope"]): void {
  const hooks = (json(path)?.hooks ?? {}) as Record<string, { hooks?: unknown[] }[]>;
  for (const [event, groups] of Object.entries(hooks)) {
    const n = (groups ?? []).reduce((k, g) => k + (g.hooks?.length ?? 0), 0);
    if (n) file(out, { agent, kind: "hook", name: event, path, scope, detail: `${n} hook${n > 1 ? "s" : ""}` });
  }
}

function mcpOf(out: Guide[], path: string, agent: Agent, scope: Guide["scope"]): void {
  const servers = Object.keys(((json(path)?.mcpServers ?? {}) as Record<string, unknown>) ?? {});
  if (servers.length) file(out, { agent, kind: "mcp", name: servers.join(", "), path, scope, detail: `${servers.length} serveur${servers.length > 1 ? "s" : ""}` });
}

export function listGuides(projectDir: string): Guide[] {
  const out: Guide[] = [];
  const claudeHome = agentHome("claude");
  const kimiHome = agentHome("kimi");
  const codexHome = agentHome("codex");

  // Instructions
  for (const [name, agent] of [["CLAUDE.md", "claude"], ["CLAUDE.local.md", "claude"], [".claude/CLAUDE.md", "claude"], ["AGENTS.md", "all"], [".cursorrules", "all"], ["GEMINI.md", "all"]] as const) {
    const path = join(projectDir, name);
    file(out, { agent, kind: "instructions", name, path, scope: "project", detail: kb(path) });
  }
  file(out, { agent: "claude", kind: "instructions", name: "CLAUDE.md", path: join(claudeHome, "CLAUDE.md"), scope: "global", detail: kb(join(claudeHome, "CLAUDE.md")) });
  file(out, { agent: "codex", kind: "instructions", name: "AGENTS.md", path: join(codexHome, "AGENTS.md"), scope: "global", detail: kb(join(codexHome, "AGENTS.md")) });

  // Skills, sous-agents, commandes
  for (const [base, scope] of [[join(projectDir, ".claude"), "project"], [claudeHome, "global"]] as const) {
    dirEntries(out, join(base, "skills"), "skill", "claude", scope);
    dirEntries(out, join(base, "agents"), "agent", "claude", scope);
    dirEntries(out, join(base, "commands"), "command", "claude", scope);
  }
  dirEntries(out, join(codexHome, "skills"), "skill", "codex", "global");

  // Hooks et MCP
  hooksOf(out, join(projectDir, ".claude", "settings.json"), "claude", "project");
  hooksOf(out, join(projectDir, ".claude", "settings.local.json"), "claude", "project");
  hooksOf(out, join(claudeHome, "settings.json"), "claude", "global");
  hooksOf(out, join(projectDir, ".codex", "hooks.json"), "codex", "project");
  mcpOf(out, join(projectDir, ".mcp.json"), "claude", "project");
  mcpOf(out, join(kimiHome, "mcp.json"), "kimi", "global");
  const kimiToml = join(kimiHome, "config.toml");
  if (existsSync(kimiToml)) {
    const n = (readFileSync(kimiToml, "utf8").match(/^\[\[hooks\]\]/gm) ?? []).length;
    if (n) file(out, { agent: "kimi", kind: "hook", name: "config.toml", path: kimiToml, scope: "global", detail: `${n} hook${n > 1 ? "s" : ""}` });
  }

  const order: GuideKind[] = ["instructions", "hook", "skill", "agent", "command", "mcp"];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.scope === b.scope ? 0 : a.scope === "project" ? -1 : 1) || b.updatedAt - a.updatedAt);
}
