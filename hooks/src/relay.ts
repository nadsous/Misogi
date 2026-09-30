// Faire passer Kimi et Codex par le relais de Misogi (router.ts), ou les en retirer. Réglage global à la machine :
// ces agents n'ont pas de réglage de connexion par projet. Pour les projets sans routeur, le relais transmet tel quel.
//   - Kimi : variable d'environnement KIMI_BASE_URL de l'utilisateur (lue au démarrage de Kimi).
//   - Codex : un fournisseur « misogi » dans ~/.codex/config.toml, avec ta connexion OpenAI (ChatGPT ou clé API)
//     et sans WebSocket (les requêtes restent lisibles pour choisir le modèle).
// Avant toute modification, le fichier de Codex est sauvegardé ; on refuse si un autre réglage est déjà en place.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { agentHome } from "./platform.js";
import { ROUTER_PORT } from "./router.js";

export const KIMI_RELAY_URL = `http://127.0.0.1:${ROUTER_PORT}/kimi/v1`;
export const CODEX_RELAY_URL = `http://127.0.0.1:${ROUTER_PORT}/codex/v1`;

// --- Kimi

/** Valeur de KIMI_BASE_URL pour l'utilisateur (registre sous Windows, sinon l'environnement courant). */
export function kimiRelayValue(): string | null {
  if (process.platform === "win32") {
    try {
      const out = execFileSync("reg", ["query", "HKCU\\Environment", "/v", "KIMI_BASE_URL"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      return /KIMI_BASE_URL\s+REG_\w+\s+(\S+)/.exec(out)?.[1] ?? null;
    } catch {
      return null;
    }
  }
  return process.env.KIMI_BASE_URL ?? null;
}

export interface RelayResult {
  ok: boolean;
  /** Ce qu'il reste à faire à la main (macOS, Linux : la ligne à ajouter au profil du shell), ou pourquoi c'est refusé. */
  note?: string;
}

export function setKimiRelay(on: boolean): RelayResult {
  const current = kimiRelayValue();
  if (on && current && current !== KIMI_RELAY_URL) return { ok: false, note: `KIMI_BASE_URL vaut déjà ${current} : retire-la d'abord.` };
  if (process.platform !== "win32") {
    const line = `export KIMI_BASE_URL=${KIMI_RELAY_URL}`;
    return { ok: true, note: on ? `Ajoute cette ligne à ton ~/.zshrc ou ~/.bashrc, puis ouvre un nouveau terminal : ${line}` : `Retire la ligne « ${line} » de ton profil de shell.` };
  }
  try {
    if (on) execFileSync("setx", ["KIMI_BASE_URL", KIMI_RELAY_URL], { windowsHide: true, stdio: "ignore" });
    else if (current === KIMI_RELAY_URL) execFileSync("reg", ["delete", "HKCU\\Environment", "/v", "KIMI_BASE_URL", "/f"], { windowsHide: true, stdio: "ignore" });
  } catch (err) {
    return { ok: false, note: (err as Error).message };
  }
  return { ok: true, note: "Relance les applis qui lancent Kimi (terminal, T3 Code) pour qu'elles voient le changement." };
}

// --- Codex

const BEGIN = "# >>> misogi relais";
const END = "# <<< misogi relais";
const TOP = `model_provider = "misogi" # misogi relais`;

function codexConfig(): string {
  return join(agentHome("codex"), "config.toml");
}

export function codexRelayOn(text = readOr(codexConfig())): boolean {
  return text.includes(BEGIN) && text.includes(TOP);
}

/** Ajoute (ou retire) le fournisseur « misogi » ; model_provider doit être une clé du haut, avant la première table. */
export function codexRelayToml(text: string, on: boolean): string {
  let out = text
    .replace(new RegExp(`^${escape(TOP)}\\r?\\n?`, "m"), "")
    .replace(new RegExp(`\\n*${escape(BEGIN)}[\\s\\S]*?${escape(END)}\\n?`), "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  if (!on) return out.replace(/^\n+/, "").replace(/\n*$/, "\n").replace(/^\n$/, "");
  const firstTable = out.search(/^\s*\[/m);
  out = firstTable === -1 ? `${TOP}\n${out}` : `${out.slice(0, firstTable)}${TOP}\n${out.slice(firstTable)}`;
  const block = [BEGIN, "[model_providers.misogi]", 'name = "Misogi (relais)"', `base_url = "${CODEX_RELAY_URL}"`, "requires_openai_auth = true", "supports_websockets = false", END].join("\n");
  out = `${out.replace(/\s*$/, "")}\n\n${block}\n`;
  parseToml(out); // jamais de config cassée
  return out;
}

export function setCodexRelay(on: boolean): RelayResult {
  const file = codexConfig();
  const text = readOr(file);
  if (on) {
    const other = /^model_provider\s*=\s*"([^"]+)"(?!.*misogi relais)/m.exec(text)?.[1];
    if (other && other !== "misogi") return { ok: false, note: `Codex utilise déjà le fournisseur « ${other} » : Misogi ne le remplace pas.` };
  }
  let next: string;
  try {
    next = codexRelayToml(text, on);
  } catch (err) {
    return { ok: false, note: `~/.codex/config.toml illisible : ${(err as Error).message}` };
  }
  if (next === text) return { ok: true };
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file) && !existsSync(file + ".misogi-backup")) copyFileSync(file, file + ".misogi-backup");
  writeFileSync(file, next, "utf8");
  return { ok: true, note: on ? "Relance Codex (et T3 Code) pour qu'il passe par Misogi." : undefined };
}

function readOr(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
