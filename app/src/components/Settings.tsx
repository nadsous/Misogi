import { useEffect, useState } from "react";
import { AGENT_LABEL, AGENTS, api, type Agent, type Project, type ProjectConfig } from "../api";
import { useT, type Lang } from "../i18n";
import { THEMES, themeVars, type ThemeName } from "../themes";
import { Logo } from "./Brand";
import { Code } from "./Detail";
import { Button, ProjectIcon, Segmented, Tip } from "./ui";

export type Theme = "system" | ThemeName;

/** Choix de la goutte : chaque vignette est rendue avec les couleurs de son propre thème. */
function ThemePicker({ value, lang, onChange }: { value: Theme; lang: Lang; onChange: (t: Theme) => void }) {
  const t = useT();
  const tile = (v: Theme, label: string, ref: string, vars?: Record<string, string>) => (
    <button
      key={v}
      title={ref}
      onClick={() => onChange(v)}
      style={vars as React.CSSProperties}
      className={`flex flex-col items-center gap-1 rounded-xl border bg-bg px-1 pt-2.5 pb-2 text-2xs text-fg transition-transform hover:-translate-y-0.5 ${value === v ? "border-accent ring-2 ring-accent/50" : "border-line"}`}
    >
      <Logo size={34} />
      <span className="truncate">{label}</span>
    </button>
  );
  const group = (scheme: "dark" | "light") => THEMES.filter((th) => th.scheme === scheme).map((th) => tile(th.name, th.label[lang], th.ref[lang], themeVars(th)));
  return (
    <div className="space-y-2">
      <span className="flex items-center gap-1 text-xs text-muted">
        {t("drops")}
        <Tip text={t("drops.help")} />
      </span>
      <div className="grid grid-cols-3 gap-2">{tile("system", t("theme.system"), "Eau / Rosée")}</div>
      <p className="text-2xs tracking-wider text-faint uppercase">{t("theme.light")}</p>
      <div className="grid grid-cols-3 gap-2">{group("light")}</div>
      <p className="text-2xs tracking-wider text-faint uppercase">{t("theme.dark")}</p>
      <div className="grid grid-cols-3 gap-2">{group("dark")}</div>
    </div>
  );
}

interface Props {
  project: Project | null;
  agentsFound: Record<Agent, string | null>;
  lang: Lang;
  theme: Theme;
  onLang: (l: Lang) => void;
  onTheme: (t: Theme) => void;
  onChanged: () => void;
  onClose: () => void;
}

export function Settings({ project, agentsFound, lang, theme, onLang, onTheme, onChanged, onClose }: Props) {
  const t = useT();
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button onClick={onClose} className="text-xs text-muted hover:text-fg">
          ← {t("back")}
        </button>
        <span className="ml-auto text-xs font-medium">{t("settings")}</span>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {project && <ProjectSettings key={project.path} project={project} agentsFound={agentsFound} onChanged={onChanged} />}

        <Row label={t("language")}>
          <Segmented value={lang} onChange={onLang} options={[{ value: "fr", label: "FR" }, { value: "en", label: "EN" }]} />
        </Row>
        <ThemePicker value={theme} lang={lang} onChange={onTheme} />
        <div className="border-t border-line pt-4">
          <Button
            danger
            onClick={async () => {
              if (!confirm(t("uninstallAll.confirm"))) return;
              await api.uninstallAll();
              onChanged();
            }}
          >
            {t("uninstallAll")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProjectSettings({ project, agentsFound, onChanged }: { project: Project; agentsFound: Record<Agent, string | null>; onChanged: () => void }) {
  const t = useT();
  const [config, setConfig] = useState<ProjectConfig>(project.config);
  const [key, setKey] = useState("");
  const [preview, setPreview] = useState<{ title: string; value: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setConfig(project.config), [project.config]);

  const save = async (patch: Partial<ProjectConfig>) => {
    try {
      setConfig(await api.saveConfig(project.path, patch));
      setError(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ProjectIcon path={project.path} size={20} />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">{project.name}</p>
          <p className="truncate font-mono text-2xs text-faint">{project.path}</p>
        </div>
      </div>

      <Row label="Mode" tip={t("mode.help")}>
        <Segmented
          value={config.mode}
          onChange={(mode) => save({ mode })}
          options={[
            { value: "shadow", label: t("observe") },
            { value: "active", label: t("protect") },
          ]}
        />
      </Row>

      <Row label={`${t("threshold")} ${config.threshold.toFixed(2)}`} tip={t("threshold.help")}>
        <input type="range" min={0.1} max={0.9} step={0.05} value={config.threshold} onChange={(e) => setConfig({ ...config, threshold: Number(e.target.value) })} onPointerUp={() => save({ threshold: config.threshold })} onKeyUp={() => save({ threshold: config.threshold })} className="w-28 accent-(--accent)" />
      </Row>

      <Row label={t("stateLevel")} tip={t("level.help")}>
        <Segmented
          value={config.state_level}
          onChange={(state_level) => save({ state_level })}
          options={(["minimal", "reduced", "full"] as const).map((v) => ({ value: v, label: t(`level.${v}`) }))}
        />
      </Row>

      <Row label={t("clientProfile")} tip={t("clientProfile.help")}>
        <input type="checkbox" checked={config.profile === "client"} onChange={(e) => save({ profile: e.target.checked ? "client" : "default" })} className="accent-(--accent)" />
      </Row>

      <div>
        <button className="text-2xs text-accent hover:underline" onClick={async () => setPreview({ title: t("previewState"), value: (await api.statePreview(project.path)).state ?? t("noPreview") })}>
          {t("previewState")} →
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">{t("apiKey")}</span>
          <span className={project.key === "none" ? "text-warn" : "text-ok"}>{t(`key.${project.key}`)}</span>
        </div>
        <div className="flex gap-1.5">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("key.placeholder")}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 font-mono text-2xs placeholder:text-faint"
          />
          <Button disabled={!key.trim()} onClick={() => run(async () => (await api.setKey(project.path, key), setKey("")))}>
            {t("key.save")}
          </Button>
        </div>
        <a href="https://console.typesafe.ai" target="_blank" rel="noreferrer" className="text-2xs text-accent hover:underline">
          {t("key.console")} ↗
        </a>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted">{t("agents")}</p>
        {AGENTS.map((a) => {
          const found = !!agentsFound[a];
          const on = project.installed[a];
          return (
            <div key={a} className="flex items-center gap-2 text-xs">
              <span className="w-12">{AGENT_LABEL[a]}</span>
              <span className={`flex-1 text-2xs ${on ? "text-ok" : "text-faint"}`}>{on ? t("installed") : found ? t("notInstalled") : t("notFound")}</span>
              <button
                className="text-2xs text-faint hover:text-fg"
                title={t("previewScript")}
                onClick={async () => {
                  const p = await api.installPreview(a, project.path);
                  setPreview({ title: `${t("previewScript")} — ${p.file}`, value: `${p.command}\n\n${p.source}` });
                }}
              >
                {"</>"}
              </button>
              {on ? (
                <Button onClick={() => run(() => api.uninstall(a, project.path))}>{t("uninstall")}</Button>
              ) : (
                <Button disabled={!found} onClick={() => run(() => api.install(a, project.path))}>
                  {t("install")}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-2xs text-bad">{error}</p>}
      {preview && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="truncate text-2xs text-faint">{preview.title}</span>
            <button className="text-2xs text-faint hover:text-fg" onClick={() => setPreview(null)}>
              ✕
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <Code value={preview.value} />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1 text-xs text-muted">
        {label}
        {tip && <Tip text={tip} />}
      </span>
      {children}
    </div>
  );
}
