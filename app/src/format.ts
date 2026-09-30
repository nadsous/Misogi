// Traduction des réponses de Jev en phrases simples et en couleurs.

import type { Key } from "./i18n";
import type { MisogiEvent } from "./api";

export type Tone = "ok" | "warn" | "bad" | "muted";

/** Markdown → texte simple, pour les aperçus d'une ligne et les notifications (pas de ** ni de # qui traînent). */
export function plainText(md: string): string {
  return md
    .replace(/```[^\n]*\n?/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*([-*_]\s*){3,}$/gm, "")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

/** Vert = accord, orange = confiance faible, rouge = bloqué ou aurait bloqué. */
export function tone(e: MisogiEvent): Tone {
  if (e.decision === "block" || e.decision === "would_block") return "bad";
  if (e.decision === "error") return "muted";
  if (e.hook === "prompt") return e.prompt?.missing ? "warn" : "muted";
  if (e.hook === "compact" || e.hook === "read" || e.hook === "find" || e.hook === "ask") return "muted";
  if (e.hook === "stop" && headline(e) === "plain.reviewIssues") return "warn";
  if (e.limit_reached) return "warn";
  if (e.hook === "pretool") return "ok";
  if (e.skipped) return e.skipped === "verified" ? "ok" : "muted";
  if (e.answers.claims_done || e.answers.outcome) {
    const h = headline(e);
    return h === "plain.fine" ? "ok" : "warn";
  }
  const low = Object.values(e.answers).some((a) => a.confidence < 0.65);
  return low || headline(e) !== "plain.agree" ? "warn" : "ok";
}

/** La phrase principale d'une décision, du plus grave au plus rassurant. */
export function headline(e: MisogiEvent): Key | null {
  if (e.decision === "error") return null;
  if (e.hook === "loop") return "plain.loop";
  if (e.hook === "prompt") return e.prompt?.missing ? "plain.promptUnclear" : "plain.promptOk";
  if (e.hook === "compact") return e.compact?.kept.length ? "plain.compactKept" : "plain.compactNone";
  if (e.hook === "read") return e.read?.window ? "plain.readNarrowed" : "plain.readWhole";
  if (e.hook === "find" || e.hook === "ask") return e.search?.results.length ? (e.hook === "find" ? "plain.find" : "plain.ask") : "plain.searchNone";
  if (e.hook === "prompt" && e.route && !e.prompt?.missing) return "plain.routed";
  const h = stopHeadline(e);
  // Rien d'anormal côté « fini ? », mais la relecture du diff a trouvé quelque chose.
  if ((h === "plain.fine" || h === "plain.verified") && reviewIssues(e).total > 0) return "plain.reviewIssues";
  return h;
}

/** Ce que la relecture du diff a relevé : affirmations absentes du diff, fichiers hors sujet, zones sensibles. */
export function reviewIssues(e: MisogiEvent): { unsupported: number; offTopic: number; sensitive: number; total: number } {
  const r = e.review;
  const unsupported = r?.claims.filter((c) => (c.verdict === "not_in_diff" || c.verdict === "contradicted") && c.p >= 0.6).length ?? 0;
  const offTopic = r?.files.filter((f) => f.related < 0.3).length ?? 0;
  const sensitive = r?.files.filter((f) => f.sensitive >= 0.7).length ?? 0;
  return { unsupported, offTopic, sensitive, total: unsupported + offTopic + sensitive };
}

function stopHeadline(e: MisogiEvent): Key | null {
  if (e.hook === "pretool") return e.decision === "block" ? "plain.guardBlock" : e.decision === "would_block" ? "plain.guardWould" : "plain.guardOk";
  if (e.limit_reached) return "plain.limit";
  if (e.resolved_by === "override" && !Object.keys(e.answers).length) return null;
  if (e.skipped === "no_changes") return "plain.noChanges";
  if (e.skipped === "verified") return "plain.verified";
  // Questions actuelles : la raison du verdict dit déjà quel fait pose problème.
  if (e.answers.claims_done || e.answers.outcome) {
    // Sans les citations (« … ») : une affirmation de l'agent citée ne doit pas fausser le résumé.
    const r = (e.reason ?? "").replace(/«[^»]*»/g, "");
    if (r.includes("échoue")) return "plain.failedCheck";
    if (r.includes("rien ne l'a vérifié")) return "plain.unproven";
    if (r.includes("aucune vérification n'a tourné")) return "plain.claimsNoCheck";
    if (r.includes("critères du ticket")) return "plain.criteria";
    if (r.includes("partiel")) return "plain.partial";
    if (r.includes("bloqué")) return "plain.blockedAgent";
    return "plain.fine";
  }
  const done = Number(e.answers.done?.answer ?? 1);
  const tests = e.answers.tests?.answer;
  const unverified = Number(e.answers.unverified?.answer ?? 0);
  if (tests === "failed") return "plain.testsFailed";
  if (e.answers.criteria && Number(e.answers.criteria.answer) < 0.5) return "plain.criteria";
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
