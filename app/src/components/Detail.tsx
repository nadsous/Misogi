import { useState } from "react";
import type { MisogiEvent } from "../api";
import { pct } from "../format";
import { useT } from "../i18n";
import { AgentIcon } from "./Brand";

/** Détail d'une décision : state exact envoyé, probabilités par option, JSON brut. */
export function Detail({ event: e, onClose }: { event: MisogiEvent; onClose: () => void }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button onClick={onClose} className="text-xs text-muted hover:text-fg">
          ← {t("back")}
        </button>
        <span className="ml-auto flex items-center gap-1.5 text-2xs text-faint">
          <AgentIcon agent={e.agent} />
          <span className="font-mono">{new Date(e.ts).toLocaleString()}</span>
        </span>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {e.reason && <p className="text-[13px] leading-snug">{e.reason}</p>}
        <p className="font-mono text-2xs text-faint">
          {e.model} · {t("latency")} {e.latency_ms} ms · {e.input_tokens} {t("tokens")} · {e.state_level} · {e.project}
        </p>

        {e.summary && (
          <Section title={t("summary.title")}>
            <dl className="space-y-2 text-xs">
              <div>
                <dt className="text-2xs text-faint">{t("summary.request")}</dt>
                <LongText text={e.summary.request} />
              </div>
              <div>
                <dt className="text-2xs text-faint">{t("summary.files")}</dt>
                <dd className="font-mono text-2xs">{e.summary.files.length ? e.summary.files.join(", ") : t("summary.none")}</dd>
              </div>
              {!!e.summary.checks?.length && (
                <div>
                  <dt className="text-2xs text-faint">{t("summary.checks")}</dt>
                  <dd className="space-y-0.5 font-mono text-2xs">
                    {e.summary.checks.map((c, i) => (
                      <p key={i} className="truncate">
                        <span className={c.failed ? "text-bad" : "text-ok"}>{c.failed ? "✗" : "✓"}</span> {c.command}
                        {!c.after_last_edit && <span className="text-faint"> · avant la dernière modification</span>}
                      </p>
                    ))}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-2xs text-faint">{t("summary.test")}</dt>
                <dd className="font-mono text-2xs">
                  {e.summary.test ? (
                    <>
                      {e.summary.test.command} · <span className={e.summary.test.failed ? "text-bad" : "text-ok"}>{t(e.summary.test.failed ? "summary.failed" : "summary.passed")}</span>
                    </>
                  ) : (
                    t("summary.noTest")
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-2xs text-faint">{t("summary.final")}</dt>
                <LongText text={e.summary.final} className="text-muted" />
              </div>
            </dl>
          </Section>
        )}

        <Section title={t("probabilities")}>
          {Object.entries(e.answers).map(([k, a]) => (
            <div key={k} className="mb-2">
              <div className="flex justify-between text-xs">
                <span className="font-mono text-muted">{k}</span>
                <span>
                  {typeof a.answer === "number" ? pct(a.answer) : a.answer} <span className="text-faint">· {t("confidence")} {pct(a.confidence)}</span>
                </span>
              </div>
              {a.probabilities && (
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(a.probabilities)
                    .sort((x, y) => y[1] - x[1])
                    .map(([opt, p]) => (
                      <li key={opt} className="flex items-center gap-2 text-2xs">
                        <span className="w-20 truncate font-mono text-faint">{opt}</span>
                        <span className="h-1 flex-1 rounded-full bg-line">
                          <span className="block h-full rounded-full bg-accent" style={{ width: `${p * 100}%` }} />
                        </span>
                        <span className="w-9 text-right font-mono text-faint">{pct(p)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          ))}
        </Section>

        <Section title={t("sentState")}>
          {e.state !== undefined ? <Code value={e.state} /> : <p className="text-2xs leading-relaxed text-faint">{t("stateNotLogged")}</p>}
          <p className="mt-1 truncate font-mono text-2xs text-faint">sha256 {e.state_hash}</p>
        </Section>

        <Section title={t("raw")}>
          <Code value={e} />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-2xs font-medium tracking-wider text-faint uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function Code({ value }: { value: unknown }) {
  return <pre className="overflow-x-auto rounded-md border border-line bg-surface p-2 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-muted">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}

/** Texte long (demande, message final) : replié sur quelques lignes, déroulable. */
function LongText({ text, className = "" }: { text: string; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!text) return <dd>—</dd>;
  const long = text.length > 280 || text.split("\n").length > 6;
  return (
    <dd className={className}>
      <p className={`whitespace-pre-wrap break-words ${long && !open ? "line-clamp-6" : ""}`}>{text}</p>
      {long && (
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 text-2xs text-accent hover:underline">
          {open ? t("summary.showLess") : t("summary.showAll")}
        </button>
      )}
    </dd>
  );
}
