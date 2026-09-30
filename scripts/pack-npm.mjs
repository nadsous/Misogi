#!/usr/bin/env node
// Prépare dist-npm/ : le paquet npm « misogi », pour `npx misogi` (une commande, rien à cloner).
//   cli.js, hook.js   serveur, CLI et hook, dépendances JS incluses (esbuild)
//   ui/               l'interface construite
// Le module natif du trousseau (@napi-rs/keyring) reste une vraie dépendance : npm installe le binaire
// de la bonne plateforme.
// Usage : npm run build && node scripts/bundle-sidecar.mjs && node scripts/pack-npm.mjs
//         cd dist-npm && npm publish

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "hooks", "bundle");
const out = join(root, "dist-npm");
if (!existsSync(join(bundle, "cli.js"))) throw new Error("hooks/bundle absent : lance d'abord node scripts/bundle-sidecar.mjs");

const version = JSON.parse(readFileSync(join(root, "app", "src-tauri", "tauri.conf.json"), "utf8")).version;
const keyringVersion = JSON.parse(readFileSync(join(root, "node_modules", "@napi-rs", "keyring", "package.json"), "utf8")).version;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ["cli.js", "hook.js"]) cpSync(join(bundle, f), join(out, f));
cpSync(join(bundle, "ui"), join(out, "ui"), { recursive: true });
cpSync(join(root, "LICENSE"), join(out, "LICENSE"));

writeFileSync(
  join(out, "package.json"),
  JSON.stringify(
    {
      name: "misogi",
      version,
      description: 'A second opinion on every "done" your coding agent announces. Sidecar for Claude Code, Codex and Kimi Code, judged by Jev.',
      type: "module",
      bin: { misogi: "cli.js" },
      files: ["cli.js", "hook.js", "ui", "LICENSE", "README.md"],
      engines: { node: ">=20" },
      dependencies: { "@napi-rs/keyring": `^${keyringVersion}` },
      keywords: ["claude-code", "codex", "kimi", "ai-agents", "jev", "typesafe", "hooks", "developer-tools"],
      homepage: "https://github.com/nadsous/Misogi",
      repository: { type: "git", url: "git+https://github.com/nadsous/Misogi.git" },
      bugs: "https://github.com/nadsous/Misogi/issues",
      license: "MIT",
    },
    null,
    2,
  ) + "\n",
);

writeFileSync(
  join(out, "README.md"),
  `# Misogi

A second opinion on every "done" your coding agent announces, plus a shell guard and your plan quotas, in one small window.
Works with Claude Code, Codex and Kimi Code. Judged by [Jev](https://docs.typesafe.ai).

\`\`\`sh
npx misogi             # opens the window in your browser
npx misogi install     # plugs the hooks into the current project (every agent found)
npx misogi key set     # stores your TypeSafe key in the OS keychain
npx misogi doctor      # checks everything in one go
\`\`\`

Zero telemetry. Fail-open. Shadow mode first. Full documentation, desktop app and screenshots:
**https://github.com/nadsous/Misogi**
`,
);

console.log(`✓ dist-npm/ (misogi@${version}) — pour publier : cd dist-npm && npm publish`);
