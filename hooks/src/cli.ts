#!/usr/bin/env node
// CLI `misogi` : install, uninstall, doctor, key, serve.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAgent } from "./adapters/index.js";
import { listProjects } from "./config.js";
import { doctor, formatChecks } from "./doctor.js";
import { HOOK_SCRIPT, install, preview, uninstall } from "./install.js";
import { deleteApiKey, setApiKey } from "./keys.js";
import { detectAgents } from "./platform.js";
import { DEFAULT_PORT, startServer } from "./server.js";
import type { Agent } from "./types.js";

const HELP = `misogi — voir ce que Jev pense de chaque décision de ton agent

  misogi install [claude|codex|kimi|all]   installe le hook Stop dans le projet courant (sauvegarde la config avant)
  misogi uninstall [agent|all] [--all-projects]  retire les hooks et remet les configs comme avant
  misogi doctor [--ping]                    vérifie clé, hooks et journal
  misogi key set [clé]                      range la clé TypeSafe du projet dans le trousseau (sinon lue sur stdin)
  misogi key delete
  misogi serve [--port ${DEFAULT_PORT}] [--static <dossier>]  fenêtre dans le navigateur, journal en direct

  --project <dossier>   projet visé (défaut : dossier courant)
  --dry-run             pour install : affiche ce qui serait écrit, sans rien toucher`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

function agentsFrom(arg: string | undefined): Agent[] {
  if (isAgent(arg)) return [arg];
  if (arg === undefined || arg === "all") {
    const found = detectAgents();
    return (Object.keys(found) as Agent[]).filter((a) => found[a]);
  }
  throw new Error(`agent inconnu « ${arg} » (claude, codex, kimi ou all)`);
}

async function main(): Promise<number> {
  const [cmd, ...args] = process.argv.slice(2);
  const valued = new Set(["--project", "--port", "--static"]);
  const positional = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1] ?? ""));
  const project = resolve(flag(args, "--project") ?? process.cwd());

  switch (cmd) {
    case "install": {
      const agents = agentsFrom(positional[0]);
      if (!agents.length) throw new Error("aucun agent trouvé dans le PATH");
      for (const agent of agents) {
        if (args.includes("--dry-run")) {
          const p = preview(agent, project);
          console.log(`${agent} : ajouterait à ${p.file}\n  ${p.command}`);
          continue;
        }
        const r = install(agent, project);
        console.log(`✓ ${agent} : hook Stop ajouté à ${r.file}${r.backup ? `\n  sauvegarde : ${r.backup}` : ""}`);
      }
      if (!args.includes("--dry-run")) console.log(`\nScript enregistré : ${HOOK_SCRIPT}\nMode shadow : rien n'est bloqué. Lance \`misogi doctor\` pour vérifier.`);
      return 0;
    }
    case "uninstall": {
      const targets = args.includes("--all-projects") ? listProjects() : [{ path: project, agents: agentsFrom(positional[0] ?? "all") }];
      for (const t of targets) {
        for (const agent of isAgent(positional[0]) ? [positional[0]] : t.agents) {
          const r = uninstall(agent, t.path);
          console.log(`${r.changed ? "✓" : "·"} ${agent} : ${r.changed ? "hook retiré de" : "rien à retirer dans"} ${r.file}`);
        }
      }
      return 0;
    }
    case "doctor": {
      const checks = await doctor(project, { ping: args.includes("--ping") });
      console.log(formatChecks(checks));
      return checks.some((c) => !c.ok && !c.warn) ? 1 : 0;
    }
    case "key": {
      if (positional[0] === "delete") {
        await deleteApiKey(project);
        console.log(`✓ clé supprimée du trousseau pour ${project}`);
        return 0;
      }
      if (positional[0] !== "set") break;
      const key = (positional[1] ?? readFileSync(0, "utf8")).trim();
      if (!key) throw new Error("clé vide");
      await setApiKey(project, key);
      console.log(`✓ clé rangée dans le trousseau pour ${project}`);
      return 0;
    }
    case "serve": {
      const staticDir = flag(args, "--static");
      const { port } = await startServer({ port: Number(flag(args, "--port")) || DEFAULT_PORT, staticDir: staticDir && resolve(staticDir) });
      console.log(`Misogi : http://127.0.0.1:${port}`);
      return new Promise(() => {});
    }
  }
  console.log(HELP);
  return cmd && cmd !== "help" && cmd !== "--help" ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`misogi : ${(err as Error).message}`);
    process.exitCode = 1;
  },
);
