import { AGENT_LABEL, type Agent, type Project, type ProjectActivity } from "../api";
import { useT } from "../i18n";
import { AgentIcon, JevIcon, Logo } from "./Brand";
import { ProjectIcon } from "./ui";

/** Colonne des projets à gauche, chacun avec son favicon. */
export function Rail({
  projects,
  selected,
  onSelect,
  attention,
  activity,
  onAdd,
}: {
  projects: Project[];
  selected: string | null;
  onSelect: (p: string | null) => void;
  attention: Set<string>;
  activity: (path: string) => ProjectActivity;
  onAdd: () => void;
}) {
  const t = useT();
  return (
    <nav aria-label="Projets" className="flex w-[72px] shrink-0 flex-col items-center gap-2.5 overflow-x-hidden overflow-y-auto border-r border-line bg-surface py-2">
      <button
        onClick={() => onSelect(null)}
        title={t("all")}
        aria-label={t("all")}
        aria-pressed={selected === null}
        className={`grid size-10 place-items-center rounded-lg text-2xs font-medium transition-colors ${selected === null ? "bg-raised text-fg ring-1 ring-accent/60" : "text-muted hover:bg-raised"}`}
      >
        <Logo size={26} />
      </button>
      <div className="my-0.5 h-px w-5 bg-line" />
      {projects.map((p) => (
        <button
          key={p.path}
          onClick={() => onSelect(p.path)}
          title={p.name}
          aria-label={p.name}
          aria-pressed={selected === p.path}
          className={`relative rounded-lg p-0.5 transition-opacity ${selected === p.path ? "ring-1 ring-accent/60" : "opacity-70 hover:opacity-100"}`}
        >
          <ProjectIcon path={p.path} size={34} />
          <ActivityBadges a={activity(p.path)} />
          {attention.has(p.path) && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-bad ring-2 ring-surface" />}
        </button>
      ))}
      <button onClick={onAdd} title={t("addProject")} aria-label={t("addProject")} className="mt-1 grid size-10 shrink-0 place-items-center rounded-lg border border-dashed border-line text-faint hover:border-accent hover:text-accent">
        +
      </button>
    </nav>
  );
}

const PINK = "#ec4899";

/**
 * Autour de l'avatar du projet :
 * - à gauche, en vert : l'IA a terminé son travail ; en dessous, Jev a terminé de juger ;
 * - à droite : l'IA travaille (orange), Jev juge (rose).
 */
function ActivityBadges({ a }: { a: ProjectActivity }) {
  const t = useT();
  const labels = [
    a.done && `${AGENT_LABEL[a.done]} : ${t("status.done")}`,
    a.jevDone && `Jev : ${t("status.done")}`,
    a.working && `${AGENT_LABEL[a.working]} : ${t("status.working")}`,
    a.jevBusy && `Jev : ${t("status.working")}`,
  ].filter(Boolean);
  if (!labels.length) return null;
  return (
    <>
      <span className="sr-only">{labels.join(" · ")}</span>
      <span className="pointer-events-none absolute top-1/2 -left-2 flex -translate-y-1/2 flex-col gap-0.5" aria-hidden title={labels.join(" · ")}>
        {a.done && <Badge color="var(--ok)"><AgentIcon agent={a.done} size={10} /></Badge>}
        {a.jevDone && <Badge color="var(--ok)"><JevIcon size={11} /></Badge>}
      </span>
      <span className="pointer-events-none absolute top-1/2 -right-2 flex -translate-y-1/2 flex-col gap-0.5" aria-hidden>
        {a.jevBusy && <Badge color={PINK} pulse><JevIcon size={11} /></Badge>}
        {a.working && <Badge color="var(--warn)" pulse><WorkingAgent agent={a.working} /></Badge>}
      </span>
    </>
  );
}

function WorkingAgent({ agent }: { agent: Agent }) {
  return <AgentIcon agent={agent} size={10} />;
}

function Badge({ color, pulse, children }: { color: string; pulse?: boolean; children: React.ReactNode }) {
  return (
    <span className="relative grid size-[18px] place-items-center rounded-full bg-bg" style={{ boxShadow: `0 0 0 2px ${color}` }}>
      {pulse && <span className="absolute inset-0 animate-ping rounded-full opacity-40" style={{ boxShadow: `0 0 0 2px ${color}` }} />}
      {children}
    </span>
  );
}
