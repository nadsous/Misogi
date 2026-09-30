import { blobatar } from "blobatar";
import { useId, useMemo, useState, type ReactNode } from "react";
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

/** Info-bulle : au survol et au focus clavier, lue par les lecteurs d'écran. */
export function Tip({ text, children }: { text: string; children?: ReactNode }) {
  const id = useId();
  return (
    <span className="group relative inline-flex">
      {children ?? (
        <span tabIndex={0} role="button" aria-describedby={id} aria-label="?" className="cursor-help rounded text-faint">
          ⓘ
        </span>
      )}
      <span id={id} role="tooltip" className="pointer-events-none absolute top-full right-0 z-30 mt-1 hidden w-60 rounded-md border border-line bg-raised p-2 text-2xs text-muted shadow-lg group-focus-within:block group-hover:block">
        {text}
      </span>
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
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

/** Favicon du projet ; sans icône, un blobatar unique et stable tiré de son nom. */
export function ProjectIcon({ path, size = 24 }: { path: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const name = baseName(path) || "?";
  const avatar = useMemo(() => (failed || !path ? blobatar(name, { background: "squircle", animate: "hover", title: name }) : ""), [failed, path, name]);
  if (avatar) return <span role="img" aria-label={name} className="block shrink-0 [&>svg]:size-full" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: avatar }} />;
  return <img src={api.favicon(path)} alt={name} width={size} height={size} className="shrink-0 rounded-md object-contain" onError={() => setFailed(true)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line px-1 font-mono text-2xs text-faint">{children}</kbd>;
}
