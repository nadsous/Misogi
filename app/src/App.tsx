import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AGENT_LABEL, AGENTS, api, normPath, useStream, type Agent, type MisogiEvent, type Project, type ProjectActivity } from "./api";
import { Detail } from "./components/Detail";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { eventKey, Feed } from "./components/Feed";
import { Guides } from "./components/Guides";
import { PendingBanner } from "./components/PendingBanner";
import { Quotas } from "./components/Quotas";
import { Logo, JevIcon } from "./components/Brand";
import { Palette, type Command } from "./components/Palette";
import { Projects } from "./components/Projects";
import { Rail } from "./components/Rail";
import { Sessions } from "./components/Sessions";
import { Settings, type Theme } from "./components/Settings";
import { Strip } from "./components/Strip";
import { Kbd } from "./components/ui";
import { headline, plainText } from "./format";
import { DICTS, defaultLang, LangContext, type Lang } from "./i18n";
import { inTauri, notify, setCollapsed } from "./platform";
import { THEMES, THEME_BY_NAME, themeVars, type ThemeName } from "./themes";

type View = { kind: "feed" } | { kind: "detail"; event: MisogiEvent } | { kind: "settings" } | { kind: "projects" } | { kind: "guides"; path: string; name: string };

/** Délai de calme avant de repasser en bande, quand le repli automatique est actif. */
const CALM_MS = 2 * 60_000;

function stored<T extends string>(key: string, fallback: T): T {
  return (localStorage.getItem(key) as T) || fallback;
}

/** Paramètres d'URL (?theme=feu&lang=en&view=projects), pratiques pour les captures et la doc. */
const PARAMS = new URLSearchParams(location.search);

/** Thème choisi, avec reprise des anciens réglages « dark » / « light ». */
function storedTheme(): Theme {
  const v = PARAMS.get("theme") ?? localStorage.getItem("misogi.theme");
  if (v === "dark") return "eau";
  if (v === "light") return "rosee";
  return v === "system" || (v && v in THEME_BY_NAME) ? (v as Theme) : "system";
}

export function App() {
  const [lang, setLang] = useState<Lang>(() => (PARAMS.get("lang") as Lang | null) ?? stored("misogi.lang", defaultLang()));
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [view, setView] = useState<View>(() => {
    const v = PARAMS.get("view");
    const project = PARAMS.get("project");
    if (v === "guides" && project) return { kind: "guides", path: project, name: project.split(/[\\/]/).pop() ?? project };
    return v === "projects" ? { kind: "projects" } : v === "settings" ? { kind: "settings" } : { kind: "feed" };
  });
  const [selected, setSelected] = useState<string | null>(() => (PARAMS.get("view") ? null : PARAMS.get("project")));
  const [agentFilter, setAgentFilter] = useState<Agent | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agentsFound, setAgentsFound] = useState<Record<Agent, string | null>>({ claude: null, codex: null, kimi: null });
  const [home, setHome] = useState<string>("");
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsedState] = useState(false);
  const autoCollapsed = useRef(false);

  // La goutte qui arrive : la décision reçue en direct à l'instant.
  const [arriving, setArriving] = useState<string | null>(null);
  // Annonce pour les lecteurs d'écran : la dernière décision, en une phrase.
  const [announce, setAnnounce] = useState("");
  const onDecision = useCallback(
    (e: MisogiEvent) => {
      setArriving(eventKey(e));
      setTimeout(() => setArriving((k) => (k === eventKey(e) ? null : k)), 2500);
      const h = headline(e);
      const text = h ? DICTS[lang][h] : plainText(e.reason ?? "");
      const project = e.project.split(/[\\/]/).pop();
      setAnnounce(`${DICTS[lang]["a11y.newDecision"]} · ${project} · ${text}`);
      if (e.limit_reached) return void notify(DICTS[lang]["notify.limit"], `${project} · ${text}`);
      if (e.decision !== "would_block" && e.decision !== "block") return;
      void notify(e.hook === "pretool" ? DICTS[lang]["notify.guard"] : DICTS[lang].notifyTitle, `${project} · ${e.subject ?? text}`);
    },
    [lang],
  );
  const { events, sessions, online, pending, busy } = useStream(onDecision);

  const refresh = useCallback(() => {
    api.projects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    api.meta().then((m) => setHome(m.home)).catch(() => {});
    api.agents().then(setAgentsFound).catch(() => {});
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => localStorage.setItem("misogi.lang", lang), [lang]);
  useEffect(() => {
    localStorage.setItem("misogi.theme", theme);
    const media = matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const name: ThemeName = theme === "system" ? (media.matches ? "rosee" : "eau") : theme;
      const root = document.documentElement;
      root.dataset.theme = name;
      for (const [k, v] of Object.entries(themeVars(THEME_BY_NAME[name]))) {
        if (k === "colorScheme") root.style.colorScheme = v;
        else root.style.setProperty(k, v);
      }
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  // Suit la session active : les projets qui travaillent passent en tête, puis les plus récents.
  const ordered = useMemo(() => {
    const score = new Map<string, number>();
    for (const s of sessions) {
      const k = normPath(s.project, home);
      score.set(k, Math.max(score.get(k) ?? 0, s.updatedAt + (s.status === "done" ? 0 : 1e13)));
    }
    for (const e of events) {
      const k = normPath(e.project, home);
      score.set(k, Math.max(score.get(k) ?? 0, Date.parse(e.ts)));
    }
    return [...projects].sort((a, b) => (score.get(normPath(b.path)) ?? 0) - (score.get(normPath(a.path)) ?? 0));
  }, [projects, sessions, events, home]);

  const selectedProject = ordered.find((p) => p.path === selected) ?? null;
  const inScope = useCallback((path: string) => !selected || normPath(path, home) === normPath(selected), [selected, home]);
  const visibleEvents = useMemo(() => events.filter((e) => inScope(e.project) && (!agentFilter || e.agent === agentFilter)), [events, inScope, agentFilter]);
  const visibleSessions = useMemo(() => sessions.filter((s) => inScope(s.project) && (!agentFilter || s.agent === agentFilter)), [sessions, inScope, agentFilter]);

  // Pastille rouge sur les projets dont la dernière décision aurait bloqué.
  const attention = useMemo(() => {
    const last = new Map<string, MisogiEvent>();
    for (const e of events) last.set(normPath(e.project, home), e);
    return new Set(projects.filter((p) => ["would_block", "block"].includes(last.get(normPath(p.path))?.decision ?? "")).map((p) => p.path));
  }, [events, projects, home]);

  // Pastilles autour des avatars : IA qui travaille / a fini, Jev qui juge / a jugé.
  const activity = useMemo(() => {
    const now = Date.now();
    const out = new Map<string, ProjectActivity>();
    const get = (path: string) => {
      const k = normPath(path, home);
      if (!out.has(k)) out.set(k, {});
      return out.get(k)!;
    };
    for (const s of [...sessions].sort((a, b) => a.updatedAt - b.updatedAt)) {
      if (!s.project) continue;
      const a = get(s.project);
      if (s.status !== "done") a.working = s.agent;
      else if (now - s.updatedAt < 2 * 3600_000) a.done = s.agent;
    }
    for (const a of out.values()) if (a.working) delete a.done;
    for (const b of busy) get(b.project).jevBusy = true;
    for (const e of events) if (now - Date.parse(e.ts) < 30 * 60_000) get(e.project).jevDone = true;
    for (const a of out.values()) if (a.jevBusy) delete a.jevDone;
    return out;
  }, [sessions, busy, events, home]);

  const lastBySession = useMemo(() => new Map(events.map((e) => [e.session, e])), [events]);

  const collapse = useCallback((on: boolean, auto = false) => {
    autoCollapsed.current = on && auto;
    setCollapsedState(on);
    void setCollapsed(on);
  }, []);

  // Repli automatique en bande quand tout est calme : une option, désactivée par défaut
  // (une bande vide ressemblait à une fenêtre figée).
  const [autoCollapse, setAutoCollapse] = useState(() => localStorage.getItem("misogi.autocollapse") === "on");
  useEffect(() => {
    const onChange = () => setAutoCollapse(localStorage.getItem("misogi.autocollapse") === "on");
    addEventListener("misogi:autocollapse", onChange);
    return () => removeEventListener("misogi:autocollapse", onChange);
  }, []);

  // Au démarrage, on part toujours déployé (la fenêtre a pu être fermée en mode bande).
  useEffect(() => {
    void setCollapsed(false);
  }, []);

  // Dans Tauri, si l'option est active : se déploie quand un agent démarre, repasse en bande quand tout est calme.
  useEffect(() => {
    if (!inTauri || !autoCollapse) return;
    const busy = sessions.some((s) => s.status !== "done");
    if (busy && collapsed && autoCollapsed.current) collapse(false);
    if (!busy && !collapsed) {
      const id = setTimeout(() => collapse(true, true), CALM_MS);
      return () => clearTimeout(id);
    }
  }, [sessions, collapsed, collapse, autoCollapse]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === "Escape" && !palette) setView({ kind: "feed" });
      else if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setView({ kind: "settings" });
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [palette]);

  const d = DICTS[lang];
  const commands: Command[] = [
    { id: "settings", label: d.settings, hint: "Ctrl ,", run: () => setView({ kind: "settings" }) },
    { id: "all", label: d.showAll, run: () => (setSelected(null), setAgentFilter(null), setView({ kind: "feed" })) },
    ...AGENTS.map((a) => ({ id: `agent-${a}`, label: d.filterAgent + AGENT_LABEL[a], run: () => setAgentFilter(a) })),
    ...ordered.map((p) => ({ id: `p-${p.path}`, label: d.goToProject + p.name, run: () => (setSelected(p.path), setView({ kind: "feed" })) })),
    { id: "projects", label: d.projects, run: () => setView({ kind: "projects" }) },
    ...THEMES.map((th) => ({ id: `theme-${th.name}`, label: `${d.drops} : ${th.label[lang]}`, hint: th.ref[lang].split(":")[0], run: () => setTheme(th.name) })),
    { id: "lang", label: lang === "fr" ? "Language: English" : "Langue : français", run: () => setLang(lang === "fr" ? "en" : "fr") },
    { id: "collapse", label: d.collapse, run: () => collapse(true) },
  ];

  if (collapsed) {
    return (
      <LangContext.Provider value={lang}>
        <Strip sessions={sessions} lastBySession={lastBySession} onExpand={() => collapse(false)} />
      </LangContext.Provider>
    );
  }

  return (
    <LangContext.Provider value={lang}>
      <div className="flex h-full">
        <Rail projects={ordered} selected={selected} onSelect={(p) => (setSelected(p), setView({ kind: "feed" }))} attention={attention} activity={(p) => activity.get(normPath(p)) ?? {}} onAdd={() => setView({ kind: "projects" })} />
        <main className="flex min-w-0 flex-1 flex-col">
          <ErrorBoundary key={view.kind} onReset={() => setView({ kind: "feed" })} label={{ title: d["crash.title"], back: d["crash.back"] }}>
          {view.kind === "detail" ? (
            <Detail event={view.event} onClose={() => setView({ kind: "feed" })} />
          ) : view.kind === "guides" ? (
            <Guides path={view.path} name={view.name} onClose={() => setView({ kind: "projects" })} />
          ) : view.kind === "projects" ? (
            <Projects
              projects={ordered}
              agentsFound={agentsFound}
              onChanged={refresh}
              onOpenSettings={(p) => (setSelected(p), setView({ kind: "settings" }))}
              onOpenGuides={(p, name) => setView({ kind: "guides", path: p, name })}
              onClose={() => setView({ kind: "feed" })}
            />
          ) : view.kind === "settings" ? (
            <Settings
              project={selectedProject}
              seenModel={[...events].reverse().find((e) => e.model && e.model !== "mock" && e.model !== "jev-latest" && (!selected || normPath(e.project, home) === normPath(selected)))?.model}
              agentsFound={agentsFound}
              lang={lang}
              theme={theme}
              onLang={setLang}
              onTheme={setTheme}
              onChanged={refresh}
              onClose={() => setView({ kind: "feed" })}
            />
          ) : (
            <>
              <header className="flex items-center gap-2 border-b border-line px-3 py-2" data-tauri-drag-region>
                <Logo size={24} />
                <span className="min-w-0 truncate text-[15px] font-semibold" data-tauri-drag-region>
                  {selectedProject?.name ?? "Misogi"}
                </span>
                {agentFilter && (
                  <button onClick={() => setAgentFilter(null)} className="rounded border border-accent/50 px-1 text-2xs text-accent">
                    {AGENT_LABEL[agentFilter]} ✕
                  </button>
                )}
                <span className={`size-1.5 shrink-0 rounded-full ${online ? "bg-ok" : "bg-bad"}`} title={online ? "live" : d.offline} />
                <span className="ml-auto flex items-center gap-2">
                  <button onClick={() => setPalette(true)} className="hidden sm:inline-flex" aria-label="Palette">
                    <Kbd>⌘K</Kbd>
                  </button>
                  <button onClick={() => setView({ kind: "projects" })} aria-label={d.projects} title={d.projects} className="hover:opacity-80">
                    <JevIcon size={20} dim={!!selectedProject && selectedProject.key === "none"} />
                  </button>
                  <button onClick={() => setView({ kind: "settings" })} className="text-muted hover:text-fg" aria-label={d.settings} title={d.settings}>
                    ⚙
                  </button>
                  <button onClick={() => collapse(true)} className="text-muted hover:text-fg" aria-label={d.collapse} title={d.collapse}>
                    ›
                  </button>
                </span>
              </header>
              {!online && <p className="border-b border-line bg-bad/10 px-3 py-1.5 text-2xs text-bad">{d.offline}</p>}
              <PendingBanner pending={pending} />
              <Quotas />
              <Sessions sessions={visibleSessions} />
              <div className="flex-1 overflow-y-auto">
                <Feed events={visibleEvents} onOpen={(event) => setView({ kind: "detail", event })} showProject={!selected} arriving={arriving} />
              </div>
            </>
          )}
          </ErrorBoundary>
        </main>
      </div>
      {palette && <Palette commands={commands} onClose={() => setPalette(false)} />}
      <p className="sr-only" aria-live="polite" role="status">
        {announce}
      </p>
    </LangContext.Provider>
  );
}
