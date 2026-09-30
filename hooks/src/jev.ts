// Client Jev (TypeSafe System One) : POST /v1/systemone.
// Doc : https://docs.typesafe.ai/api

import type { Answer, QuestionType } from "./types.js";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";

export type Question =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export interface JevRequest {
  state: unknown;
  model: string;
  questions: Record<string, Question>;
}

export interface JevResult {
  model: string;
  answers: Record<string, Answer>;
  inputTokens: number;
}

type RawAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities?: Record<string, number>; confidence?: number }
  | { type: "score"; score: number; probabilities?: Record<string, number>; confidence?: number };

interface RawResponse {
  model: string;
  answers: Record<string, RawAnswer>;
  usage?: { input_tokens?: number };
}

export class JevError extends Error {}

export async function askJev(req: JevRequest, opts: { apiKey: string; timeoutMs: number; url?: string }): Promise<JevResult> {
  let res: Response;
  try {
    res = await fetch(opts.url ?? JEV_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const name = (err as Error).name;
    throw new JevError(name === "TimeoutError" || name === "AbortError" ? `Jev n'a pas répondu en ${opts.timeoutMs} ms` : `Jev injoignable : ${(err as Error).message}`);
  }
  if (!res.ok) throw new JevError(`Jev a répondu ${res.status}${res.status === 401 ? " (clé invalide)" : ""}`);
  return normalize((await res.json()) as RawResponse);
}

export function normalize(raw: RawResponse): JevResult {
  const answers: Record<string, Answer> = {};
  for (const [key, a] of Object.entries(raw.answers ?? {})) {
    if (a.type === "noul") {
      answers[key] = { answer: a.noul, confidence: Math.max(a.noul, 1 - a.noul) };
    } else if (a.type === "choice") {
      answers[key] = { answer: a.choice, confidence: a.confidence ?? a.probabilities?.[a.choice] ?? 0, probabilities: a.probabilities };
    } else {
      answers[key] = { answer: a.score, confidence: a.confidence ?? 0, probabilities: a.probabilities };
    }
  }
  return { model: raw.model, answers, inputTokens: raw.usage?.input_tokens ?? 0 };
}

export function questionTypes(questions: Record<string, Question>): Record<string, QuestionType> {
  return Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, q.type]));
}
