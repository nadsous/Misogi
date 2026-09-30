import { useContext, useEffect, useState } from "react";
import { api, type Guide } from "../api";
import { ago } from "../format";
import { LangContext, useT, type Key } from "../i18n";
import { AgentIcon } from "./Brand";

const KINDS: Guide["kind"][] = ["instructions", "hook", "skill", "agent", "command", "mcp"];

/** Ce qui guide l'agent dans ce projet : fichiers d'instructions, skills, hooks, MCP... */
export function Guides({ path, name, onClose }: { path: string; name: string; onClose: () => void }) {
  const t = useT();
  const lang = useContext(LangContext);
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set(["instructions", "hook"]));

  useEffect(() => {
    api.guides(path).then(setGuides).catch(() => setGuides([]));
  }, [path]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button onClick={onClose} className="text-xs text-muted hover:text-fg">
          ← {t("back")}
        </button>
        <span className="ml-auto truncate text-xs font-medium">{name}</span>
      </header>
      <div className="flex-1 overflow-y-auto">
        <p className="px-3 pt-3 pb-2 text-2xs leading-relaxed text-faint">{t("guides.lead")}</p>
        {guides && !guides.length && <p className="px-3 py-4 text-xs text-faint">{t("guides.none")}</p>}
        {KINDS.map((kind) => {
          const items = (guides ?? []).filter((g) => g.kind === kind);
          if (!items.length) return null;
          const isOpen = open.has(kind);
          return (
            <section key={kind} className="border-t border-line">
              <button
                onClick={() => setOpen((s) => new Set(isOpen ? [...s].filter((k) => k !== kind) : [...s, kind]))}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-surface"
              >
                <span className="font-medium">{t(`kind.${kind}` as Key)}</span>
                <span className="rounded-full bg-raised px-1.5 text-2xs text-muted">{items.length}</span>
                <span className="ml-auto text-faint">{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <ul className="pb-2">
                  {items.map((g) => (
                    <li key={`${g.path}:${g.name}`} className="flex items-center gap-2 px-3 py-1 text-xs" title={g.path}>
                      {g.agent === "all" ? <span className="w-4 text-center text-2xs text-faint">∗</span> : <AgentIcon agent={g.agent} size={15} />}
                      <span className="min-w-0 flex-1 truncate font-mono text-2xs">{g.name}</span>
                      {g.detail && <span className="shrink-0 text-2xs text-faint">{g.detail}</span>}
                      <span className={`shrink-0 rounded px-1 text-2xs ${g.scope === "project" ? "bg-accent/15 text-accent" : "bg-raised text-faint"}`}>{t(g.scope === "project" ? "guides.project" : "guides.global")}</span>
                      <span className="w-14 shrink-0 text-right text-2xs text-faint">{ago(g.updatedAt, lang)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
