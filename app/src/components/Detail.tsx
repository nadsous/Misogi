import { useState } from "react";
import type { Answer, MisogiEvent } from "../api";
import { headline, pct, tone, type Tone } from "../format";
import { useT, type Key } from "../i18n";
import { AgentIcon } from "./Brand";
import { Markdown } from "./Markdown";

/**
 * Détail d'une décision, du plus simple au plus technique : le verdict en une phrase, ce que Misogi a fait,
 * que faire ; puis les faits, ce que Jev a lu, et seulement en bas les chiffres bruts.
 */
export function Detail({ event: e, onClose }: { event: MisogiEvent; onClose: () => void }) {
  const t = useT();
  const tn = tone(e);
  const h = headline(e);
  const [tech, setTech] = useState(false);
  const facts = e.summary;
  const questions = Object.entries(e.answers);

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
        {/* 1. Le verdict, ce que Misogi a fait, que faire */}
        <section className={`rounded-lg border p-3 ${BOX[tn]}`}>
          <p className={`text-[15px] leading-snug font-semibold ${TEXT[tn]}`}>{h ? t(h) : t(`decision.${e.decision}` as Key)}</p>
          {e.reason && (
            <Block label={t("verdict.why")}>
              <Markdown text={e.reason} />
            </Block>
          )}
          <Block label={t("verdict.did")}>
            {t(didKey(e))}
            {e.resolved_by === "user" && ` ${t("did.user")}`}
          </Block>
          <Block label={t("verdict.todo")}>{t(todoKey(e, h))}</Block>
        </section>

        {/* 2. Les faits, vérifiés par Misogi lui-même */}
        {facts && e.hook === "stop" && (
          <Section title={t("facts.title")}>
            <ul className="space-y-1.5 text-xs">
              <li>
                <span className="mr-1.5">📝</span>
                {facts.files.length ? `${facts.files.length} ${t(facts.files.length > 1 ? "facts.files" : "facts.file")}` : t("facts.noFiles")}
                {!!facts.files.length && <span className="mt-0.5 block pl-6 font-mono text-2xs break-all text-faint">{facts.files.join(", ")}</span>}
              </li>
              {facts.checks?.length ? (
                facts.checks.map((c, i) => (
                  <li key={i}>
                    <span className={`mr-1.5 ${c.failed ? "text-bad" : "text-ok"}`}>{c.failed ? "✗" : "✓"}</span>
                    <span className={c.failed ? "text-bad" : ""}>{t(c.failed ? "facts.checkFail" : "facts.checkOk")}</span>
                    {!c.after_last_edit && <span className="text-faint"> {t("facts.beforeEdit")}</span>}
                    <code title={c.command} className="mt-0.5 ml-5 block truncate rounded bg-raised px-1 font-mono text-2xs text-muted">
                      {c.command}
                    </code>
                  </li>
                ))
              ) : (
                <li className="text-muted">
                  <span className="mr-1.5">○</span>
                  {t("facts.noCheck")}
                </li>
              )}
            </ul>
          </Section>
        )}

        {e.review && <ReviewBlock review={e.review} verified={!!e.facts?.verified_after_last_edit} />}
        {e.prompt && <PromptBlock p={e.prompt} />}
        {e.compact && (
          <Section title={t("compact.title")}>
            {e.compact.kept.length ? (
              <ol className="list-decimal space-y-1 pl-4 text-xs">
                {e.compact.kept.map((k) => (
                  <li key={k}>« {k} »</li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-muted">{t("compact.none")}</p>
            )}
            <p className="mt-1.5 text-2xs text-faint">
              {e.compact.candidates} {t("compact.read")}
            </p>
          </Section>
        )}

        {/* 3. Ce que Jev a lu dans la réponse */}
        {e.hook !== "prompt" && e.hook !== "compact" && (
        <Section title={e.hook === "pretool" ? t("jev.titleGuard") : e.hook === "loop" ? t("jev.titleLoop") : t("jev.title")}>
          {questions.length ? (
            <ul className="space-y-2.5">
              {questions.map(([k, a]) => (
                <Question key={k} id={k} answer={a} />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">{t("jev.skipped")}</p>
          )}
        </Section>
        )}

        {facts && (
          <Section title={t("summary.title")}>
            <dl className="space-y-2 text-xs">
              <div>
                <dt className="text-2xs text-faint">{t("summary.request")}</dt>
                <LongText text={facts.request} />
              </div>
              <div>
                <dt className="text-2xs text-faint">{t("summary.final")}</dt>
                <LongText text={facts.final} className="text-muted" />
              </div>
            </dl>
          </Section>
        )}

        {/* 4. Pour les curieux : les chiffres bruts */}
        <section>
          <button onClick={() => setTech((v) => !v)} aria-expanded={tech} className="text-2xs font-medium tracking-wider text-faint uppercase hover:text-fg">
            {tech ? "▾" : "▸"} {t("tech.title")}
          </button>
          {tech && (
            <div className="mt-2 space-y-3">
              <p className="font-mono text-2xs text-faint">
                {e.model} · {t("latency")} {e.latency_ms} ms · {e.input_tokens} {t("tokens")} · {e.state_level} · {e.mode} · {e.project}
              </p>
              {questions.map(([k, a]) => (
                <div key={k} className="flex justify-between text-2xs">
                  <span className="font-mono text-muted">{k}</span>
                  <span className="font-mono text-faint">
                    {typeof a.answer === "number" ? pct(a.answer) : a.answer} · {t("confidence")} {pct(a.confidence)}
                  </span>
                </div>
              ))}
              <div>
                <p className="mb-1 text-2xs text-faint">{t("sentState")}</p>
                {e.state !== undefined ? <Code value={e.state} /> : <p className="text-2xs leading-relaxed text-faint">{t("stateNotLogged")}</p>}
                <p className="mt-1 truncate font-mono text-2xs text-faint">sha256 {e.state_hash}</p>
              </div>
              <div>
                <p className="mb-1 text-2xs text-faint">{t("raw")}</p>
                <Code value={e} />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const BOX: Record<Tone, string> = { ok: "border-ok/40 bg-ok/5", warn: "border-warn/50 bg-warn/5", bad: "border-bad/50 bg-bad/5", muted: "border-line bg-surface" };
const TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", muted: "text-fg" };

/** Ce que Misogi a fait de l'avis de Jev, en une phrase. */
function didKey(e: MisogiEvent): Key {
  if (e.hook === "prompt") return e.prompt?.injected ? "did.promptInjected" : "did.promptShown";
  if (e.hook === "compact") return e.compact?.kept.length ? "did.compact" : "did.compactNone";
  if (e.hook === "loop") return "did.loop";
  if (e.hook === "pretool") return e.decision === "block" ? "did.guardBlock" : e.decision === "would_block" ? "did.guardWould" : "did.guardOk";
  if (e.limit_reached) return "did.limit";
  if (e.decision === "error") return "did.error";
  if (e.decision === "block") return "did.block";
  if (e.decision === "would_block") return "did.wouldBlock";
  if (e.skipped) return e.review ? "did.skippedReviewed" : "did.skipped";
  return "did.allow";
}

/** Une piste concrète, selon ce que Jev a relevé. */
function todoKey(e: MisogiEvent, h: Key | null): Key {
  if (e.decision === "error") return "todo.error";
  if (e.hook === "prompt") return e.prompt?.missing ? "todo.promptUnclear" : e.prompt?.model === "Haiku" ? "todo.promptSmall" : "todo.none";
  if (e.hook === "loop") return "todo.loop";
  if (h === "plain.reviewIssues") return "todo.review";
  const map: Partial<Record<string, Key>> = {
    "plain.unproven": "todo.unproven",
    "plain.claimsNoCheck": "todo.claimsNoCheck",
    "plain.failedCheck": "todo.failedCheck",
    "plain.testsFailed": "todo.failedCheck",
    "plain.partial": "todo.partial",
    "plain.notDone": "todo.partial",
    "plain.blockedAgent": "todo.blockedAgent",
    "plain.criteria": "todo.criteria",
    "plain.limit": "todo.limit",
    "plain.guardBlock": "todo.guard",
    "plain.guardWould": "todo.guard",
    "plain.testsNotRun": "todo.unproven",
    "plain.unverified": "todo.claimsNoCheck",
  };
  return (h && map[h]) || "todo.none";
}

/** Une question posée à Jev, formulée comme une vraie question, avec sa réponse et sa certitude. */
function Question({ id, answer: a }: { id: string; answer: Answer }) {
  const t = useT();
  // Question ou option inconnue (ancienne version, intégration) : on affiche l'identifiant tel quel.
  const ask: string = t(`ask.${id}` as Key) ?? id;
  let label: string;
  let sure: number;
  if (typeof a.answer === "number") {
    const yes = a.answer >= 0.5;
    label = t(yes ? "ans.yes" : "ans.no");
    sure = yes ? a.answer : 1 - a.answer;
  } else {
    label = t(`opt.${a.answer}` as Key) ?? a.answer;
    sure = a.probabilities?.[a.answer] ?? a.confidence;
  }
  return (
    <li className="text-xs">
      <p className="text-muted">{ask}</p>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="font-semibold">{label}</span>
        <span className="h-1 max-w-24 flex-1 rounded-full bg-line" aria-hidden>
          <span className="block h-full rounded-full bg-accent" style={{ width: `${sure * 100}%` }} />
        </span>
        <span className="text-2xs text-faint">
          {t("ans.sure")} {pct(sure)}
        </span>
      </div>
    </li>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2.5 text-xs leading-snug">
      <p className="mb-0.5 text-2xs font-medium text-faint">{label}</p>
      <div>{children}</div>
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
      <div className={long && !open ? "max-h-32 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]" : ""}>
        <Markdown text={text} />
      </div>
      {long && (
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 text-2xs text-accent hover:underline">
          {open ? t("summary.showLess") : t("summary.showAll")}
        </button>
      )}
    </dd>
  );
}

/** Relecture du diff : chaque affirmation de l'agent face au diff, les fichiers à relire d'abord, le test conseillé. */
function ReviewBlock({ review: r, verified }: { review: NonNullable<MisogiEvent["review"]>; verified: boolean }) {
  const t = useT();
  const icon = { supported: ["✓", "text-ok"], contradicted: ["✗", "text-bad"], not_in_diff: ["✗", "text-bad"], not_a_change: ["·", "text-faint"] } as const;
  return (
    <>
      {!!r.claims.length && (
        <Section title={t("review.claims")}>
          <ul className="space-y-1.5 text-xs">
            {r.claims.map((c) => (
              <li key={c.text} className="flex gap-1.5">
                <span className={icon[c.verdict][1]}>{icon[c.verdict][0]}</span>
                <span className="min-w-0">
                  {c.text}
                  <span className="block text-2xs text-faint">
                    {t(`review.${c.verdict}` as Key)} · {t("ans.sure")} {pct(c.p)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {!!r.files.length && (
        <Section title={t("review.files")}>
          <ul className="space-y-1 text-xs">
            {r.files.map((f) => (
              <li key={f.path} className="flex items-center gap-1.5">
                <code className="min-w-0 flex-1 truncate font-mono text-2xs" title={f.path}>
                  {f.path}
                </code>
                {f.sensitive >= 0.7 && <span className="shrink-0 rounded bg-warn/15 px-1 text-2xs text-warn">⚠ {t("review.sensitive")}</span>}
                {f.related < 0.3 && <span className="shrink-0 rounded bg-bad/10 px-1 text-2xs text-bad">{t("review.offTopic")}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {r.suggested_check && !verified && (
        <Section title={t("review.check")}>
          <code className="block truncate rounded bg-raised px-2 py-1 font-mono text-2xs" title={r.suggested_check.command}>
            {r.suggested_check.command}
          </code>
        </Section>
      )}
    </>
  );
}

/** Relecture de la demande : clarté, modèle conseillé, skill et section qui s'appliquent. */
function PromptBlock({ p }: { p: NonNullable<MisogiEvent["prompt"]> }) {
  const t = useT();
  return (
    <Section title={t("prompt.title")}>
      <ul className="space-y-1.5 text-xs">
        <li>
          <span className="text-muted">{t("prompt.clear")}</span> <strong>{p.missing ? `${t("ans.no")} : ${t(`missing.${p.missing}` as Key)}` : t("ans.yes")}</strong>
        </li>
        <li>
          <span className="text-muted">{t("prompt.model")}</span> <strong>{p.model}</strong> <span className="text-faint">({t(`size.${p.size}` as Key) ?? p.size})</span>
        </li>
        {p.skill && (
          <li>
            <span className="text-muted">{t("prompt.skill")}</span> <strong>{p.skill.name}</strong> <span className="text-faint">· {pct(p.skill.p)}</span>
          </li>
        )}
        {p.section && (
          <li>
            <span className="text-muted">{t("prompt.section")}</span> <strong>{p.section.name}</strong> <span className="text-faint">· {pct(p.section.p)}</span>
          </li>
        )}
      </ul>
    </Section>
  );
}
