import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Palette de commandes (Ctrl ou Cmd + K). */
export function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())), [commands, q]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setI(0), [q]);

  const pick = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/40 px-2 pt-12" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t("palette")} className="overflow-hidden rounded-lg border border-line bg-raised shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("palette")}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={shown[i] ? `cmd-${shown[i]!.id}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setI((x) => Math.min(x + 1, shown.length - 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setI((x) => Math.max(x - 1, 0)));
            if (e.key === "Enter") pick(shown[i]);
            if (e.key === "Escape") onClose();
          }}
          className="w-full border-b border-line bg-transparent px-3 py-2 text-[13px] outline-none placeholder:text-faint"
        />
        <ul id="palette-list" role="listbox" className="max-h-72 overflow-y-auto py-1">
          {shown.map((c, n) => (
            <li key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={n === i}>
              <button onMouseEnter={() => setI(n)} onClick={() => pick(c)} className={`flex w-full items-center px-3 py-1.5 text-left text-xs ${n === i ? "bg-surface text-fg" : "text-muted"}`}>
                <span className="truncate">{c.label}</span>
                {c.hint && <span className="ml-auto pl-2 text-2xs text-faint">{c.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
