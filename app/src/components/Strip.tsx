import { AGENT_LABEL, baseName, type MisogiEvent, type SessionStatus } from "../api";
import { tone } from "../format";
import { useT } from "../i18n";
import { STATUS_TONE } from "./Sessions";
import { Dot } from "./ui";

/** Mode réduit : bande de 40 px, une pastille par session, le détail au survol. */
export function Strip({ sessions, lastBySession, onExpand }: { sessions: SessionStatus[]; lastBySession: Map<string, MisogiEvent>; onExpand: () => void }) {
  const t = useT();
  const live = sessions.filter((s) => s.status !== "done").slice(0, 12);
  return (
    <div className="flex h-full w-10 flex-col items-center gap-3 border-x border-line bg-surface py-3">
      <button onClick={onExpand} title={t("expand")} className="text-faint hover:text-fg">
        ‹
      </button>
      {live.map((s) => {
        const last = lastBySession.get(s.session);
        const tn = last && tone(last) === "bad" ? "bad" : STATUS_TONE[s.status];
        return (
          <span key={`${s.agent}:${s.session}`} title={`${baseName(s.project)} · ${AGENT_LABEL[s.agent]} · ${t(`status.${s.status}`)}`} className="cursor-default">
            <Dot tone={tn} pulse={s.status === "working"} />
          </span>
        );
      })}
    </div>
  );
}
