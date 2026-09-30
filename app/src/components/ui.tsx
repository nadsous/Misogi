import { useState, type ReactNode } from "react";
import { api, baseName } from "../api";
import { TONE_BG, type Tone } from "../format";

export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2 shrink-0">
      {pulse && <span className={`absolute inset-0 animate-ping rounded-full opacity-60 ${TONE_BG[tone]}`} />}
      <span className={`relative size-2 rounded-full ${TONE_BG[tone]}`} />
    </span>
  );
}

/** Jauge de confiance : la barre montre la probabilité, la couleur le ton. */
export function Gauge({ value, tone }: { value: number; tone: Tone }) {
  return (
    <span className="inline-block h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-line" role="meter" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span className={`block h-full rounded-full ${TONE_BG[tone]}`} style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

export function Tip({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children ?? <span className="cursor-help text-faint">ⓘ</span>}
      <span className="pointer-events-none absolute top-full right-0 z-30 mt-1 hidden w-56 rounded-md border border-line bg-raised p-2 text-2xs text-muted shadow-lg group-hover:block">{text}</span>
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2 py-0.5 text-xs transition-colors ${o.value === value ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Button({ children, onClick, danger, disabled }: { children: ReactNode; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2 py-0.5 text-xs transition-colors disabled:opacity-40 ${danger ? "border-bad/40 text-bad hover:bg-bad/10" : "border-line text-fg hover:bg-raised"}`}
    >
      {children}
    </button>
  );
}

/** Favicon du projet, ou son initiale si le projet n'en a pas. */
export function ProjectIcon({ path, size = 24 }: { path: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const name = baseName(path);
  if (failed || !path)
    return (
      <span className="grid place-items-center rounded-md bg-raised font-medium text-muted uppercase" style={{ width: size, height: size, fontSize: size * 0.45 }}>
        {name.slice(0, 1) || "?"}
      </span>
    );
  return <img src={api.favicon(path)} alt="" width={size} height={size} className="rounded-md object-contain" onError={() => setFailed(true)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line px-1 font-mono text-2xs text-faint">{children}</kbd>;
}
