import { useEffect, useState } from "react";
import { api, baseName, type Pending } from "../api";
import { headline, plainText } from "../format";
import { useT } from "../i18n";
import { AgentIcon } from "./Brand";

/**
 * Jev veut renvoyer l'agent au travail : tu as quelques secondes pour trancher.
 * Sans réponse, la règle du projet s'applique (relance).
 */
export function PendingBanner({ pending }: { pending: Pending[] }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!pending.length) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [pending.length]);

  const live = pending.filter((p) => p.deadline > now);
  if (!live.length) return null;
  return (
    <section className="border-b border-bad/40 bg-bad/10" role="alertdialog" aria-live="assertive" aria-label={t("pending.title")}>
      {live.map((p) => {
        const left = Math.max(0, Math.ceil((p.deadline - now) / 1000));
        const h = headline(p.event);
        return (
          <div key={p.id} className="space-y-2 px-3 py-3">
            <div className="flex items-center gap-2 text-xs">
              <AgentIcon agent={p.event.agent} size={18} />
              <span className="font-semibold text-bad">{t("pending.title")}</span>
              <span className="ml-auto text-2xs text-muted">{baseName(p.event.project)}</span>
            </div>
            <p className="text-sm leading-snug">{h ? t(h) : plainText(p.event.reason ?? "")}</p>
            <div className="flex gap-2">
              <button autoFocus onClick={() => api.answerPending(p.id, "allow")} className="flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-xs font-medium hover:bg-raised">
                {t("pending.allow")}
              </button>
              <button onClick={() => api.answerPending(p.id, "relaunch")} className="flex-1 rounded-md bg-bad px-2 py-1.5 text-xs font-medium text-white hover:opacity-90">
                {t("pending.relaunch")}
              </button>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={left} aria-valuemin={0} aria-label={`${t("pending.auto")} ${left} s`}>
              <div className="h-full bg-bad transition-[width] duration-200" style={{ width: `${Math.min(100, (left / 12) * 100)}%` }} />
            </div>
            <p className="text-2xs text-muted">
              {t("pending.auto")} {left} s
            </p>
          </div>
        );
      })}
    </section>
  );
}
