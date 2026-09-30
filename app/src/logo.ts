// Logo Misogi : une goutte de verre dont le bas s'ouvre en M, comme l'eau qui se sépare sur la pierre.
// Source unique du tracé : l'appli, le favicon, les icônes Tauri et les images du README en dérivent
// (scripts/brand.ts). Rendu « verre » : corps translucide, reflets spéculaires, liseré lumineux, ombre douce.

export const LOGO_VIEWBOX = "170 140 910 1080";

/** Silhouette, symétrique autour de x = 625. */
export const LOGO_PATH =
  "M625 180C592 262 470 380 380 480C268 605 212 760 218 880C222 990 330 1110 548 1172" +
  "C445 1118 360 1000 342 860C326 730 356 612 418 573C470 558 520 640 578 740C598 775 612 790 625 790" +
  "C638 790 652 775 672 740C730 640 780 558 832 573C894 612 924 730 908 860C890 1000 805 1118 702 1172" +
  "C920 1110 1028 990 1032 880C1038 760 982 605 870 480C780 380 658 262 625 180Z";

/** Reflets spéculaires : l'arête gauche de la pointe et l'intérieur des deux jambes. */
const SPECULAR = [
  "M612 214C590 292 526 372 474 432C520 392 582 312 612 214Z",
  "M318 660C286 750 290 880 350 985C322 900 312 770 318 660Z",
  "M932 660C964 750 960 880 900 985C928 900 938 770 932 660Z",
];

/** Petits éclats sous la pointe et sur les épaules, comme sur une goutte réelle. */
const GLINTS = [
  "M560 300C548 330 530 352 512 372C534 356 552 336 560 300Z",
  "M846 520C872 552 890 590 900 628C884 596 866 566 846 520Z",
];

export interface LogoColors {
  /** Haut de la goutte (clair). */
  top: string;
  /** Bas de la goutte (plus soutenu). */
  bottom: string;
  /** Reflets. */
  shine: string;
}

/**
 * Contenu SVG du logo. `id` rend les dégradés uniques quand plusieurs logos cohabitent sur une page.
 * Les couleurs passent par style="" pour accepter aussi des var(--...).
 */
export function logoMarkup(c: LogoColors, id = "m"): string {
  const s = (prop: string, v: string) => `style="${prop}:${v}"`;
  return `<defs>
    <linearGradient id="${id}-body" x1="0.2" y1="0" x2="0.55" y2="1">
      <stop offset="0" ${s("stop-color", c.top)}/>
      <stop offset="0.55" ${s("stop-color", c.bottom)} stop-opacity="0.8"/>
      <stop offset="1" ${s("stop-color", c.top)} stop-opacity="0.9"/>
    </linearGradient>
    <radialGradient id="${id}-depth" cx="0.5" cy="0.36" r="0.55">
      <stop offset="0" ${s("stop-color", c.shine)} stop-opacity="0.55"/>
      <stop offset="0.6" ${s("stop-color", c.shine)} stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" ${s("stop-color", c.shine)} stop-opacity="0.95"/>
      <stop offset="0.5" ${s("stop-color", c.shine)} stop-opacity="0.25"/>
      <stop offset="1" ${s("stop-color", c.shine)} stop-opacity="0.8"/>
    </linearGradient>
    <linearGradient id="${id}-spec" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" ${s("stop-color", c.shine)} stop-opacity="0.95"/>
      <stop offset="1" ${s("stop-color", c.shine)} stop-opacity="0.15"/>
    </linearGradient>
    <filter id="${id}-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="22" ${s("flood-color", c.bottom)} flood-opacity="0.35"/>
    </filter>
  </defs>
  <g filter="url(#${id}-shadow)">
    <path d="${LOGO_PATH}" fill="url(#${id}-body)" fill-opacity="0.92"/>
  </g>
  <path d="${LOGO_PATH}" fill="url(#${id}-depth)"/>
  <path d="${LOGO_PATH}" fill="none" stroke="url(#${id}-rim)" stroke-width="7"/>
  <path d="${LOGO_PATH}" fill="none" ${s("stroke", c.bottom)} stroke-opacity="0.55" stroke-width="1.5"/>
  ${SPECULAR.map((d) => `<path d="${d}" fill="url(#${id}-spec)"/>`).join("\n  ")}
  ${GLINTS.map((d) => `<path d="${d}" ${s("fill", c.shine)} fill-opacity="0.6"/>`).join("\n  ")}`;
}

/** SVG autonome, pour les fichiers (favicon, README, icônes). */
export function logoSvg(c: LogoColors, size = 512): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}" width="${size}" height="${size}">
  ${logoMarkup(c)}
</svg>
`;
}
