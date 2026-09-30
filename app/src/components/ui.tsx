import { blobatar } from "blobatar";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
/**
 * Bulle d'aide. Elle est rendue au-dessus de tout (portail) et placée d'après l'icône, puis gardée dans la
 * fenêtre : dans un panneau étroit, elle ne passe plus sous la colonne des projets ni hors de l'écran.
 */
export function Tip({ text, children }: { text: string; children?: ReactNode }) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const show = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 8;
    const width = Math.min(240, innerWidth - margin * 2);
    const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, margin), innerWidth - width - margin);
    // En dessous si la place le permet, sinon au-dessus (hauteur estimée d'après la longueur du texte).
    const estimated = 16 + Math.ceil(text.length / 38) * 15;
    const top = r.bottom + 4 + estimated > innerHeight - margin ? Math.max(margin, r.top - 4 - estimated) : r.bottom + 4;
    setPos({ left, top, width });
  };
  const hide = () => setPos(null);
  return (
    <span ref={anchor} className="inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children ?? (
        <span tabIndex={0} role="button" aria-describedby={id} aria-label="?" className="cursor-help rounded text-faint">
          ⓘ
        </span>
      )}
      {pos &&
        createPortal(
          <span id={id} role="tooltip" style={pos} className="pointer-events-none fixed z-[100] rounded-md border border-line bg-raised p-2 text-2xs text-muted shadow-lg">
            {text}
          </span>,
          document.body,
        )}
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
