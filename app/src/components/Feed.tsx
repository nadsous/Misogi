import { useEffect, useState } from "react";
import { api, baseName, type MisogiEvent, type OverrideAction, type Verdict } from "../api";
import { headline, pct, plainText, reviewIssues, time, tone, TONE_BG, TONE_TEXT, type Tone } from "../format";
import { useT, type Key } from "../i18n";
import { LOGO_PATH, LOGO_VIEWBOX } from "../logo";
import { AgentIcon } from "./Brand";
import { Gauge } from "./ui";

const DECISION_STYLE: Record<MisogiEvent["decision"], string> = {
  allow: "text-ok",
  block: "text-bad",
  would_block: "text-bad",
  error: "text-faint",
};

export function eventKey(e: MisogiEvent): string {
  return `${e.ts}:${e.session}:${e.state_hash}`;
}

/**
 * Le fil des décisions est un ruisseau : l'eau coule le long de la marge gauche,
 * chaque décision est une halte sur le courant, et la plus récente reçoit une goutte qui tombe.
 */
/** Une relecture de demande sans rien à signaler n'a pas sa place dans le fil : chaque message en ferait une. */
function worthShowing(e: MisogiEvent): boolean {
  // Une lecture laissée entière n'a rien changé : elle reste dans le détail du journal, pas dans le fil.
  if (e.hook === "read") return !!e.read?.window;
  if (e.hook !== "prompt") return true;
  // Avec le routeur, chaque message a son modèle : on le montre toujours.
  return !!(e.route || (e.prompt && (e.prompt.missing || e.prompt.skill || e.prompt.section)));
}

export function Feed({ events: all, onOpen, showProject, arriving }: { events: MisogiEvent[]; onOpen: (e: MisogiEvent) => void; showProject: boolean; arriving: string | null }) {
  const t = useT();
  const events = all.filter(worthShowing);
  const [feedback, setFeedback] = useState<Record<string, Verdict>>({});
  useEffect(() => {
    api.feedback().then(setFeedback).catch(() => {});
  }, []);
  const rate = async (key: string, v: Verdict) => setFeedback(await api.setFeedback(key, feedback[key] === v ? null : v));
  // Les plus récentes d'abord, par pages de 200 : un long historique ne ralentit plus la fenêtre.
  const [limit, setLimit] = useState(PAGE);
  if (!events.length)
    return (
      <div className="relative flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <StreamLine />
        <p className="relative text-xs leading-relaxed text-faint">{t("noDecisions")}</p>
      </div>
    );
  return (
    <div className="relative min-h-full">
      <StreamLine />
      <ul className="relative" aria-label="Décisions">
        {events.slice(-limit).reverse().map((e) => (
          <li key={eventKey(e)} className="border-b border-line/60">
            <DecisionCard event={e} onOpen={() => onOpen(e)} showProject={showProject} arriving={arriving === eventKey(e)} verdict={feedback[eventKey(e)]} onRate={(v) => rate(eventKey(e), v)} />
          </li>
        ))}
      </ul>
      {events.length > limit && (
        <button onClick={() => setLimit((l) => l + PAGE)} className="relative block w-full py-3 text-center text-2xs text-accent hover:underline">
          {t("feed.more")} ({events.length - limit})
        </button>
      )}
    </div>
  );
}

const PAGE = 200;

/** Le courant : une ligne ondulée dont les tirets glissent vers le bas. */
function StreamLine() {
  return (
    <svg className="pointer-events-none absolute inset-y-0 left-[13px] h-full w-4" preserveAspectRatio="none" viewBox="0 0 16 100" aria-hidden>
      <path d="M8 0 C 3 12, 13 22, 8 34 S 3 56, 8 68 S 13 88, 8 100" fill="none" stroke="var(--accent)" strokeOpacity="0.14" strokeWidth="5" vectorEffect="non-scaling-stroke" />
      <path d="M8 0 C 3 12, 13 22, 8 34 S 3 56, 8 68 S 13 88, 8 100" fill="none" stroke="var(--accent)" strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="4 10" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="animate-flow" />
    </svg>
  );
}

function DecisionCard({ event: e, onOpen, showProject, arriving, verdict, onRate }: { event: MisogiEvent; onOpen: () => void; showProject: boolean; arriving: boolean; verdict?: Verdict; onRate: (v: Verdict) => void }) {
  const t = useT();
  const tn = tone(e);
  const h = headline(e);
  const title = h ? t(h) : plainText(e.reason ?? "");
  // Actions pour le prochain arrêt de cette session : utiles quand Jev bloque, ou quand la limite est atteinte.
  const canAct = e.hook === "stop" && e.session && (e.decision === "block" || e.decision === "would_block" || e.limit_reached);
  return (
    <article className={`relative ${arriving ? "animate-arrive" : ""}`} aria-label={`${time(e.ts)} · ${title}`}>
      {/* Halte sur le courant, à la couleur de la décision. */}
      <span className="pointer-events-none absolute top-[18px] left-[15px] grid size-3 place-items-center" aria-hidden>
        {arriving && (
          <>
            <svg viewBox={LOGO_VIEWBOX} className="absolute -top-2 size-5 animate-drop">
              <path d={LOGO_PATH} fill="var(--logo-bottom)" fillOpacity="0.9" />
            </svg>
            <span className={`absolute size-3 rounded-full border-2 animate-ripple ${BORDER_TONE[tn]}`} />
            <span className={`absolute size-3 rounded-full border animate-ripple [animation-delay:900ms] ${BORDER_TONE[tn]}`} />
          </>
        )}
        <span className={`size-3 rounded-full ring-4 ring-bg ${TONE_BG[tn]}`} />
      </span>

      <button data-card onClick={onOpen} onKeyDown={moveFocus} className="block w-full py-3 pr-3 pl-10 text-left transition-colors hover:bg-surface/70">
        <div className="flex items-center gap-2 text-2xs text-faint">
          <span className="font-mono">{time(e.ts)}</span>
          <AgentIcon agent={e.agent} size={17} />
          {showProject && <span className="min-w-0 truncate text-muted">{baseName(e.project)}</span>}
          {e.origin && <span className="shrink-0 rounded bg-raised px-1 text-2xs text-muted" title={e.origin}>⇄ {e.origin}</span>}
          {e.hook === "stop" || e.hook === "pretool" ? (
            <span className={`ml-auto shrink-0 ${DECISION_STYLE[e.decision]}`}>
              {t(`decision.${e.decision}`)}
              {e.mode === "shadow" && e.decision !== "error" && <span className="text-faint"> · shadow</span>}
            </span>
          ) : (
            // Aides (demande, compaction, boucle) : elles ne laissent passer ni ne bloquent rien.
            <span className={`ml-auto shrink-0 ${e.hook === "loop" ? "text-bad" : "text-muted"}`}>{t(`hook.${e.hook}` as Key)}</span>
          )}
        </div>
        <p className={`mt-1.5 text-[15px] leading-snug font-medium ${h === "plain.agree" || h === "plain.guardOk" ? "text-fg" : TONE_TEXT[tn]}`}>{title}</p>
        {e.summary?.request && <p className="mt-1 line-clamp-2 text-2xs leading-snug text-muted italic">« {plainText(e.summary.request)} »</p>}
        {e.ticket && (
          <span className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-line px-1.5 py-0.5 text-2xs text-muted">
            <span className="font-mono text-fg">{e.ticket.id}</span>
            <span className="truncate">{e.ticket.title}</span>
          </span>
        )}
        {e.subject && e.hook !== "read" && <code className="mt-1.5 block truncate rounded bg-raised px-2 py-1 font-mono text-2xs text-fg/90">{e.subject}</code>}
        {(e.resolved_by || (e.relaunches ?? 0) > 0) && (
          <p className="mt-1 text-2xs text-faint">
            {e.resolved_by && t(`resolved.${e.resolved_by}`)}
            {e.resolved_by && (e.relaunches ?? 0) > 0 && " · "}
            {(e.relaunches ?? 0) > 0 && `${t("relaunches")} : ${e.relaunches}`}
          </p>
        )}
        <AssistLine event={e} />
        {e.decision !== "error" && (e.hook === "stop" || e.hook === "pretool") && Object.keys(e.answers).length > 0 && (
          <dl className="mt-2.5 space-y-1.5">
            {Object.entries(e.answers).map(([k, a]) => (
              <AnswerRow key={k} name={k} answer={a.answer} confidence={a.confidence} />
            ))}
          </dl>
        )}
      </button>
      {canAct && <NextStopActions event={e} />}
      {e.decision !== "error" && Object.keys(e.answers).length > 0 && (
        <div className="flex items-center gap-2 pr-3 pb-2.5 pl-10 text-2xs text-faint">
          <span>{verdict ? t("fb.thanks") : t("fb.question")}</span>
          {(["right", "wrong"] as const).map((v) => (
            <button
              key={v}
              onClick={() => onRate(v)}
              aria-pressed={verdict === v}
              className={`rounded-md border px-1.5 py-0.5 transition-colors ${verdict === v ? (v === "right" ? "border-ok bg-ok/15 text-ok" : "border-bad bg-bad/15 text-bad") : "border-line hover:text-fg"}`}
            >
              {v === "right" ? `✓ ${t("fb.right")}` : `✗ ${t("fb.wrong")}`}
            </button>
          ))}
          {e.ticket && (
            <a href={e.ticket.url} target="_blank" rel="noreferrer" className="ml-auto text-accent hover:underline">
              {e.ticket.id} ↗
            </a>
          )}
        </div>
      )}
    </article>
  );
}

/** « Laisser passer » / « Relancer » : une consigne que le hook appliquera au prochain arrêt de cette session. */
function NextStopActions({ event: e }: { event: MisogiEvent }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const send = async (action: OverrideAction) => {
    await api.override(e.agent, e.session, action);
    setDone(true);
  };
  if (done) return <p className="pb-3 pl-10 text-2xs text-ok" role="status">✓ {t("action.done")}</p>;
  return (
    <div className="flex flex-wrap gap-1.5 pr-3 pb-3 pl-10">
      <button onClick={() => send("allow")} className="rounded-md border border-line px-2 py-1 text-2xs text-fg hover:bg-raised">
        {t("action.allowNext")}
      </button>
      {e.decision !== "block" && (
        <button onClick={() => send("relaunch")} className="rounded-md border border-accent/50 px-2 py-1 text-2xs text-accent hover:bg-accent/10">
          {t("action.relaunchNext")}
        </button>
      )}
    </div>
  );
}

/** Flèches haut/bas pour passer d'une décision à l'autre au clavier. */
function moveFocus(ev: React.KeyboardEvent<HTMLButtonElement>) {
  if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
  ev.preventDefault();
  const cards = [...document.querySelectorAll<HTMLButtonElement>("[data-card]")];
  const i = cards.indexOf(ev.currentTarget);
  cards[ev.key === "ArrowDown" ? Math.min(i + 1, cards.length - 1) : Math.max(i - 1, 0)]?.focus();
}

const BORDER_TONE: Record<Tone, string> = { ok: "border-ok", warn: "border-warn", bad: "border-bad", muted: "border-faint" };

function AnswerRow({ name, answer, confidence }: { name: string; answer: string | number; confidence: number }) {
  const t = useT();
  const label = (`q.${name}` as Key) in QUESTION_KEYS ? t(`q.${name}` as Key) : name;
  let value: string;
  let tn: Tone;
  if (typeof answer === "number") {
    // noul : probabilité du oui. « Terminé » est bon quand il est haut ; les questions de risque, quand il est bas.
    const good = RISK_QUESTIONS.has(name) ? 1 - answer : answer;
    value = pct(answer);
    tn = NEUTRAL_QUESTIONS.has(name) ? "muted" : good >= 0.65 ? "ok" : good >= 0.5 ? "warn" : "bad";
  } else if (name === "outcome") {
    value = (`outcome.${answer}` as Key) in OUTCOME_KEYS ? t(`outcome.${answer}` as Key) : answer;
    tn = answer === "complete" || answer === "other" ? "ok" : "warn";
  } else {
    value = (`tests.${answer}` as Key) in TEST_KEYS ? t(`tests.${answer}` as Key) : answer;
    tn = answer === "failed" ? "bad" : answer === "not_run" ? "warn" : "ok";
  }
  return (
    <div className="flex items-center gap-2 text-2xs">
      <dt className="w-[42%] shrink-0 truncate text-muted">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center gap-2">
        <Gauge value={typeof answer === "number" ? answer : confidence} tone={tn} />
        <span className="truncate text-fg/80">{value}</span>
      </dd>
    </div>
  );
}

const QUESTION_KEYS = {
  "q.done": 1,
  "q.tests": 1,
  "q.unverified": 1,
  "q.destructive": 1,
  "q.exfiltration": 1,
  "q.secrets": 1,
  "q.criteria": 1,
  "q.claims_done": 1,
  "q.claims_verified": 1,
  "q.verification_applies": 1,
  "q.outcome": 1,
};
// Questions où « oui » est le signal d'alerte (la barre est rouge quand la probabilité est haute).
const RISK_QUESTIONS = new Set(["unverified", "destructive", "exfiltration", "secrets", "claims_verified"]);
// Questions descriptives : ni bonnes ni mauvaises en soi, affichées en neutre.
const NEUTRAL_QUESTIONS = new Set(["claims_done", "verification_applies"]);
const OUTCOME_KEYS = { "outcome.complete": 1, "outcome.partial": 1, "outcome.blocked": 1, "outcome.other": 1 };
const TEST_KEYS = { "tests.passed": 1, "tests.failed": 1, "tests.not_run": 1, "tests.not_needed": 1 };

/** Ce que les aides de Jev ont relevé, en petites étiquettes : relecture du diff, de la demande, compaction, boucle. */
function AssistLine({ event: e }: { event: MisogiEvent }) {
  const t = useT();
  const chips: { text: string; tone: Tone }[] = [];
  if (e.hook === "stop") {
    const r = reviewIssues(e);
    if (r.unsupported) chips.push({ text: `✗ ${r.unsupported} ${t(r.unsupported > 1 ? "chip.claims" : "chip.claim")}`, tone: "bad" });
    if (r.offTopic) chips.push({ text: `${r.offTopic} ${t("chip.offTopic")}`, tone: "warn" });
    if (r.sensitive) chips.push({ text: `⚠ ${r.sensitive} ${t(r.sensitive > 1 ? "chip.sensitives" : "chip.sensitive")}`, tone: "warn" });
    if (e.review?.suggested_check && !e.facts?.verified_after_last_edit) chips.push({ text: `▶ ${e.review.suggested_check.command}`, tone: "muted" });
  }
  if (e.route) chips.push({ text: `→ ${e.route.model}${e.route.escalated ? " ↑" : ""}`, tone: e.route.tier === "frontier" ? "warn" : "ok" });
  if (e.hook === "read" && e.read?.window) chips.push({ text: `${e.read.file} · ${e.read.window[0]}–${e.read.window[1]} / ${e.read.lines}`, tone: "muted" });
  if ((e.hook === "find" || e.hook === "ask") && e.search) {
    return (
      <span className="mt-1 block space-y-0.5 font-mono text-2xs text-muted">
        {e.search.results.slice(0, 3).map((r) => (
          <span key={r.path} className="block truncate">
            {r.p.toFixed(2)} {r.path}
            {r.line ? `:${r.line}` : ""}
          </span>
        ))}
      </span>
    );
  }
  if (e.hook === "prompt" && e.prompt) {
    if (!e.route) chips.push({ text: `${t("chip.model")} ${e.prompt.model}`, tone: "muted" });
    if (e.prompt.skill) chips.push({ text: e.prompt.skill.name, tone: "ok" });
    if (e.prompt.section) chips.push({ text: e.prompt.section.name, tone: "ok" });
    if (e.prompt.injected) chips.push({ text: t("chip.injected"), tone: "muted" });
  }
  if (e.hook === "compact" && e.compact?.kept.length) {
    return <p className="mt-1 line-clamp-2 text-2xs text-muted">{e.compact.kept.map((k) => `« ${plainText(k)} »`).join(" · ")}</p>;
  }
  if (e.hook === "loop" && e.loop) return <p className="mt-1 text-2xs text-muted">{e.loop.signal}</p>;
  if (!chips.length) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1">
      {chips.map((c) => (
        <span key={c.text} className={`max-w-full truncate rounded-md border border-line px-1.5 py-0.5 font-mono text-2xs ${c.tone === "muted" ? "text-muted" : TONE_TEXT[c.tone]}`}>
          {c.text}
        </span>
      ))}
    </span>
  );
}
