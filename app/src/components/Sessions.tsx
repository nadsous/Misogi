import { baseName, type SessionStatus } from "../api";
import { ago, type Tone } from "../format";
import { LangContext, useT } from "../i18n";
import { useContext } from "react";
import { AgentIcon } from "./Brand";
import { Dot } from "./ui";

export const STATUS_TONE: Record<SessionStatus["status"], Tone> = { working: "ok", waiting: "warn", done: "muted" };

/** Une session qui travaille : l'eau coule. */
function FlowingWave() {
  return (
    <span className="relative inline-flex h-3 w-4 shrink-0 overflow-hidden" aria-hidden>
      <svg viewBox="0 0 28 12" className="absolute left-0 h-3 w-7 animate-wave">
        <path d="M0 6 Q 3 1 6 6 T 12 6 T 18 6 T 24 6 T 30 6" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function Sessions({ sessions }: { sessions: SessionStatus[] }) {
  const t = useT();
  const lang = useContext(LangContext);
  const live = sessions.filter((s) => s.status !== "done").concat(sessions.filter((s) => s.status === "done").slice(0, 2));
  if (!live.length) return null;
  return (
    <section className="border-b border-line px-3 py-2">
      <h2 className="mb-1.5 text-2xs font-medium tracking-wider text-faint uppercase">{t("sessions")}</h2>
      <ul className="space-y-1">
        {live.slice(0, 5).map((s) => (
          <li key={`${s.agent}:${s.session}`} className="flex items-center gap-2.5 text-xs">
            {s.status === "working" ? <FlowingWave /> : <Dot tone={STATUS_TONE[s.status]} />}
            <span className="min-w-0 flex-1 truncate">{baseName(s.project) || "—"}</span>
            <AgentIcon agent={s.agent} size={18} />
            <span className={`shrink-0 ${s.status === "waiting" ? "text-warn" : "text-faint"}`}>{s.status === "done" ? ago(s.updatedAt, lang) : t(`status.${s.status}`)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
