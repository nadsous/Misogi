import { useEffect, useState } from "react";
import { AGENT_LABEL, api, baseName, type Project, type SessionStatus, type Suggested } from "../api";
import { useT } from "../i18n";
import { AgentIcon } from "./Brand";
import { ProjectIcon } from "./ui";

/** Connecte Misogi à un projet en un clic : hooks de tous les agents trouvés, mode Observer, clé Jev reprise. */
export function ConnectButton({ path, onDone, primary }: { path: string; onDone: () => void; primary?: boolean }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [error, setError] = useState("");
  return (
    <span className="flex shrink-0 flex-col items-end">
      <button
        disabled={state === "busy"}
        onClick={async (ev) => {
          ev.stopPropagation();
          setState("busy");
          try {
            await api.addProject(path);
            setState("idle");
            onDone();
          } catch (e) {
            setError((e as Error).message);
            setState("error");
          }
        }}
        className={`rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50 ${primary ? "bg-accent text-bg hover:opacity-90" : "border border-accent/60 text-accent hover:bg-accent/10"}`}
      >
        {state === "busy" ? t("connecting") : t("connect")}
      </button>
      {state === "error" && <span className="mt-0.5 max-w-40 truncate text-2xs text-bad" title={error}>{error}</span>}
    </span>
  );
}

/** Les projets où un agent a travaillé récemment sans Misogi, avec le bouton pour les connecter. */
export function SuggestedProjects({ projects, onChanged }: { projects: Project[]; onChanged: () => void }) {
  const t = useT();
  const [all, setAll] = useState<Suggested[]>([]);
  const load = () => api.suggested().then(setAll).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  // Déjà dans la liste des projets (session en cours) : il y a son propre bouton.
  const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  const list = all.filter((s) => !projects.some((p) => norm(p.path) === norm(s.path)));
  if (!list.length) return null;
  return (
    <section className="border-b border-line">
      <h3 className="px-3 pt-3 text-xs font-semibold">{t("suggested.title")}</h3>
      <p className="px-3 pt-1 pb-2 text-2xs leading-relaxed text-faint">{t("suggested.lead")}</p>
      <ul className="divide-y divide-line border-t border-line">
        {list.map((s) => (
          <li key={s.path} className="flex items-center gap-2 px-3 py-2">
            <ProjectIcon path={s.path} size={28} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{s.name}</span>
              <span className="block truncate font-mono text-2xs text-faint">{s.path}</span>
            </span>
            <span className="flex items-center gap-0.5">
              {s.agents.map((a) => (
                <AgentIcon key={a} agent={a} size={16} />
              ))}
            </span>
            <ConnectButton
              path={s.path}
              onDone={() => {
                load();
                onChanged();
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Bandeau en haut de la fenêtre : un agent travaille en ce moment dans un projet où Misogi n'est pas connecté.
 * C'est exactement le cas « j'ai codé sur un projet et Jev n'a rien fait ».
 */
export function UnconnectedBanner({ sessions, projects, onChanged }: { sessions: SessionStatus[]; projects: Project[]; onChanged: () => void }) {
  const t = useT();
  const [dismissed, setDismissed] = useState<string[]>([]);
  // Un projet absent de la liste a été retiré exprès (ou c'est un dossier temporaire) : pas de bandeau.
  const unconnected = (path: string) => {
    const p = projects.find((x) => x.path.replace(/\\/g, "/").toLowerCase() === path.replace(/\\/g, "/").toLowerCase());
    return !!p && !Object.values(p.installed).some(Boolean);
  };
  const live = sessions.find((s) => s.project && s.status !== "done" && unconnected(s.project) && !dismissed.includes(s.project));
  if (!live || !projects.length) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-line bg-warn/10 px-3 py-2">
      <AgentIcon agent={live.agent} size={18} />
      <p className="min-w-0 flex-1 text-2xs leading-snug">
        <strong className="font-semibold">{AGENT_LABEL[live.agent]}</strong> {t("banner.unconnected")} <strong className="font-semibold">{baseName(live.project)}</strong>{" "}
        {t("banner.without")}
      </p>
      <ConnectButton path={live.project} onDone={onChanged} primary />
      <button onClick={() => setDismissed((d) => [...d, live.project])} title={t("dismiss")} aria-label={t("dismiss")} className="text-faint hover:text-fg">
        ×
      </button>
    </div>
  );
}
