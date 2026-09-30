// Clé TypeSafe par projet, rangée dans le trousseau du système
// (Gestionnaire d'identifiants Windows, Trousseau macOS, Secret Service sous Linux).
// Service « misogi », compte = chemin du projet normalisé. L'appli Tauri utilise les mêmes noms.

export const KEYRING_SERVICE = "misogi";

interface KeyringEntry {
  getPassword(): string | null | undefined;
  setPassword(p: string): void;
  deletePassword(): boolean | void;
}
type EntryCtor = new (service: string, account: string) => KeyringEntry;

let loaded: Promise<EntryCtor | null> | undefined;

/** Le module natif est optionnel : sans lui, seule la variable d'environnement compte. */
function keyring(): Promise<EntryCtor | null> {
  loaded ??= import("@napi-rs/keyring").then((m) => m.Entry as unknown as EntryCtor).catch(() => null);
  return loaded;
}

export function keyAccount(projectDir: string): string {
  const p = projectDir.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? p.toLowerCase() : p;
}

/** Ordre : TYPESAFE_API_KEY, puis le trousseau pour ce projet. */
export async function getApiKey(projectDir: string): Promise<{ key?: string; source: "env" | "keychain" | "none" }> {
  if (process.env.TYPESAFE_API_KEY) return { key: process.env.TYPESAFE_API_KEY, source: "env" };
  const Entry = await keyring();
  if (!Entry) return { source: "none" };
  try {
    const key = new Entry(KEYRING_SERVICE, keyAccount(projectDir)).getPassword();
    return key ? { key, source: "keychain" } : { source: "none" };
  } catch {
    return { source: "none" };
  }
}

export async function setApiKey(projectDir: string, key: string): Promise<void> {
  const Entry = await keyring();
  if (!Entry) throw new Error("trousseau indisponible sur cette machine (module @napi-rs/keyring absent)");
  new Entry(KEYRING_SERVICE, keyAccount(projectDir)).setPassword(key);
}

/** Jetons des intégrations (github, gitlab, linear), dans le même trousseau. */
export type SecretName = "github" | "gitlab" | "linear";

export async function getSecret(name: SecretName): Promise<string | undefined> {
  const Entry = await keyring();
  if (!Entry) return undefined;
  try {
    return new Entry(KEYRING_SERVICE, `integration:${name}`).getPassword() ?? undefined;
  } catch {
    return undefined;
  }
}

export async function setSecret(name: SecretName, value: string | null): Promise<void> {
  const Entry = await keyring();
  if (!Entry) throw new Error("trousseau indisponible sur cette machine (module @napi-rs/keyring absent)");
  const entry = new Entry(KEYRING_SERVICE, `integration:${name}`);
  if (value) entry.setPassword(value);
  else {
    try {
      entry.deletePassword();
    } catch {
      // rien à supprimer
    }
  }
}

export async function deleteApiKey(projectDir: string): Promise<void> {
  const Entry = await keyring();
  if (!Entry) return;
  try {
    new Entry(KEYRING_SERVICE, keyAccount(projectDir)).deletePassword();
  } catch {
    // rien à supprimer
  }
}
