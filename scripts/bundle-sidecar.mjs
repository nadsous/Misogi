#!/usr/bin/env node
// Prépare hooks/bundle/ : ce que l'appli Tauri embarque dans ses ressources.
//   cli.js, hook.js     serveur local et hook, dépendances JS incluses
//   node_modules/       module natif du trousseau (@napi-rs/keyring + binaire de la plateforme)
//   ui/                 interface construite (app/dist)
// Les agents lancent ensuite `node <ressources>/misogi/hook.js`.

import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "hooks", "bundle");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: { cli: join(root, "hooks/src/cli.ts"), hook: join(root, "hooks/src/hook.ts") },
  outdir: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["@napi-rs/keyring"],
  // chokidar et consorts utilisent require() : on fournit un require ESM.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
writeFileSync(join(out, "package.json"), '{ "type": "module" }\n');

const napi = join(root, "node_modules", "@napi-rs");
// Pas la variante musl : l'appli vise les distributions glibc, et linuxdeploy (AppImage) échoue sur
// un binaire qui dépend de libc.musl.
for (const pkg of readdirSync(napi).filter((p) => (p === "keyring" || p.startsWith("keyring-")) && !p.endsWith("-musl"))) {
  cpSync(join(napi, pkg), join(out, "node_modules", "@napi-rs", pkg), { recursive: true });
}

const ui = join(root, "app", "dist");
if (!existsSync(ui)) throw new Error("app/dist absent : lance d'abord `npm run build -w app`");
cpSync(ui, join(out, "ui"), { recursive: true });

console.log(`✓ ${out}`);
