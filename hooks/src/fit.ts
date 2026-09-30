// Jev accepte un state d'environ 32 000 tokens. On estime ~4 caractères par token et, si ça dépasse,
// on raccourcit d'abord les textes les plus longs (en gardant leur début et leur fin), jamais la structure.

export const CHARS_PER_TOKEN = 4;

export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? null).length / CHARS_PER_TOKEN);
}

interface Slot {
  get: () => string;
  set: (s: string) => void;
}

function collect(value: unknown, slots: Slot[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      if (typeof v === "string") slots.push({ get: () => value[i] as string, set: (s) => (value[i] = s) });
      else collect(v, slots);
    });
  } else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      if (typeof o[k] === "string") slots.push({ get: () => o[k] as string, set: (s) => (o[k] = s) });
      else collect(o[k], slots);
    }
  }
}

/** Coupe au milieu : le début d'une demande et la fin d'une sortie de test sont les parties utiles. */
export function clipMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  const marker = `\n…[${s.length - max} caractères coupés]…\n`;
  const keep = Math.max(0, max - marker.length);
  return s.slice(0, Math.ceil(keep * 0.6)) + marker + s.slice(s.length - Math.floor(keep * 0.4));
}

/** Renvoie une copie du state qui tient dans maxTokens, et dit si on a coupé. */
export function fitState<T>(state: T, maxTokens: number): { state: T; trimmed: boolean } {
  if (estimateTokens(state) <= maxTokens) return { state, trimmed: false };
  const copy = JSON.parse(JSON.stringify(state)) as T;
  const slots: Slot[] = [];
  if (typeof copy === "string") return { state: clipMiddle(copy, maxTokens * CHARS_PER_TOKEN) as T, trimmed: true };
  collect(copy, slots);
  for (let guard = 0; guard < 50 && estimateTokens(copy) > maxTokens; guard++) {
    const longest = slots.reduce<Slot | null>((a, b) => (!a || b.get().length > a.get().length ? b : a), null);
    if (!longest || longest.get().length < 200) break;
    const excess = (estimateTokens(copy) - maxTokens) * CHARS_PER_TOKEN;
    longest.set(clipMiddle(longest.get(), Math.max(200, longest.get().length - excess - 64)));
  }
  return { state: copy, trimmed: true };
}
