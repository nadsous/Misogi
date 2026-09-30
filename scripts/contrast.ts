#!/usr/bin/env node
// Vérifie les contrastes de chaque thème (WCAG 2.1) : tout texte doit atteindre 4,5:1 sur le fond et sur les surfaces.
// Usage : node scripts/contrast.ts   (code de sortie 1 si un thème échoue ; lancé en CI)

import { THEMES } from "../app/src/themes.ts";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

const TEXT = ["fg", "muted", "faint", "accent", "ok", "warn", "bad"] as const;
const BACKGROUNDS = ["bg", "surface", "raised"] as const;
let failures = 0;
for (const t of THEMES) {
  const bad: string[] = [];
  for (const fg of TEXT) {
    for (const bg of BACKGROUNDS) {
      const r = ratio(t.colors[fg], t.colors[bg]);
      if (r < 4.5) bad.push(`${fg}/${bg} ${r.toFixed(2)}`);
    }
  }
  failures += bad.length;
  console.log(`${bad.length ? "✗" : "✓"} ${t.name}${bad.length ? " : " + bad.join(", ") : ""}`);
}
process.exit(failures ? 1 : 0);
