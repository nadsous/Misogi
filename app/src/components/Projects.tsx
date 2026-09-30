import { useState } from "react";
import { AGENTS, api, type Agent, type Project } from "../api";
import { useT } from "../i18n";
import { inTauri, pickFolder } from "../platform";
import { AgentIcon, JevIcon } from "./Brand";
import { ConnectButton, SuggestedProjects } from "./Connect";
import { Button, ProjectIcon } from "./ui";

interface Props {
  projects: Project[];
  agentsFound: Record<Agent, string | null>;
  onChanged: () => void;
  onOpenSettings: (path: string) => void;
  onOpenGuides: (path: string, name: string) => void;
  onClose: () => void;
}

/** Tous les projets d'un coup d'œil : icône, agents branchés, état de la clé Jev. */
export function Projects({ projects, agentsFound, onChanged, onOpenSettings, onOpenGuides, onClose }: Props) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = async (p: string) => {
    if (!p.trim()) return;
    try {
      const added = await api.addProject(p);
      setPath("");
      setError(null);
      setOpen(added.path);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button onClick={onClose} className="text-xs text-muted hover:text-fg">
          ← {t("back")}
        </button>
        <span className="ml-auto text-xs font-medium">{t("projects")}</span>
      </header>
      <div className="flex-1 overflow-y-auto">
        <SuggestedProjects projects={projects} onChanged={onChanged} />
        <p className="px-3 pt-3 pb-2 text-2xs leading-relaxed text-faint">{t("projects.lead")}</p>
        {!projects.length && <p className="px-3 py-4 text-xs text-faint">{t("noProjects")}</p>}
        <ul className="divide-y divide-line border-y border-line">
          {projects.map((p) => (
            <li key={p.path}>
              <div className="flex items-center gap-2 pr-3 hover:bg-surface">
                <button onClick={() => setOpen(open === p.path ? null : p.path)} className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left">
                  <ProjectIcon path={p.path} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{p.name}</span>
                    {Object.values(p.installed).some(Boolean) ? (
                      <span className="block truncate font-mono text-2xs text-faint">{p.path}</span>
                    ) : (
                      <span className="block truncate text-2xs text-warn">{t("notConnected")}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    {AGENTS.filter((a) => agentsFound[a] || p.installed[a]).map((a) => (
                      <AgentIcon key={a} agent={a} size={18} dim={!p.installed[a]} />
                    ))}
                    <span className="mx-0.5 h-3 w-px bg-line" />
                    <JevIcon size={18} dim={p.key === "none"} />
                  </span>
                </button>
                {!Object.values(p.installed).some(Boolean) && <ConnectButton path={p.path} onDone={onChanged} />}
              </div>
              {open === p.path && <ProjectKey project={p} agentsFound={agentsFound} onChanged={onChanged} onOpenSettings={() => onOpenSettings(p.path)} onOpenGuides={() => onOpenGuides(p.path, p.name)} />}
            </li>
          ))}
        </ul>

        <div className="space-y-1.5 px-3 py-3">
          <p className="text-xs text-muted">{t("addProject")}</p>
          <div className="flex gap-1.5">
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add(path)}
              placeholder={t("addProject.placeholder")}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 font-mono text-2xs placeholder:text-faint"
            />
            {inTauri ? (
              <Button onClick={async () => { const p = await pickFolder(); if (p) await add(p); }}>{t("browse")}</Button>
            ) : (
              <Button disabled={!path.trim()} onClick={() => add(path)}>{t("add")}</Button>
            )}
          </div>
          {error && <p className="text-2xs text-bad">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function ProjectKey({ project, agentsFound, onChanged, onOpenSettings, onOpenGuides }: { project: Project; agentsFound: Record<Agent, string | null>; onChanged: () => void; onOpenSettings: () => void; onOpenGuides: () => void }) {
  const t = useT();
  const [key, setKey] = useState("");
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState(project.key === "none");
  const [status, setStatus] = useState<{ tone: "ok" | "bad" | "muted"; text: string } | null>(null);

  const run = async (fn: () => Promise<{ tone: "ok" | "bad" | "muted"; text: string } | void>) => {
    try {
      const s = await fn();
      if (s) setStatus(s);
      onChanged();
    } catch (e) {
      setStatus({ tone: "bad", text: (e as Error).message });
    }
  };
  const test = (k?: string) =>
    run(async () => {
      setStatus({ tone: "muted", text: t("key.testing") });
      const r = await api.testKey(project.path, k);
      return r.ok ? { tone: "ok", text: `${t("key.ok")} · ${r.ms} ms · ${r.model}` } : { tone: "bad", text: r.error ?? "?" };
    });

  return (
    <div className="space-y-2 bg-surface px-3 pt-1 pb-3">
      <div className="flex items-center gap-2 text-xs">
        <JevIcon size={20} dim={project.key === "none"} />
        <span className={project.key === "none" ? "text-warn" : "text-ok"}>{project.key === "none" ? t("jevMissing") : t("jevReady")}</span>
        {project.key !== "none" && <span className="text-2xs text-faint">({t(`key.${project.key}`)})</span>}
      </div>

      {editing ? (
        <>
          <div className="flex gap-1.5">
            <input
              type="password"
              autoFocus
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={t("key.placeholder")}
              className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1 font-mono text-2xs placeholder:text-faint"
            />
            <Button
              disabled={!key.trim()}
              onClick={() =>
                run(async () => {
                  const r = await api.setKey(project.path, key, all);
                  setKey("");
                  setEditing(false);
                  return { tone: "ok", text: all ? `${t("key.saved")} (${r.count})` : t("key.saved") };
                })
              }
            >
              {t("key.save")}
            </Button>
          </div>
          <label className="flex items-center gap-1.5 text-2xs text-muted">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="accent-(--accent)" />
            {t("key.all")}
          </label>
          <a href="https://console.typesafe.ai" target="_blank" rel="noreferrer" className="block text-2xs text-accent hover:underline">
            {t("key.console")} ↗
          </a>
        </>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button onClick={() => test()}>{t("key.test")}</Button>
          <Button onClick={() => setEditing(true)}>{t("key.change")}</Button>
          {project.key === "keychain" && (
            <Button danger onClick={() => run(async () => (await api.deleteKey(project.path), setEditing(true), { tone: "muted", text: "" }))}>
              {t("key.delete")}
            </Button>
          )}
        </div>
      )}
      {status?.text && <p className={`text-2xs ${status.tone === "ok" ? "text-ok" : status.tone === "bad" ? "text-bad" : "text-faint"}`}>{status.text}</p>}

      <div className="flex items-center gap-2 pt-1">
        {AGENTS.filter((a) => agentsFound[a]).map((a) => (
          <button
            key={a}
            title={project.installed[a] ? t("uninstall") : t("install")}
            onClick={() => run(async () => void (project.installed[a] ? await api.uninstall(a, project.path) : await api.install(a, project.path)))}
            className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs ${project.installed[a] ? "border-accent/50 text-fg" : "border-line text-faint"}`}
          >
            <AgentIcon agent={a} size={16} dim={!project.installed[a]} />
            {project.installed[a] ? "✓" : "+"}
          </button>
        ))}
        <button
          onClick={() => confirm(t("removeProject.confirm")) && run(async () => void (await api.removeProject(project.path)))}
          className="text-2xs text-bad hover:underline"
        >
          {t("removeProject")}
        </button>
        <span className="ml-auto flex flex-col items-end gap-1">
          <button onClick={onOpenGuides} className="whitespace-nowrap text-2xs text-accent hover:underline">
            {t("guides")} →
          </button>
          <button onClick={onOpenSettings} className="whitespace-nowrap text-2xs text-accent hover:underline">
            {t("settings")} →
          </button>
        </span>
      </div>
    </div>
  );
}
