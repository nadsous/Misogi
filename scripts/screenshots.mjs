#!/usr/bin/env node
// Captures du README : l'appli (servie par `misogi serve` sur :4317) dans une fenêtre de 380 px.
// Utilise le navigateur Edge ou Chrome déjà installé (playwright-core, aucun téléchargement).
// Usage : node scripts/screenshots.mjs [--port 4317] [--channel msedge|chrome]

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const base = `http://127.0.0.1:${arg("--port", "4317")}`;
const out = join(root, "docs", "screenshots");
mkdirSync(out, { recursive: true });

const shots = [
  { name: "feed", query: "lang=fr&theme=eau", bg: "#0f2530" },
  { name: "feed-rosee", query: "lang=fr&theme=rosee", bg: "#cfe6ee" },
  { name: "projects", query: "lang=fr&theme=eau&view=projects", bg: "#0f2530", click: "text=nads-site" },
  { name: "drops", query: "lang=fr&theme=creme&view=settings", bg: "#e9dccd", height: 900, scrollTo: "text=Goutte" },
  { name: "guides", query: `lang=fr&theme=sumi&view=guides&project=${encodeURIComponent(process.env.DEMO_PROJECT ?? "")}`, bg: "#1a1a1a" },
  { name: "feed-feu", query: "lang=en&theme=feu", bg: "#2a120c" },
];

const browser = await chromium.launch({ channel: arg("--channel", "msedge") });
for (const s of shots) {
  if (s.name === "guides" && !process.env.DEMO_PROJECT) continue;
  const height = s.height ?? 760;
  const page = await browser.newPage({ viewport: { width: 380, height }, deviceScaleFactor: 2 });
  await page.goto(`${base}/?${s.query}`);
  await page.waitForTimeout(1800);
  if (s.click) await page.click(s.click).catch(() => {});
  if (s.scrollTo) await page.locator(s.scrollTo).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(600);
  const app = await page.screenshot({ type: "png" });

  // Cadre : la fenêtre posée sur un fond aux couleurs du thème, coins arrondis et ombre.
  const frame = await browser.newPage({ viewport: { width: 460, height: height + 80 }, deviceScaleFactor: 2 });
  await frame.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:${s.bg}">
    <img src="data:image/png;base64,${app.toString("base64")}" style="width:380px;height:${height}px;border-radius:14px;border:1px solid rgba(127,127,127,.25);box-shadow:0 24px 60px rgba(0,0,0,.35)"></body>`);
  await frame.screenshot({ path: join(out, `${s.name}.png`), omitBackground: true });
  console.log(`✓ docs/screenshots/${s.name}.png`);
  await page.close();
  await frame.close();
}
await browser.close();
