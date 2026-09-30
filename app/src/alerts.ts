// Alertes, comme dans T3 Code : un son quand un agent a fini son tour, un autre quand Misogi a besoin
// que tu tranches, et une notification système si la fenêtre de Misogi est cachée.

import { useEffect, useRef } from "react";
import { AGENT_LABEL, baseName, type Pending, type SessionStatus } from "./api";
import { DICTS, type Lang } from "./i18n";
import { notify } from "./platform";
import { playChime } from "./sound";

/** Un « terminé » qui date de plus longtemps vient d'une session inactive, pas d'un tour qui vient de finir. */
const FRESH_MS = 90_000;

export const soundOn = () => localStorage.getItem("misogi.sound") !== "off";
export const notifyDoneOn = () => localStorage.getItem("misogi.notifyDone") !== "off";

export function useSessionAlerts(sessions: SessionStatus[], pending: Pending[], lang: Lang): void {
  const previous = useRef<Map<string, SessionStatus["status"]> | null>(null);
  const seenPending = useRef<Set<string> | null>(null);

  // Fin de tour : une session qui passe à « terminé ». (Pas de son pour « attend » : ce statut est deviné
  // d'après un outil lent, et sonnerait aussi pendant un long `npm test`.)
  useEffect(() => {
    const now = Date.now();
    const before = previous.current;
    previous.current = new Map(sessions.map((s) => [`${s.agent}:${s.session}`, s.status]));
    if (!before) return; // premier état reçu : rien ne vient de changer
    const done = sessions.find((s) => {
      const was = before.get(`${s.agent}:${s.session}`);
      return was && was !== "done" && s.status === "done" && now - s.updatedAt < FRESH_MS;
    });
    if (!done) return;
    if (soundOn()) playChime("done");
    if (notifyDoneOn() && document.hidden) void notify(`${AGENT_LABEL[done.agent]} · ${baseName(done.project)}`, DICTS[lang]["alert.done"]);
  }, [sessions, lang]);

  // Misogi te demande de trancher (relancer ou laisser passer) : c'est un vrai « on t'attend ».
  useEffect(() => {
    const before = seenPending.current;
    seenPending.current = new Set(pending.map((p) => p.id));
    if (!before) return;
    const fresh = pending.find((p) => !before.has(p.id));
    if (!fresh) return;
    if (soundOn()) playChime("waiting");
    if (notifyDoneOn() && document.hidden) void notify(`${AGENT_LABEL[fresh.event.agent]} · ${baseName(fresh.event.project)}`, DICTS[lang]["alert.waiting"]);
  }, [pending, lang]);
}
