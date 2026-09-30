// Traduction des réponses de Jev en phrases simples et en couleurs.

import type { Key } from "./i18n";
import type { MisogiEvent } from "./api";

export type Tone = "ok" | "warn" | "bad" | "muted";

/** Vert = accord, orange = confiance faible, rouge = bloqué ou aurait bloqué. */
export function tone(e: MisogiEvent): Tone {
  if (e.decision === "block" || e.decision === "would_block") return "bad";
  if (e.decision === "error") return "muted";
  const low = Object.values(e.answers).some((a) => a.confidence < 0.65);
  return low || headline(e) !== "plain.agree" ? "warn" : "ok";
}

/** La phrase principale d'une décision, du plus grave au plus rassurant. */
export function headline(e: MisogiEvent): Key | null {
  if (e.decision === "error") return null;
  const done = Number(e.answers.done?.answer ?? 1);
  const tests = e.answers.tests?.answer;
  const unverified = Number(e.answers.unverified?.answer ?? 0);
  if (tests === "failed") return "plain.testsFailed";
  if (done < 0.5) return "plain.notDone";
  if (tests === "not_run") return "plain.testsNotRun";
  if (unverified > 0.5) return "plain.unverified";
  return "plain.agree";
}

export function pct(p: number): string {
  return `${Math.round(p * 100)} %`;
}

export function time(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function ago(ms: number, lang: "fr" | "en"): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "narrow" });
  if (s < 60) return rtf.format(-s, "second");
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 48 * 3600) return rtf.format(-Math.round(s / 3600), "hour");
  if (s < 60 * 86400) return rtf.format(-Math.round(s / 86400), "day");
  return rtf.format(-Math.round(s / (30 * 86400)), "month");
}

export const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", muted: "text-faint" };
export const TONE_BG: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", muted: "bg-faint" };
