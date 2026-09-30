import { baseName, type MisogiEvent } from "../api";
import { headline, pct, time, tone, TONE_BG, TONE_TEXT, type Tone } from "../format";
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
export function Feed({ events, onOpen, showProject, arriving }: { events: MisogiEvent[]; onOpen: (e: MisogiEvent) => void; showProject: boolean; arriving: string | null }) {
  const t = useT();
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
      <ul className="relative">
        {[...events].reverse().map((e) => (
          <li key={eventKey(e)} className="border-b border-line/60">
            <DecisionCard event={e} onOpen={() => onOpen(e)} showProject={showProject} arriving={arriving === eventKey(e)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Le courant : une ligne ondulée dont les tirets glissent vers le bas. */
function StreamLine() {
  return (
    <svg className="pointer-events-none absolute inset-y-0 left-[13px] h-full w-4" preserveAspectRatio="none" viewBox="0 0 16 100" aria-hidden>
      <path d="M8 0 C 3 12, 13 22, 8 34 S 3 56, 8 68 S 13 88, 8 100" fill="none" stroke="var(--accent)" strokeOpacity="0.14" strokeWidth="5" vectorEffect="non-scaling-stroke" />
      <path d="M8 0 C 3 12, 13 22, 8 34 S 3 56, 8 68 S 13 88, 8 100" fill="none" stroke="var(--accent)" strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="4 10" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="animate-flow" />
    </svg>
  );
}

function DecisionCard({ event: e, onOpen, showProject, arriving }: { event: MisogiEvent; onOpen: () => void; showProject: boolean; arriving: boolean }) {
  const t = useT();
  const tn = tone(e);
  const h = headline(e);
  return (
    <button onClick={onOpen} className={`relative block w-full py-3 pr-3 pl-10 text-left transition-colors hover:bg-surface/70 ${arriving ? "animate-arrive" : ""}`}>
      {/* Halte sur le courant, à la couleur de la décision. */}
      <span className="absolute top-[18px] left-[15px] grid size-3 place-items-center">
        {arriving && (
          <>
            <svg viewBox={LOGO_VIEWBOX} className="absolute -top-2 size-5 animate-drop" aria-hidden>
              <path d={LOGO_PATH} fill="var(--logo-bottom)" fillOpacity="0.9" />
            </svg>
            <span className={`absolute size-3 rounded-full border-2 animate-ripple ${BORDER_TONE[tn]}`} />
            <span className={`absolute size-3 rounded-full border animate-ripple [animation-delay:900ms] ${BORDER_TONE[tn]}`} />
          </>
        )}
        <span className={`size-3 rounded-full ring-4 ring-bg ${TONE_BG[tn]}`} />
      </span>

      <div className="flex items-center gap-2 text-2xs text-faint">
        <span className="font-mono">{time(e.ts)}</span>
        <AgentIcon agent={e.agent} size={17} />
        {showProject && <span className="min-w-0 truncate text-muted">{baseName(e.project)}</span>}
        <span className={`ml-auto shrink-0 ${DECISION_STYLE[e.decision]}`}>
          {t(`decision.${e.decision}`)}
          {e.mode === "shadow" && e.decision !== "error" && <span className="text-faint"> · shadow</span>}
        </span>
      </div>
      <p className={`mt-1.5 text-[15px] leading-snug font-medium ${h === "plain.agree" ? "text-fg" : TONE_TEXT[tn]}`}>{h ? t(h) : e.reason}</p>
      {e.decision !== "error" && (
        <dl className="mt-2.5 space-y-1.5">
          {Object.entries(e.answers).map(([k, a]) => (
            <AnswerRow key={k} name={k} answer={a.answer} confidence={a.confidence} />
          ))}
        </dl>
      )}
    </button>
  );
}

const BORDER_TONE: Record<Tone, string> = { ok: "border-ok", warn: "border-warn", bad: "border-bad", muted: "border-faint" };

function AnswerRow({ name, answer, confidence }: { name: string; answer: string | number; confidence: number }) {
  const t = useT();
  const label = (`q.${name}` as Key) in QUESTION_KEYS ? t(`q.${name}` as Key) : name;
  let value: string;
  let tn: Tone;
  if (typeof answer === "number") {
    // noul : probabilité du oui. « Terminé » est bon quand il est haut, « non vérifié » quand il est bas.
    const good = name === "unverified" ? 1 - answer : answer;
    value = pct(answer);
    tn = good >= 0.65 ? "ok" : good >= 0.5 ? "warn" : "bad";
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

const QUESTION_KEYS = { "q.done": 1, "q.tests": 1, "q.unverified": 1 };
const TEST_KEYS = { "tests.passed": 1, "tests.failed": 1, "tests.not_run": 1, "tests.not_needed": 1 };
