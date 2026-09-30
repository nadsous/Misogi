// Préférences de la fenêtre (thème, langue, quotas, repli) : localStorage pour démarrer sans clignoter,
// et une copie côté serveur (~/.misogi/settings.json) qui survit aux mises à jour de l'appli et que
// partagent l'appli et le navigateur (npx misogi).

import { api } from "./api";

const KEYS = ["misogi.theme", "misogi.lang", "misogi.quotas", "misogi.autocollapse"];

/** Tant que la copie du serveur n'est pas lue, on n'y écrit rien : le thème par défaut écraserait le tien. */
let synced = false;

export function savePref(key: string, value: string): void {
  if (localStorage.getItem(key) === value) return;
  localStorage.setItem(key, value);
  if (synced) void api.saveSettings({ ui: { [key]: value } }).catch(() => {});
}

/**
 * Au démarrage : la copie du serveur fait foi ; ce qui n'y est pas encore (anciennes versions) y est envoyé.
 * Rend true si une préférence locale a changé, pour que la fenêtre la réapplique.
 */
export async function syncPrefs(): Promise<boolean> {
  const server = (await api.settings()).ui ?? {};
  let changed = false;
  const missing: Record<string, string> = {};
  for (const key of KEYS) {
    const local = localStorage.getItem(key);
    const remote = server[key];
    if (remote !== undefined && remote !== local) {
      localStorage.setItem(key, remote);
      changed = true;
    } else if (remote === undefined && local !== null) {
      missing[key] = local;
    }
  }
  if (Object.keys(missing).length) await api.saveSettings({ ui: missing });
  synced = true;
  if (changed) dispatchEvent(new Event("misogi:prefs"));
  return changed;
}
