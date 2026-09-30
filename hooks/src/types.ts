// Contrat partagé entre les adaptateurs, le hook et la fenêtre.
// Tout ce qui suit l'adaptateur ignore quel agent a produit l'événement.

export type Agent = "claude" | "codex" | "kimi";
export type HookKind = "stop" | "pretool" | "prompt" | "compact" | "loop" | "read" | "find" | "ask" | "route" | "skill";
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
  /** Hook prompt : relecture de la demande avant que l'agent parte (voir prompt.ts). */
  prompt?: {
    clear: number;
    missing: string | null;
    size: string;
    model: string;
    skill: { name: string; path?: string; p: number } | null;
    section: { name: string; p: number } | null;
    /** Vrai si ces pistes ont été données à l'agent (mode Protéger). */
    injected: boolean;
  };
  /** Hook stop : relecture du diff (voir review.ts). */
  review?: Review;
  /** Hook compact : consignes gardées et redonnées à l'agent après la compaction (voir compact.ts). */
  compact?: { kept: string[]; candidates: number };
  /** Détection de boucle (voir loops.ts) : ce qui se répète. */
  loop?: { signal: string; stuck: number };
  /** Lecture ciblée (voir read.ts) : fenêtre donnée à l'agent, ou null si la lecture est restée entière. */
  read?: { file: string; lines: number; window: [number, number] | null; p: number; /** Tokens estimés gardés hors du contexte. */ saved?: number; /** rewrite : lecture remplacée (Claude) ; redirect : l'agent a été invité à relire la partie utile (Kimi, Codex). */ mode?: "rewrite" | "redirect" };
  /** Recherche find / ask (voir search.ts) : ce qui a été demandé et trouvé. */
  search?: { query: string; scanned: number; results: { path: string; line?: number; p: number }[] };
  /** Routeur (voir router.ts) : le modèle choisi pour ce tour. */
  route?: { tier: Tier; model: string; previous?: Tier; escalated: boolean };
}

/** Relecture du diff à la fin du tour. */
export interface Review {
  /** Affirmations du message final, confrontées au diff. */
  claims: { text: string; verdict: "supported" | "contradicted" | "not_in_diff" | "not_a_change"; p: number }[];
  /** Fichiers modifiés : lien avec la demande et sensibilité, triés du plus au moins à relire. */
  files: { path: string; related: number; sensitive: number }[];
  /** Test ou vérification conseillé quand rien n'a vérifié le travail. */
  suggested_check?: { command: string; p: number };
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
  assist: AssistConfig;
  router: RouterConfig;
}

export type Tier = "fast" | "balanced" | "frontier";

export interface RouterConfig {
  /** Chaque message de ce projet a son modèle, choisi par Jev (Claude Code, et Kimi / Codex s'ils passent par Misogi). */
  enabled: boolean;
  /** Modèles Claude par niveau. */
  models: Record<Tier, string>;
  /** Modèles Kimi par niveau (ceux de ~/.kimi/config.toml). */
  kimi: Record<Tier, string>;
  /** Modèles Codex par niveau ; vide = choisis d'après la liste que Codex reçoit (le plus capable, et un « mini »). */
  codex: Partial<Record<Tier, string>>;
}

/** Aides de Jev autour du tour (voir prompt.ts, review.ts, compact.ts, loops.ts). */
export interface AssistConfig {
  /** Relire ta demande avant que l'agent parte : clarté, modèle conseillé, skill ou section de CLAUDE.md utile. */
  prompt: boolean;
  /** À la fin du tour : affirmations de l'agent contre le diff, fichiers hors sujet, zones sensibles, test conseillé. */
  review: boolean;
  /** À la compaction : garder tes consignes importantes et les redonner à l'agent après le résumé. */
  compact: boolean;
  /** Pendant le tour : repérer l'agent qui tourne en rond. */
  loops: boolean;
  /** Lectures de gros fichiers resserrées à la partie utile (Claude Code). */
  read: boolean;
}

/** Réglages globaux, dans ~/.misogi/settings.json. */
export interface GlobalSettings {
  /** Les décisions plus anciennes sont purgées ; 0 = garder pour toujours. */
  retention_days: number;
  /** Préférences de la fenêtre (thème, langue, logo…) : gardées ici, elles survivent aux mises à jour de l'appli. */
  ui?: Record<string, string>;
  /** Kimi passe par le relais de Misogi (variable KIMI_BASE_URL de l'utilisateur). */
  router_kimi?: boolean;
  /** Codex passe par le relais de Misogi (openai_base_url dans ~/.codex/config.toml). */
  router_codex?: boolean;
}
