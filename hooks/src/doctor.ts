// `misogi doctor` : vérifie la clé, les hooks et le journal, et dit quoi corriger en une phrase.

import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isTracked, loadProjectConfig, misogiHome, mockEnabled } from "./config.js";
import { askJev } from "./jev.js";
import { getApiKey } from "./keys.js";
import { isInstalled } from "./install.js";
import { logPath } from "./log.js";
import { detectAgents } from "./platform.js";
import { parseJsonl } from "./adapters/common.js";
import type { Agent, MisogiEvent } from "./types.js";

export interface Check {
  ok: boolean;
  label: string;
  /** Quoi faire, en une phrase, si ça ne va pas. */
  fix?: string;
  warn?: boolean;
}

export async function doctor(projectDir: string, opts: { ping?: boolean } = {}): Promise<Check[]> {
  const project = resolve(projectDir);
  const checks: Check[] = [];

  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ ok: major >= 20, label: `Node ${process.versions.node}`, fix: "Installe Node 20 ou plus récent : les hooks tournent avec `node`." });

  try {
    mkdirSync(misogiHome(), { recursive: true });
    accessSync(misogiHome(), constants.W_OK);
    const events = existsSync(logPath()) ? parseJsonl<MisogiEvent>(readFileSync(logPath(), "utf8")) : [];
    const last = events.at(-1);
    const errors = events.slice(-20).filter((e) => e.decision === "error");
    checks.push({ ok: true, label: `Journal ${logPath()} : ${events.length} décision(s)${last ? `, dernière ${last.ts}` : ""}` });
    if (errors.length) {
      checks.push({ ok: false, warn: true, label: `${errors.length} erreur(s) sur les 20 dernières décisions`, fix: `Dernière erreur : ${errors.at(-1)!.reason}` });
    }
  } catch (err) {
    checks.push({ ok: false, label: `Journal ${misogiHome()} non accessible`, fix: `Vérifie les droits du dossier (${(err as Error).message}).` });
  }

  const tracked = isTracked(project);
  const config = loadProjectConfig(project);
  checks.push({
    ok: tracked,
    warn: !tracked,
    label: tracked ? `Projet suivi : ${project} (mode ${config.mode}, state ${config.state_level}${config.profile === "client" ? ", profil code client" : ""})` : `Projet non suivi : ${project}`,
    fix: "Lance `misogi install <agent>` dans ce projet.",
  });

  const agents = detectAgents();
  for (const agent of Object.keys(agents) as Agent[]) {
    if (!agents[agent]) continue;
    const installed = isInstalled(agent, project);
    checks.push({ ok: installed, warn: !installed, label: `${agent} trouvé, hook Stop ${installed ? "installé" : "absent"} pour ce projet`, fix: `Lance \`misogi install ${agent}\` pour l'activer.` });
  }
  if (!Object.values(agents).some(Boolean)) {
    checks.push({ ok: false, label: "Aucun agent trouvé dans le PATH (claude, codex, kimi)", fix: "Installe un agent ou ajoute-le au PATH." });
  }

  const { key, source } = await getApiKey(project);
  if (mockEnabled()) checks.push({ ok: true, warn: true, label: "MISOGI_MOCK actif : aucune requête n'est envoyée à Jev" });
  else checks.push({ ok: !!key, label: key ? `Clé TypeSafe trouvée (${source === "env" ? "variable TYPESAFE_API_KEY" : "trousseau du système"})` : "Aucune clé TypeSafe", fix: "Lance `misogi key set` dans ce projet (clé sur https://console.typesafe.ai)." });

  if (opts.ping && key) {
    const started = Date.now();
    try {
      await askJev({ state: "ping", model: config.model, questions: { ok: { type: "noul", instructions: "Is this a ping?" } } }, { apiKey: key, timeoutMs: 5000 });
      checks.push({ ok: true, label: `Jev répond (${Date.now() - started} ms)` });
    } catch (err) {
      checks.push({ ok: false, label: "Jev ne répond pas", fix: (err as Error).message });
    }
  }
  return checks;
}

export function formatChecks(checks: Check[]): string {
  return checks.map((c) => `${c.ok ? "✓" : c.warn ? "!" : "✗"} ${c.label}${!c.ok && c.fix ? `\n    → ${c.fix}` : ""}`).join("\n");
}
