// Sons de Misogi, synthétisés (aucun fichier) : une goutte qui tombe quand un agent a fini,
// deux petites notes quand il attend ton approbation.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// Le navigateur n'autorise le son qu'après un premier geste : on prépare le contexte au premier clic.
addEventListener("pointerdown", () => audio(), { once: true });

/** Une note douce : attaque courte, décroissance exponentielle, légère glissade vers le grave (effet goutte). */
function note(a: AudioContext, freq: number, start: number, length: number, volume: number, glide = 1): void {
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  if (glide !== 1) osc.frequency.exponentialRampToValueAtTime(freq * glide, start + length * 0.6);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(a.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

export type Chime = "done" | "waiting";

export function playChime(kind: Chime): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.01;
  if (kind === "done") {
    // Goutte : une note qui monte, puis sa résonance une quinte plus haut.
    note(a, 880, t, 0.35, 0.18, 1.5);
    note(a, 1318.5, t + 0.12, 0.6, 0.1);
  } else {
    // Attente : deux notes égales, plus insistantes.
    note(a, 659.3, t, 0.18, 0.16);
    note(a, 659.3, t + 0.22, 0.25, 0.16);
  }
}
