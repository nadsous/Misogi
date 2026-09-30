// Ce que la fenêtre fait différemment dans Tauri et dans un onglet de navigateur.

import { invoke, isTauri } from "@tauri-apps/api/core";

export const inTauri = isTauri();

export async function notify(title: string, body: string): Promise<void> {
  if (inTauri) {
    const n = await import("@tauri-apps/plugin-notification");
    if (!(await n.isPermissionGranted()) && (await n.requestPermission()) !== "granted") return;
    n.sendNotification({ title, body });
    return;
  }
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") await Notification.requestPermission();
  if (Notification.permission === "granted") new Notification(title, { body, icon: "/favicon.svg" });
}

/** Mode bande de 40 px : la fenêtre Tauri se redimensionne, l'onglet se contente de changer de mise en page. */
export async function setCollapsed(collapsed: boolean): Promise<void> {
  if (inTauri) await invoke("set_collapsed", { collapsed });
}

/** Sélecteur de dossier natif (Tauri) ; null dans le navigateur, où l'on tape le chemin. */
export async function pickFolder(): Promise<string | null> {
  if (!inTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false });
  return typeof picked === "string" ? picked : null;
}

export async function setAlwaysOnTop(on: boolean): Promise<void> {
  if (inTauri) await invoke("set_always_on_top", { on });
}
