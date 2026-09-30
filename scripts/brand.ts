#!/usr/bin/env node
// Régénère toutes les images de marque à partir de app/src/logo.ts et app/src/themes.ts.
// Usage : node scripts/brand.ts   (Node 22.18+ : les types TypeScript sont ignorés à l'exécution)
// Puis, pour les icônes desktop : npx tauri icon app/src-tauri/icons/source.svg -o app/src-tauri/icons

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOGO_VIEWBOX, logoMarkup, logoSvg } from "../app/src/logo.ts";
import { THEME_BY_NAME, THEMES } from "../app/src/themes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const write = (path: string, content: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
  console.log(`✓ ${path}`);
};

write("app/public/favicon.svg", logoSvg(THEME_BY_NAME.eau.logo, 64));
write("docs/brand/logo.svg", logoSvg(THEME_BY_NAME.lait.logo, 512));
write("docs/brand/logo-dark.svg", logoSvg(THEME_BY_NAME.eau.logo, 512));
write("app/src-tauri/icons/source.svg", logoSvg(THEME_BY_NAME.eau.logo, 1024));

// Bandeau des gouttes pour le README : une vignette par thème, sur son propre fond.
const [vx, vy, vw, vh] = LOGO_VIEWBOX.split(" ").map(Number) as [number, number, number, number];
const tile = 150;
const gap = 14;
const cols = 7;
const rows = Math.ceil(THEMES.length / cols);
const width = cols * tile + (cols - 1) * gap;
const rowH = tile + 34 + gap;
const tiles = THEMES.map((t, i) => {
  const x = (i % cols) * (tile + gap);
  const y = Math.floor(i / cols) * rowH;
  const scale = (tile * 0.62) / vh;
  const lx = x + (tile - vw * scale) / 2 - vx * scale;
  const ly = y + 18 - vy * scale;
  return `<g>
    <rect x="${x}" y="${y}" width="${tile}" height="${tile + 34}" rx="18" fill="${t.colors.bg}" stroke="${t.colors.line}"/>
    <g transform="translate(${lx} ${ly}) scale(${scale})">${logoMarkup(t.logo, `d${i}`)}</g>
    <text x="${x + tile / 2}" y="${y + tile + 14}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="15" font-weight="600" fill="${t.colors.fg}">${t.label.fr}</text>
    <text x="${x + tile / 2}" y="${y + tile + 28}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="11" fill="${t.colors.muted}">${t.label.en}</text>
  </g>`;
});
write("docs/brand/drops.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${width + 4} ${rows * rowH}" width="${width}">\n${tiles.join("\n")}\n</svg>\n`);
