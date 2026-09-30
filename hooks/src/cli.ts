#!/usr/bin/env node
// CLI `misogi` : install, uninstall, doctor, key, serve, remote, purge.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAgent } from "./adapters/index.js";
import { listProjects, loadSettings } from "./config.js";
import { doctor, formatChecks } from "./doctor.js";
import { install, preview, stableHookScript, uninstall } from "./install.js";
import { deleteApiKey, setApiKey } from "./keys.js";
import { purgeOlderThan } from "./log.js";
import { detectAgents } from "./platform.js";
import { remoteToken } from "./runtime.js";
import { DEFAULT_PORT, startServer } from "./server.js";
import type { Agent } from "./types.js";

const HELP = `misogi — voir ce que Jev pense de chaque décision de ton agent

  misogi                                   ouvre la fenêtre dans le navigateur
  misogi install [claude|codex|kimi|all]   installe le hook Stop dans le projet courant (sauvegarde la config avant)
  misogi uninstall [agent|all] [--all-projects]  retire les hooks et remet les configs comme avant
  misogi doctor [--ping]                    vérifie clé, hooks et journal
  misogi key set [clé]                      range la clé TypeSafe du projet dans le trousseau (sinon lue sur stdin)
  misogi key delete
  misogi serve [--port ${DEFAULT_PORT}] [--static <dossier>] [--listen 0.0.0.0]  fenêtre dans le navigateur, journal en direct
  misogi remote                             comment brancher une session SSH ou un conteneur de dev sur cette fenêtre
  misogi purge [--days 30]                  supprime les décisions plus anciennes (par défaut : durée de conservation réglée)

  --project <dossier>   projet visé (défaut : dossier courant)
  --dry-run             pour install : affiche ce qui serait écrit, sans rien toucher`;

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {
    // pas de navigateur : l'adresse est affichée
  }
}

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
  const valued = new Set(["--project", "--port", "--static", "--listen", "--days"]);
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
      if (!args.includes("--dry-run")) console.log(`\nScript enregistré : ${stableHookScript()}\nMode shadow : rien n'est bloqué. Lance \`misogi doctor\` pour vérifier.`);
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
    case "remote": {
      const token = remoteToken();
      console.log(`Brancher une session distante sur cette fenêtre
Le journal d'une session SSH ou d'un conteneur n'est pas sur ta machine : le hook distant envoie
chaque décision ici, signée avec ce jeton (garde-le pour toi) :

  MISOGI_TOKEN=${token}

1. SSH : ouvre la session avec un tunnel inverse, puis installe Misogi sur la machine distante.
     ssh -R ${DEFAULT_PORT}:127.0.0.1:${DEFAULT_PORT} ta-machine
     export MISOGI_REMOTE=http://127.0.0.1:${DEFAULT_PORT} MISOGI_TOKEN=${token}

2. Conteneur de dev : lance la fenêtre avec  misogi serve --listen 0.0.0.0  puis dans devcontainer.json :
     "remoteEnv": { "MISOGI_REMOTE": "http://host.docker.internal:${DEFAULT_PORT}", "MISOGI_TOKEN": "${token}" }

3. Claude Code sur le web : la session tourne sur les serveurs d'Anthropic. Il faut un tunnel public
   (cloudflared, ngrok) vers ${DEFAULT_PORT} et le hook Misogi dans le dépôt : expérimental.

Sans fenêtre joignable, le hook distant garde son propre journal et fonctionne quand même.`);
      return 0;
    }
    case "purge": {
      const days = Number(flag(args, "--days")) || loadSettings().retention_days;
      console.log(`✓ ${purgeOlderThan(days)} décision(s) de plus de ${days} jours supprimée(s)`);
      return 0;
    }
    case "serve": {
      const staticDir = flag(args, "--static");
      const listen = flag(args, "--listen");
      const { port } = await startServer({ port: Number(flag(args, "--port")) || DEFAULT_PORT, staticDir: staticDir && resolve(staticDir), listen });
      if (listen && listen !== "127.0.0.1") console.log(`Écoute sur ${listen} : seules les décisions signées avec le jeton (misogi remote) sont acceptées depuis le réseau.`);
      console.log(`Misogi : http://127.0.0.1:${port}`);
      return new Promise(() => {});
    }
  }
  // `npx misogi` tout court : la fenêtre s'ouvre dans le navigateur, le reste se fait depuis elle.
  if (!cmd) {
    const { port } = await startServer({ port: DEFAULT_PORT }).catch(async (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") return { port: DEFAULT_PORT }; // déjà lancée : on ouvre juste la fenêtre
      throw err;
    });
    const url = `http://127.0.0.1:${port}`;
    console.log(`Misogi : ${url}  (Ctrl+C pour arrêter ; « misogi help » pour les commandes)`);
    openBrowser(url);
    return new Promise(() => {});
  }
  console.log(HELP);
  return cmd !== "help" && cmd !== "--help" ? 1 : 0;
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
