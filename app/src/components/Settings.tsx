import { useEffect, useState } from "react";
import { AGENT_LABEL, AGENTS, api, type Agent, type GlobalSettings, type Integrations, type Project, type ProjectConfig, type Reliability, type Replay } from "../api";
import { useT, type Lang } from "../i18n";
import { inTauri } from "../platform";
import { savePref } from "../prefs";
import { playChime } from "../sound";
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

/** Ce qu'aurait donné un autre seuil sur les décisions passées, avant de l'appliquer. */
function ReplayPreview({ path, current, draft, onApply }: { path: string; current: number; draft: number; onApply: () => void }) {
  const t = useT();
  const [r, setR] = useState<Replay | null>(null);
  useEffect(() => {
    const id = setTimeout(() => api.replay(path, draft).then(setR).catch(() => setR(null)), 150);
    return () => clearTimeout(id);
  }, [path, draft]);
  if (!r) return null;
  if (!r.total) return <p className="text-2xs text-faint">{t("replay.empty")}</p>;
  const changed = Math.abs(draft - current) > 0.001;
  return (
    <div className="space-y-1.5 rounded-md border border-line bg-surface px-2.5 py-2 text-2xs" aria-live="polite">
      <p className="text-muted">{t("replay.title")} ({draft.toFixed(2)})</p>
      <p>
        <span className="font-semibold text-fg">{r.flaggedAfter}</span> {t("replay.alerts")} {r.flaggedBefore} {t("replay.on")} {r.total} {t("replay.decisions")}
      </p>
      {(r.fixed > 0 || r.broken > 0) && (
        <p>
          {r.fixed > 0 && <span className="text-ok">+{r.fixed} {t("replay.fixed")}</span>}
          {r.fixed > 0 && r.broken > 0 && " · "}
          {r.broken > 0 && <span className="text-bad">−{r.broken} {t("replay.broken")}</span>}
        </p>
      )}
      {changed && <Button onClick={onApply}>{t("replay.apply")}</Button>}
    </div>
  );
}

/** Fiabilité de Jev sur ce projet, d'après tes avis Oui / Non. */
function ReliabilityPanel({ path }: { path: string }) {
  const t = useT();
  const [r, setR] = useState<Reliability | null>(null);
  useEffect(() => {
    api.reliability(path).then(setR).catch(() => {});
  }, [path]);
  if (!r) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted">{t("reliability")}</p>
      {r.accuracy === null ? (
        <p className="text-2xs leading-relaxed text-faint">{t("reliability.none")}</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className={`text-lg font-semibold ${r.accuracy >= 0.8 ? "text-ok" : r.accuracy >= 0.6 ? "text-warn" : "text-bad"}`}>{Math.round(r.accuracy * 100)} %</span>
            <span className="text-2xs text-faint">
              {t("reliability.of")} {r.rated} · {r.falseAlarms} {t("reliability.falseAlarms")} · {r.missed} {t("reliability.missed")}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(r.accuracy * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={t("reliability")}>
            <div className="h-full rounded-full bg-accent" style={{ width: `${r.accuracy * 100}%` }} />
          </div>
        </>
      )}
    </div>
  );
}

/** Jetons des trackers de tickets : GitHub via gh, GitLab et Linear dans le trousseau. */
function IntegrationsPanel() {
  const t = useT();
  const [status, setStatus] = useState<Integrations | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const load = () => api.integrations().then(setStatus).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  if (!status) return null;
  const rows: { name: "github" | "gitlab" | "linear"; label: string; ok: boolean; note?: string }[] = [
    { name: "github", label: "GitHub", ok: status.github !== "none" || status.githubCli, note: status.github === "none" && status.githubCli ? t("integrations.gh") : undefined },
    { name: "gitlab", label: "GitLab", ok: status.gitlab !== "none" },
    { name: "linear", label: "Linear", ok: status.linear !== "none" },
  ];
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1 text-xs text-muted">
        {t("integrations")}
        <Tip text={t("integrations.help")} />
      </p>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2 text-xs">
          <span className="w-14">{r.label}</span>
          <span className={`text-2xs ${r.ok ? "text-ok" : "text-faint"}`}>
            {r.ok ? t("integrations.connected") : t("integrations.none")}
            {r.note && ` (${r.note})`}
          </span>
          {r.name !== "github" && (
            <span className="ml-auto flex gap-1">
              <input
                type="password"
                aria-label={`${r.label} token`}
                value={draft[r.name] ?? ""}
                onChange={(e) => setDraft({ ...draft, [r.name]: e.target.value })}
                placeholder="token"
                className="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-2xs"
              />
              <Button disabled={!draft[r.name]?.trim()} onClick={async () => (await api.setIntegration(r.name, draft[r.name] ?? ""), setDraft({ ...draft, [r.name]: "" }), load())}>
                OK
              </Button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Réglages communs à tous les projets : conservation des journaux, sessions à distance, confidentialité. */
function GlobalSettingsPanel() {
  const t = useT();
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    api.settings().then(setSettings).catch(() => {});
  }, []);
  if (!settings) return null;
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <IntegrationsPanel />
      <div className="space-y-1">
        <Row label={t("sound.label")}>
          <span className="flex items-center gap-2">
            <button onClick={() => (playChime("done"), setTimeout(() => playChime("waiting"), 900))} className="text-2xs text-accent hover:underline">
              ▶ {t("sound.test")}
            </button>
            <input
              type="checkbox"
              aria-label={t("sound.label")}
              defaultChecked={localStorage.getItem("misogi.sound") !== "off"}
              onChange={(e) => savePref("misogi.sound", e.target.checked ? "on" : "off")}
              className="size-4 accent-(--accent)"
            />
          </span>
        </Row>
        <p className="text-2xs leading-relaxed text-faint">{t("sound.help")}</p>
      </div>
      <div className="space-y-1">
        <Row label={t("notifyDone.label")}>
          <input
            type="checkbox"
            aria-label={t("notifyDone.label")}
            defaultChecked={localStorage.getItem("misogi.notifyDone") !== "off"}
            onChange={(e) => savePref("misogi.notifyDone", e.target.checked ? "on" : "off")}
            className="size-4 accent-(--accent)"
          />
        </Row>
        <p className="text-2xs leading-relaxed text-faint">{t("notifyDone.help")}</p>
      </div>
      {inTauri && (
        <Row label={t("autoCollapse")}>
          <input
            type="checkbox"
            aria-label={t("autoCollapse")}
            defaultChecked={localStorage.getItem("misogi.autocollapse") === "on"}
            onChange={(e) => {
              savePref("misogi.autocollapse", e.target.checked ? "on" : "off");
              dispatchEvent(new Event("misogi:autocollapse"));
            }}
            className="size-4 accent-(--accent)"
          />
        </Row>
      )}
      <Row label={t("retention")}>
        <select
          aria-label={t("retention")}
          value={settings.retention_days}
          onChange={async (e) => setSettings(await api.saveSettings({ retention_days: Number(e.target.value) }))}
          className="rounded-md border border-line bg-surface px-2 py-1 text-xs"
        >
          {[7, 30, 90, 365].map((d) => (
            <option key={d} value={d}>
              {d} {t("retention.days")}
            </option>
          ))}
          <option value={0}>{t("retention.forever")}</option>
        </select>
      </Row>
      <div className="space-y-1">
        <p className="text-xs text-muted">{t("remote")}</p>
        <p className="text-2xs leading-relaxed text-faint">
          {t("remote.help")}{" "}
          {token ? (
            <code className="font-mono break-all text-fg">{token}</code>
          ) : (
            <button className="text-accent hover:underline" onClick={async () => setToken((await api.remote()).token)}>
              ●●●●●●
            </button>
          )}
        </p>
      </div>
      <p className="rounded-md bg-raised px-2.5 py-2 text-2xs leading-relaxed text-muted">🔒 {t("privacy")}</p>
    </div>
  );
}

interface Props {
  seenModel?: string;
  project: Project | null;
  agentsFound: Record<Agent, string | null>;
  lang: Lang;
  theme: Theme;
  onLang: (l: Lang) => void;
  onTheme: (t: Theme) => void;
  onChanged: () => void;
  onClose: () => void;
}

export function Settings({ project, agentsFound, seenModel, lang, theme, onLang, onTheme, onChanged, onClose }: Props) {
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
        {project && <ProjectSettings key={project.path} project={project} agentsFound={agentsFound} seenModel={seenModel} onChanged={onChanged} />}

        <Row label={t("language")}>
          <Segmented value={lang} onChange={onLang} options={[{ value: "fr", label: "FR" }, { value: "en", label: "EN" }]} />
        </Row>
        <ThemePicker value={theme} lang={lang} onChange={onTheme} />
        <GlobalSettingsPanel />
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

function ProjectSettings({ project, agentsFound, seenModel, onChanged }: { project: Project; agentsFound: Record<Agent, string | null>; seenModel?: string; onChanged: () => void }) {
  const t = useT();
  const [config, setConfig] = useState<ProjectConfig>(project.config);
  const [key, setKey] = useState("");
  const [preview, setPreview] = useState<{ title: string; value: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftThreshold, setDraftThreshold] = useState(project.config.threshold);

  useEffect(() => setConfig(project.config), [project.config]);
  useEffect(() => setDraftThreshold(project.config.threshold), [project.config.threshold]);

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

      <Row label={`${t("threshold")} ${draftThreshold.toFixed(2)}`} tip={t("threshold.help")}>
        <input
          type="range"
          aria-label={t("threshold")}
          min={0.1}
          max={0.9}
          step={0.05}
          value={draftThreshold}
          onChange={(e) => setDraftThreshold(Number(e.target.value))}
          className="w-28 accent-(--accent)"
        />
      </Row>
      <ReplayPreview path={project.path} current={config.threshold} draft={draftThreshold} onApply={() => save({ threshold: draftThreshold })} />
      <ReliabilityPanel path={project.path} />

      <Row label={t("stateLevel")} tip={t("level.help")}>
        <Segmented
          value={config.state_level}
          onChange={(state_level) => save({ state_level })}
          options={(["minimal", "reduced", "full"] as const).map((v) => ({ value: v, label: t(`level.${v}`) }))}
        />
      </Row>

      <Row label={t("relaunches")} tip={t("relaunches.help")}>
        <Segmented
          value={String(config.max_relaunches)}
          onChange={(v) => save({ max_relaunches: Number(v) })}
          options={["0", "1", "2", "3", "5"].map((v) => ({ value: v, label: v }))}
        />
      </Row>

      <Row label={t("askFirst")} tip={t("askFirst.help")}>
        <input type="checkbox" aria-label={t("askFirst")} checked={config.ask_before_relaunch} onChange={(e) => save({ ask_before_relaunch: e.target.checked })} className="size-4 accent-(--accent)" />
      </Row>

      <Row label={t("guard")} tip={t("guard.help")}>
        <Segmented
          value={config.guard.enabled ? config.guard.mode : "off"}
          onChange={(v) => save({ guard: { ...config.guard, enabled: v !== "off", mode: v === "active" ? "active" : "shadow" } })}
          options={[
            { value: "off", label: "Off" },
            { value: "shadow", label: t("observe") },
            { value: "active", label: t("protect") },
          ]}
        />
      </Row>

      <Row label={t("jevVersion")} tip={t("jevVersion.help")}>
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-2xs text-muted">{config.model}</span>
          {config.model === "jev-latest" && seenModel && seenModel !== "jev-latest" && (
            <Button onClick={() => save({ model: seenModel })}>
              {t("jevVersion.pin")} {seenModel}
            </Button>
          )}
          {config.model !== "jev-latest" && <Button onClick={() => save({ model: "jev-latest" })}>{t("jevVersion.latest")}</Button>}
        </span>
      </Row>

      <Row label={t("tickets")} tip={t("tickets.help")}>
        <input type="checkbox" aria-label={t("tickets")} checked={config.tickets} onChange={(e) => save({ tickets: e.target.checked })} className="size-4 accent-(--accent)" />
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
      <Button
        danger
        onClick={() =>
          confirm(t("removeProject.confirm")) &&
          run(async () => {
            await api.removeProject(project.path);
          })
        }
      >
        {t("removeProject")}
      </Button>
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
