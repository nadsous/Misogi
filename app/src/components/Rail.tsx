import type { Project } from "../api";
import { useT } from "../i18n";
import { Logo } from "./Brand";
import { ProjectIcon } from "./ui";

/** Colonne des projets à gauche, chacun avec son favicon. */
export function Rail({ projects, selected, onSelect, attention, onAdd }: { projects: Project[]; selected: string | null; onSelect: (p: string | null) => void; attention: Set<string>; onAdd: () => void }) {
  const t = useT();
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-r border-line bg-surface py-2">
      <button
        onClick={() => onSelect(null)}
        title={t("all")}
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
          className={`relative rounded-lg p-0.5 transition-opacity ${selected === p.path ? "ring-1 ring-accent/60" : "opacity-70 hover:opacity-100"}`}
        >
          <ProjectIcon path={p.path} size={34} />
          {attention.has(p.path) && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-bad ring-2 ring-surface" />}
        </button>
      ))}
      <button onClick={onAdd} title={t("addProject")} className="mt-1 grid size-10 shrink-0 place-items-center rounded-lg border border-dashed border-line text-faint hover:border-accent hover:text-accent">
        +
      </button>
    </nav>
  );
}
