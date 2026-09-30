// Icône d'un projet : favicon, logo ou icône d'appli, cherchés là où les frameworks les rangent
// (Next, Vite, Astro, SvelteKit, Flutter web, Tauri, Electron, Expo...).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const DIRS = ["", "public", "static", "assets", "src", "src/assets", "app", "src/app", "web", "resources", "build", "src-tauri/icons", "assets/images", ".github"];
const NAME = /^(favicon|icon|logo|apple-touch-icon|app-icon)([\w.-]*)\.(svg|png|ico|webp|jpe?g)$/i;
const EXT_RANK: Record<string, number> = { ".svg": 0, ".png": 1, ".webp": 2, ".ico": 3, ".jpg": 4, ".jpeg": 4 };
const NAME_RANK: Record<string, number> = { favicon: 0, icon: 1, "apple-touch-icon": 2, "app-icon": 2, logo: 3 };
const MAX_BYTES = 512 * 1024;

const cache = new Map<string, { file: string | null; at: number }>();
const TTL_MS = 60_000;

export function findProjectIcon(projectDir: string): string | null {
  const hit = cache.get(projectDir);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.file;
  const file = fromIndexHtml(projectDir) ?? scan(projectDir);
  cache.set(projectDir, { file, at: Date.now() });
  return file;
}

function scan(projectDir: string): string | null {
  const found: { file: string; score: number }[] = [];
  DIRS.forEach((dir, depth) => {
    const abs = join(projectDir, dir);
    let names: string[];
    try {
      names = readdirSync(abs);
    } catch {
      return;
    }
    for (const n of names) {
      const m = NAME.exec(n);
      if (!m) continue;
      const file = join(abs, n);
      if (!usable(file)) continue;
      // Préfère : favicon > icon > logo, svg > png > ico, puis les dossiers les plus courants.
      const score = (NAME_RANK[m[1]!.toLowerCase()] ?? 5) * 100 + (EXT_RANK[extname(n).toLowerCase()] ?? 9) * 10 + depth * 0.1 + (m[2] ? 1 : 0);
      found.push({ file, score });
    }
  });
  found.sort((a, b) => a.score - b.score);
  return found[0]?.file ?? null;
}

/** <link rel="icon" href="..."> dans index.html (Vite, Flutter web, sites statiques). */
function fromIndexHtml(projectDir: string): string | null {
  for (const html of ["index.html", "public/index.html", "web/index.html", "src/index.html"]) {
    const path = join(projectDir, html);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const href = /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i.exec(text)?.[1] ?? /<link[^>]+href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i.exec(text)?.[1];
    if (!href || /^(https?:|data:)/.test(href)) continue;
    const clean = href.replace(/^\//, "").split("?")[0]!;
    for (const base of [join(projectDir, html, ".."), join(projectDir, "public"), projectDir]) {
      const file = resolve(base, clean);
      if (file.startsWith(resolve(projectDir)) && usable(file)) return file;
    }
  }
  return null;
}

function usable(file: string): boolean {
  try {
    const s = statSync(file);
    return s.isFile() && s.size > 0 && s.size <= MAX_BYTES;
  } catch {
    return false;
  }
}
