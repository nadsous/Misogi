import { useId } from "react";
import { AGENT_LABEL, type Agent } from "../api";
import { BRAND_COLOR, BRAND_PATHS } from "../brands";
import { LOGO_VIEWBOX, logoMarkup } from "../logo";

/** Logo Misogi aux couleurs du thème courant (variables --logo-*). */
export function Logo({ size = 20, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const markup = logoMarkup({ top: "var(--logo-top)", bottom: "var(--logo-bottom)", shine: "var(--logo-shine)" }, `m${id}`);
  return <svg viewBox={LOGO_VIEWBOX} width={size} height={size} className={className} aria-label="Misogi" role="img" dangerouslySetInnerHTML={{ __html: markup }} />;
}

/** Logo d'un agent (Claude, GPT, Kimi). `dim` pour un agent non installé. */
export function AgentIcon({ agent, size = 18, dim }: { agent: Agent; size?: number; dim?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={AGENT_LABEL[agent]} className={`shrink-0 transition-opacity ${dim ? "opacity-25 grayscale" : ""}`} style={{ color: BRAND_COLOR[agent] ?? "var(--fg)" }}>
      <title>{AGENT_LABEL[agent]}</title>
      <path d={BRAND_PATHS[agent]} fill="currentColor" />
    </svg>
  );
}

/** Logo de Jev (TypeSafe). `dim` quand le projet n'a pas de clé. */
export function JevIcon({ size = 18, dim }: { size?: number; dim?: boolean }) {
  return <img src="/brands/jev.png" alt="Jev" title="Jev" width={size} height={size} className={`shrink-0 rounded-full transition-opacity ${dim ? "opacity-25 grayscale" : ""}`} />;
}
