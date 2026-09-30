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
  /** Vérifications du tour (tests, build, lint, typecheck), dans l'ordre. */
  checks?: import("./adapters/common.js").Check[];
  /** Modifications vues pendant le tour (outils d'édition + commandes qui écrivent + git). */
  editCount?: number;
  /** Début du tour (epoch ms). */
  startedAt?: number | null;
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
  /** Hook pretool : la commande vérifiée, secrets masqués. */
  subject?: string;
  /** Hook stop : nombre de relances déjà faites sur ce tour. */
  relaunches?: number;
  /** Vrai quand la limite de relances est atteinte : on a laissé passer malgré Jev. */
  limit_reached?: boolean;
  /** Qui a tranché quand ce n'est pas la règle automatique. */
  resolved_by?: "user" | "override" | "timeout";
  /** Session vue depuis une autre machine (SSH, conteneur) : nom de l'hôte d'origine. */
  origin?: string;
  /**
   * Ce qui a été jugé, en bref, pour que la fenêtre dise de quoi parle la décision.
   * Reste sur ta machine (le journal est local), secrets masqués.
   */
  summary?: { request: string; files: string[]; test?: { command: string; failed: boolean }; checks?: { command: string; failed: boolean; after_last_edit: boolean }[]; final: string };
  /** Faits du tour établis en local (modifications, vérifications), voir stop.ts. */
  facts?: { file_changes: number; checks_run: number; verified_after_last_edit: boolean; failed_after_last_edit: boolean };
  /** Jev n'a pas été appelé : rien modifié, ou déjà prouvé par une vérification réussie. */
  skipped?: "no_changes" | "verified";
  /** Ticket lié (GitHub, GitLab, Linear) dont Jev a jugé les critères d'acceptation. */
  ticket?: { provider: "github" | "gitlab" | "linear"; id: string; title: string; url: string };
}

export type Profile = "default" | "client";

export interface GuardConfig {
  /** Vérifier les commandes shell avant qu'elles partent. */
  enabled: boolean;
  /** shadow : noter seulement ; active : refuser les commandes jugées dangereuses. */
  mode: Mode;
  /** Au-dessus de cette probabilité de danger, la commande est refusée (ou l'aurait été). */
  threshold: number;
}

export interface ProjectConfig {
  mode: Mode;
  /** « client » = projet sous clause de confidentialité : niveau minimal forcé. */
  profile: Profile;
  /** Sous ce seuil de probabilité « tâche terminée », Jev demande de continuer. */
  threshold: number;
  state_level: StateLevel;
  log_state: boolean;
  /** Modèle Jev : « jev-latest » ou une version épinglée (ex. jev-1.13.0) pour des résultats stables. */
  model: string;
  timeout_ms: number;
  /** Nombre maximum de relances d'affilée sur un même tour ; au-delà, on laisse passer et on prévient. */
  max_relaunches: number;
  /** En mode actif, laisser quelques secondes pour trancher depuis la fenêtre avant de relancer. */
  ask_before_relaunch: boolean;
  ask_timeout_ms: number;
  /** Taille maximale du state envoyé à Jev, en tokens estimés ; le surplus est coupé proprement. */
  max_state_tokens: number;
  guard: GuardConfig;
  /** Relier la session à son ticket (branche ou demande) et faire juger ses critères d'acceptation. */
  tickets: boolean;
}

/** Réglages globaux, dans ~/.misogi/settings.json. */
export interface GlobalSettings {
  /** Les décisions plus anciennes sont purgées ; 0 = garder pour toujours. */
  retention_days: number;
}
