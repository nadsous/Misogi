// Masquage des secrets avant tout envoi à Jev : clés API, tokens, contenu des .env, adresses e-mail.

const RULES: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[clé privée masquée]"],
  [/\b(?:sk|pk|rk)-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g, "[clé masquée]"],
  [/\bsk_(?:live|test)_[A-Za-z0-9]{16,}/g, "[clé masquée]"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, "[token masqué]"],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, "[token masqué]"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[token masqué]"],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[clé masquée]"],
  [/\bAIza[A-Za-z0-9_-]{35}\b/g, "[clé masquée]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt masqué]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi, "$1 [token masqué]"],
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, "$1[masqué]@"],
  // Lignes de type .env : NOM_EN_MAJUSCULES=valeur, ou clé sensible dans du JSON/YAML.
  [/^(\s*(?:export\s+)?[A-Z][A-Z0-9_]*\s*=\s*)(.+)$/gm, "$1[masqué]"],
  [/((?:"|')?[\w-]*(?:secret|password|passwd|token|api[_-]?key|private[_-]?key)[\w-]*(?:"|')?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,}\n]+)/gi, "$1[masqué]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[e-mail masqué]"],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, by] of RULES) out = out.replace(re, by);
  return out;
}

/** Masque toutes les chaînes d'une structure JSON, clés comprises non modifiées. */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map(redactDeep) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)])) as T;
  }
  return value;
}
