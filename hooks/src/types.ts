// Contrat partagé entre les adaptateurs, le hook et la fenêtre.
// Tout ce qui suit l'adaptateur ignore quel agent a produit l'événement.

export type Agent = "claude" | "codex" | "kimi";
export type HookKind = "stop" | "pretool" | "compact" | "route" | "skill";
export type Mode = "shadow" | "active";
export type StateLevel = "full" | "reduced" | "minimal";
export type Decision = "allow" | "block" | "would_block" | "error";
export type QuestionType = "choice" | "score" | "noul";

/** Ce que l'adaptateur extrait d'un événement « l'agent veut s'arrêter ». */
export interface StopContext {
  agent: Agent;
  project: string;
  session: string;
  /** Dernière demande de l'utilisateur. */
  request: string;
  /** Fichiers modifiés pendant le tour. */
  filesModified: string[];
  /** Dernière commande de test du tour, si l'agent en a lancé une. */
  lastTest: TestRun | null;
  /** Message final de l'agent. */
  finalMessage: string;
  /** Vrai si l'agent continue déjà à cause d'un blocage précédent. */
  alreadyContinued: boolean;
}

export interface TestRun {
  command: string;
  failed: boolean;
  /** Fin de la sortie, tronquée. */
  output: string;
}

export interface Answer {
  /** Option choisie (choice), probabilité du oui (noul) ou score. */
  answer: string | number;
  confidence: number;
  probabilities?: Record<string, number>;
}

/** Une ligne de ~/.misogi/events.jsonl. */
export interface MisogiEvent {
  ts: string;
  agent: Agent;
  project: string;
  session: string;
  hook: HookKind;
  mode: Mode;
  model: string;
  questions: Record<string, QuestionType>;
  answers: Record<string, Answer>;
  decision: Decision;
  latency_ms: number;
  input_tokens: number;
  state_level: StateLevel;
  /** Empreinte SHA-256 du state envoyé ; le state lui-même n'est pas loggué par défaut. */
  state_hash: string;
  /** Présent seulement si log_state est activé dans la config du projet. */
  state?: unknown;
  /** Raison lisible : pourquoi Jev bloque (ou aurait bloqué), ou message d'erreur. */
  reason?: string;
}

export type Profile = "default" | "client";

export interface ProjectConfig {
  mode: Mode;
  /** « client » = projet sous clause de confidentialité : niveau minimal forcé. */
  profile: Profile;
  /** Sous ce seuil de probabilité « tâche terminée », Jev demande de continuer. */
  threshold: number;
  state_level: StateLevel;
  log_state: boolean;
  model: string;
  timeout_ms: number;
}
