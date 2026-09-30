// Thèmes « gouttes ». Misogi (禊) est la purification shintô par l'eau d'une rivière ou d'une cascade :
// chaque thème est une goutte différente qui traverse ce courant.

import type { LogoColors } from "./logo";

export type ThemeName = "eau" | "rosee" | "lait" | "cafe" | "creme" | "feu" | "aube" | "matcha" | "matcha-latte" | "sumi" | "washi" | "sakura" | "sel";

export interface Theme {
  name: ThemeName;
  label: { fr: string; en: string };
  /** D'où vient la goutte. */
  ref: { fr: string; en: string };
  scheme: "dark" | "light";
  colors: {
    bg: string;
    surface: string;
    raised: string;
    line: string;
    fg: string;
    muted: string;
    faint: string;
    accent: string;
    ok: string;
    warn: string;
    bad: string;
  };
  logo: LogoColors;
}

export const THEMES: Theme[] = [
  {
    name: "eau",
    label: { fr: "Eau", en: "Water" },
    ref: { fr: "Mizu : l'eau froide de la cascade où l'on se purifie (takigyō).", en: "Mizu: the cold waterfall water of the takigyō rite." },
    scheme: "dark",
    colors: { bg: "#091015", surface: "#0e171d", raised: "#142129", line: "#1f2f39", fg: "#e6f1f5", muted: "#93a9b3", faint: "#7a8c95", accent: "#5cc8e0", ok: "#3fc49a", warn: "#e3b04b", bad: "#f06a6a" },
    logo: { top: "#eaf8fc", bottom: "#5aa9c2", shine: "#ffffff" },
  },
  {
    name: "rosee",
    label: { fr: "Rosée", en: "Dew" },
    ref: { fr: "Tsuyu : la rosée du matin sur la mousse, près du courant.", en: "Tsuyu: morning dew on the moss beside the stream." },
    scheme: "light",
    colors: { bg: "#f4fafc", surface: "#ffffff", raised: "#e9f3f7", line: "#d5e6ed", fg: "#10232b", muted: "#4d6570", faint: "#596f78", accent: "#1b7590", ok: "#137c57", warn: "#906216", bad: "#c03c3d" },
    logo: { top: "#ffffff", bottom: "#4aa3c0", shine: "#ffffff" },
  },
  {
    name: "lait",
    label: { fr: "Lait", en: "Milk" },
    ref: { fr: "Une goutte de lait : le blanc argenté du logo d'origine.", en: "A drop of milk: the silvery white of the original logo." },
    scheme: "light",
    colors: { bg: "#fbfaf7", surface: "#ffffff", raised: "#f2f1ee", line: "#e4e2dd", fg: "#1b1c1f", muted: "#5e616a", faint: "#686b70", accent: "#526d8e", ok: "#1e7b55", warn: "#8e631d", bad: "#bd4242" },
    logo: { top: "#ffffff", bottom: "#8c919b", shine: "#ffffff" },
  },
  {
    name: "cafe",
    label: { fr: "Café", en: "Coffee" },
    ref: { fr: "La goutte qui tombe du filtre, crème caramel sur fond torréfié.", en: "The drip from the filter: caramel crema on a roasted base." },
    scheme: "dark",
    colors: { bg: "#130e0a", surface: "#1a130e", raised: "#231a13", line: "#33261c", fg: "#f1e6da", muted: "#b39c86", faint: "#978473", accent: "#d39b68", ok: "#7fbf7a", warn: "#e8b04a", bad: "#e56a55" },
    logo: { top: "#f2d9bb", bottom: "#7a4e2e", shine: "#fff4e6" },
  },
  {
    name: "creme",
    label: { fr: "Crème", en: "Latte" },
    ref: { fr: "Le café au lait : la goutte de café adoucie par la crème.", en: "Café au lait: the coffee drop softened with cream." },
    scheme: "light",
    colors: { bg: "#faf5ef", surface: "#fffdf9", raised: "#f2e9df", line: "#e6d8c9", fg: "#2b1e14", muted: "#6e5a49", faint: "#766454", accent: "#925b33", ok: "#2e7448", warn: "#8f5d12", bad: "#b64137" },
    logo: { top: "#fff7ec", bottom: "#b27b52", shine: "#ffffff" },
  },
  {
    name: "feu",
    label: { fr: "Feu", en: "Fire" },
    ref: { fr: "Hi : le feu qui répond à l'eau dans les rites de purification (hi-watari).", en: "Hi: the fire that answers water in purification rites (hi-watari)." },
    scheme: "dark",
    colors: { bg: "#110908", surface: "#180d0b", raised: "#21120f", line: "#341b16", fg: "#f7e7df", muted: "#c0968a", faint: "#9d7b72", accent: "#ff6b3d", ok: "#5fc48d", warn: "#ffb547", bad: "#ff4d4d" },
    logo: { top: "#ffe08a", bottom: "#e0432a", shine: "#fff2c4" },
  },
  {
    name: "aube",
    label: { fr: "Aube", en: "Dawn" },
    ref: { fr: "Le premier feu du jour sur l'eau : on se purifie à l'aube.", en: "The day's first fire on the water: purification at dawn." },
    scheme: "light",
    colors: { bg: "#fff7f2", surface: "#ffffff", raised: "#fdebe0", line: "#f5d8c6", fg: "#2d1710", muted: "#72503f", faint: "#836455", accent: "#b54525", ok: "#2c784c", warn: "#965e0f", bad: "#c53232" },
    logo: { top: "#fff3d6", bottom: "#f07a4a", shine: "#ffffff" },
  },
  {
    name: "matcha",
    label: { fr: "Matcha", en: "Matcha" },
    ref: { fr: "Une goutte de thé fouetté, le vert de la cérémonie du thé.", en: "A drop of whisked tea, the green of the tea ceremony." },
    scheme: "dark",
    colors: { bg: "#0c110b", surface: "#111810", raised: "#182116", line: "#243121", fg: "#e9f1e2", muted: "#9fb294", faint: "#7e8e75", accent: "#9fcb74", ok: "#6fcf8f", warn: "#e0b44c", bad: "#ec6a5c" },
    logo: { top: "#e3f2cf", bottom: "#5d8a3a", shine: "#f7ffe9" },
  },
  {
    name: "matcha-latte",
    label: { fr: "Matcha latte", en: "Matcha latte" },
    ref: { fr: "Le thé vert fouetté dans le lait, doux et clair.", en: "Green tea whisked into milk, soft and light." },
    scheme: "light",
    colors: { bg: "#f6f9f1", surface: "#ffffff", raised: "#ebf2e2", line: "#d9e5cc", fg: "#18230f", muted: "#55664a", faint: "#617056", accent: "#4c752d", ok: "#297a4b", warn: "#8e640f", bad: "#ba4237" },
    logo: { top: "#fbfff4", bottom: "#86b25e", shine: "#ffffff" },
  },
  {
    name: "sumi",
    label: { fr: "Sumi", en: "Sumi" },
    ref: { fr: "L'encre de la calligraphie : noir et blanc, sans couleur.", en: "Calligraphy ink: black and white, no colour." },
    scheme: "dark",
    colors: { bg: "#0a0a0a", surface: "#111111", raised: "#181818", line: "#262626", fg: "#f2f2f2", muted: "#a3a3a3", faint: "#828282", accent: "#f2f2f2", ok: "#8fd19e", warn: "#e6c07a", bad: "#f08a8a" },
    logo: { top: "#fafafa", bottom: "#5c5c5c", shine: "#ffffff" },
  },
  {
    name: "washi",
    label: { fr: "Washi", en: "Washi" },
    ref: { fr: "Le papier japonais qui reçoit l'encre : noir sur blanc cassé.", en: "The Japanese paper that takes the ink: black on off-white." },
    scheme: "light",
    colors: { bg: "#f7f5f0", surface: "#fcfbf8", raised: "#eeebe3", line: "#dfdbd0", fg: "#141414", muted: "#555555", faint: "#6a6863", accent: "#1c1c1c", ok: "#2a754a", warn: "#8a611b", bad: "#b53f39" },
    logo: { top: "#ffffff", bottom: "#4a4a4a", shine: "#ffffff" },
  },
  {
    name: "sakura",
    label: { fr: "Sakura", en: "Sakura" },
    ref: { fr: "La rosée sur un pétale de cerisier au printemps.", en: "Dew on a cherry blossom petal in spring." },
    scheme: "light",
    colors: { bg: "#fdf7f8", surface: "#ffffff", raised: "#f8edf0", line: "#efdce1", fg: "#2a1c20", muted: "#6f5960", faint: "#78666c", accent: "#a1516a", ok: "#2d7855", warn: "#90621f", bad: "#b64343" },
    logo: { top: "#fff0f5", bottom: "#e08aa6", shine: "#ffffff" },
  },
  {
    name: "sel",
    label: { fr: "Sel", en: "Salt" },
    ref: { fr: "Shio : le sel qu'on répand pour purifier, gris clair et net.", en: "Shio: the salt scattered to purify, clean light grey." },
    scheme: "light",
    colors: { bg: "#f5f6f7", surface: "#ffffff", raised: "#eceef0", line: "#dde0e4", fg: "#16191d", muted: "#586069", faint: "#636a71", accent: "#4f6378", ok: "#1d7954", warn: "#8b621b", bad: "#b74040" },
    logo: { top: "#ffffff", bottom: "#7b8795", shine: "#ffffff" },
  },
];

export const THEME_BY_NAME = Object.fromEntries(THEMES.map((t) => [t.name, t])) as Record<ThemeName, Theme>;

/** Variables CSS d'un thème, à poser sur un élément (la racine, ou une vignette d'aperçu). */
export function themeVars(t: Theme): Record<string, string> {
  const vars: Record<string, string> = { colorScheme: t.scheme };
  for (const [k, v] of Object.entries(t.colors)) vars[`--${k}`] = v;
  vars["--logo-top"] = t.logo.top;
  vars["--logo-bottom"] = t.logo.bottom;
  vars["--logo-shine"] = t.logo.shine;
  return vars;
}
