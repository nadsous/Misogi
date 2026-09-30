import { useContext, useEffect, useState } from "react";
import { AGENT_LABEL, api, type Agent, type AgentUsage, type QuotaWindow, type Usage } from "../api";
import { LangContext, useT } from "../i18n";
import { AgentIcon, JevIcon } from "./Brand";
import { savePref } from "../prefs";
import { Tip } from "./ui";

const POLL_MS = 30_000;

/** Quotas des forfaits (Claude, Codex), tokens brûlés, et coût de Jev : d'un coup d'œil. */
export function Quotas() {
  const t = useT();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [open, setOpen] = useState(() => localStorage.getItem("misogi.quotas") !== "closed");

  const load = () => api.usage().then(setUsage).catch(() => {});
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => savePref("misogi.quotas", open ? "open" : "closed"), [open]);
  useEffect(() => {
    const onPrefs = () => setOpen(localStorage.getItem("misogi.quotas") !== "closed");
    addEventListener("misogi:prefs", onPrefs);
    return () => removeEventListener("misogi:prefs", onPrefs);
  }, []);

  if (!usage) return null;
  const rows = (["claude", "codex", "kimi"] as Agent[]).filter((a) => usage[a] && (usage[a]!.windows.length || usage[a]!.tokens24h || (a === "claude" && !usage.statusline)));

  return (
    <section className="border-b border-line px-3 py-2.5">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 text-2xs font-medium tracking-wider text-faint uppercase">
        {t("quotas")}
        {!open && (
          <span className="ml-1 flex items-center gap-2 normal-case">
            {rows.map((a) => {
              const w = usage[a]!.windows[0];
              return w ? (
                <span key={a} className="flex items-center gap-1">
                  <AgentIcon agent={a} size={14} />
                  <span className={pctTone(w.usedPercent)}>{Math.round(w.usedPercent)} %</span>
                </span>
              ) : null;
            })}
          </span>
        )}
        <span className="ml-auto">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-2.5 space-y-3">
          {rows.map((a) => (
            <AgentRow key={a} agent={a} usage={usage[a]!} statusline={usage.statusline} onEnable={async () => (await api.setStatusline(true), load())} />
          ))}
          <div className="flex items-center gap-2.5">
            <JevIcon size={22} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium">Jev</span>
                <span className="text-2xs text-muted">{usd(usage.jev.costToday)} {t("quota.jevCost")}</span>
              </div>
              <p className="text-2xs text-faint">
                {usage.jev.callsToday} {t("quota.jevCalls")} · {tokens(usage.jev.tokensToday)} tokens{usage.jev.avgLatencyMs ? ` · ${usage.jev.avgLatencyMs} ms` : ""}
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function AgentRow({ agent, usage, statusline, onEnable }: { agent: Agent; usage: AgentUsage; statusline: boolean; onEnable: () => void }) {
  const t = useT();
  return (
    <div className="flex items-start gap-2.5">
      <AgentIcon agent={agent} size={22} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium">
            {AGENT_LABEL[agent]}
            {usage.plan && <span className="ml-1.5 text-2xs font-normal text-faint uppercase">{usage.plan}</span>}
          </span>
          <span className="text-2xs text-faint">
            {tokens(usage.tokens5h)} {t("quota.tokens")} · {tokens(usage.tokens24h)} {t("quota.tokens24")}
          </span>
        </div>
        {usage.windows.map((w) => (
          <QuotaBar key={w.label} window={w} />
        ))}
        {!usage.windows.length &&
          (agent === "claude" && !statusline ? (
            <span className="flex items-center gap-1.5">
              <button onClick={onEnable} className="rounded-md border border-accent/50 px-2 py-0.5 text-2xs text-accent hover:bg-accent/10">
                {t("quota.enable")}
              </button>
              <Tip text={t("quota.enable.help")} />
            </span>
          ) : (
            <p className="text-2xs text-faint">{agent === "kimi" ? t("quota.noLimits") : agent === "claude" ? t("quota.claudeTerminal") : "—"}</p>
          ))}
      </div>
    </div>
  );
}

function QuotaBar({ window: w }: { window: QuotaWindow }) {
  const t = useT();
  const lang = useContext(LangContext);
  const pct = Math.min(100, Math.max(0, w.usedPercent));
  return (
    <div>
      <div className="flex justify-between text-2xs">
        <span className="text-muted">{t(w.label === "5h" ? "quota.5h" : "quota.7d")}</span>
        <span>
          <span className={`font-mono font-medium ${pctTone(pct)}`}>{Math.round(pct)} %</span>
          {w.resetsAt && <span className="text-faint"> · {t("quota.resets")} {until(w.resetsAt, lang)}</span>}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={t(w.label === "5h" ? "quota.5h" : "quota.7d")}>
        <div className={`h-full rounded-full transition-[width] duration-700 ${barTone(pct)}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function pctTone(p: number): string {
  return p >= 90 ? "text-bad" : p >= 70 ? "text-warn" : "text-fg";
}
function barTone(p: number): string {
  return p >= 90 ? "bg-bad" : p >= 70 ? "bg-warn" : "bg-accent";
}

function tokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} G`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(n);
}

function usd(n: number): string {
  return n < 0.01 ? (n === 0 ? "0 $" : "< 0,01 $") : `${n.toFixed(2)} $`;
}

function until(ms: number, lang: "fr" | "en"): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "always", style: "short" });
  const min = Math.round((ms - Date.now()) / 60_000);
  if (min < 60) return rtf.format(min, "minute");
  if (min < 48 * 60) return rtf.format(Math.round(min / 60), "hour");
  return rtf.format(Math.round(min / 1440), "day");
}
