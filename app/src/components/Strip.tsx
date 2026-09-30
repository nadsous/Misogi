import { AGENT_LABEL, baseName, type MisogiEvent, type SessionStatus } from "../api";
import { tone } from "../format";
import { useT } from "../i18n";
import { Logo } from "./Brand";
import { STATUS_TONE } from "./Sessions";
import { Dot } from "./ui";

/**
 * Mode réduit : bande de 40 px, une pastille par session, le détail au survol.
 * Toute la bande est un bouton : un clic n'importe où la redéploie.
 */
export function Strip({ sessions, lastBySession, onExpand }: { sessions: SessionStatus[]; lastBySession: Map<string, MisogiEvent>; onExpand: () => void }) {
  const t = useT();
  const live = sessions.filter((s) => s.status !== "done").slice(0, 12);
  return (
    <button
      onClick={onExpand}
      title={t("expand")}
      aria-label={t("expand")}
      className="group flex h-full w-10 flex-col items-center gap-3 border-x border-line bg-surface py-3 hover:bg-raised"
    >
      <Logo size={24} />
      <span className="text-lg leading-none text-muted group-hover:text-fg">‹</span>
      {live.map((s) => {
        const last = lastBySession.get(s.session);
        const tn = last && tone(last) === "bad" ? "bad" : STATUS_TONE[s.status];
        return (
          <span key={`${s.agent}:${s.session}`} title={`${baseName(s.project)} · ${AGENT_LABEL[s.agent]} · ${t(`status.${s.status}`)}`}>
            <Dot tone={tn} pulse={s.status === "working"} />
          </span>
        );
      })}
      <span className="mt-auto text-2xs text-faint [writing-mode:vertical-rl] group-hover:text-fg">{t("expand")}</span>
    </button>
  );
}
