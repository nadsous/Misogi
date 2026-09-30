// Adaptateur Claude Code : entrée JSON du hook Stop + transcript de la session.
// Doc : https://code.claude.com/docs/en/hooks
// Entrée observée (v2.1) : session_id, transcript_path, cwd, hook_event_name, stop_hook_active, last_assistant_message.

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { denyJson, emptyTurn, parseTime, readJsonlTail, shellCommand, str, toProjectPath, TurnTracker, type StopAdapter, type Turn } from "./common.js";
import { projectRoot } from "../platform.js";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export const claude: StopAdapter = {
  agent: "claude",
  context(input) {
    const cwd = projectRoot(str(input.cwd) || process.cwd());
    const transcript = str(input.transcript_path);
    const turn = transcript ? turnFromEntries(readJsonlTail<Entry>(transcript), cwd, subagentLoader(transcript)) : emptyTurn();
    return {
      agent: "claude",
      project: cwd,
      session: str(input.session_id),
      request: turn.request,
      filesModified: turn.filesModified,
      lastTest: turn.lastTest,
      finalMessage: str(input.last_assistant_message) || turn.lastAssistantText,
      alreadyContinued: input.stop_hook_active === true,
      checks: turn.checks,
      editCount: turn.editCount,
      startedAt: turn.startedAt,
    };
  },
  block(reason) {
    return { stdout: JSON.stringify({ decision: "block", reason }), exitCode: 0 };
  },
  tool: (input) => shellCommand(input, /^Bash$/),
  deny: denyJson,
};

interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | Block[];
  is_error?: boolean;
}

export interface Entry {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  isCompactSummary?: boolean;
  isVisibleInTranscriptOnly?: boolean;
  cwd?: string;
  timestamp?: string;
  message?: { content?: string | Block[]; stop_reason?: string | null };
  /** Tour lancé par Claude Code lui-même (fin d'un sous-agent en arrière-plan…), pas par l'utilisateur. */
  origin?: { kind?: string };
  promptSource?: string;
  /** Résultat de l'outil Agent/Task : l'identifiant du sous-agent lancé. */
  toolUseResult?: { agentId?: string } | string | null;
}

/**
 * Les sous-agents écrivent leur propre transcript : <session>/subagents/agent-<id>.jsonl, à côté de <session>.jsonl.
 * Leurs modifications et leurs vérifications comptent dans le tour, comme dans jev-belay.
 */
export function subagentLoader(transcript: string): (agentId: string) => Entry[] {
  const dir = join(transcript.replace(/\.jsonl$/, ""), "subagents");
  return (id) => {
    const file = join(dir, `agent-${id.replace(/[^\w-]/g, "")}.jsonl`);
    return existsSync(file) ? readJsonlTail<Entry>(file) : [];
  };
}

export function turnFromEntries(entries: Entry[], cwd: string, loadSubagent?: (agentId: string) => Entry[]): Turn {
  const main = entries.filter((e) => !e.isSidechain);
  let start = -1;
  for (let i = main.length - 1; i >= 0; i--) {
    if (humanText(main[i]!) !== null) {
      start = i;
      break;
    }
  }
  const turn = emptyTurn();
  if (start === -1) return turn;
  turn.request = humanText(main[start]!) ?? "";
  turn.startedAt = parseTime(main[start]!.timestamp);

  const files = new Set<string>();
  const tracker = new TurnTracker();
  let steps = main.slice(start + 1);
  const agents = new Set(steps.map((e) => (typeof e.toolUseResult === "object" ? e.toolUseResult?.agentId : undefined)).filter((id): id is string => !!id));
  if (loadSubagent && agents.size) {
    // Ordre chronologique commun : « vérifié après la dernière modification » vaut aussi entre agents.
    for (const id of agents) steps = mergeByTime(steps, loadSubagent(id).map((e) => ({ ...e, isSidechain: true })));
  }
  for (const e of steps) {
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (e.type === "assistant" && !e.isSidechain && b.type === "text" && b.text) turn.lastAssistantText = b.text;
      if (e.type === "assistant" && b.type === "tool_use" && b.name && b.input) {
        if (EDIT_TOOLS.has(b.name)) {
          const p = str(b.input.file_path ?? b.input.notebook_path);
          // Un fichier hors du projet (brouillon dans /tmp…) n'est pas une modification du projet.
          const rel = p ? toProjectPath(p, cwd) : "";
          if (rel && !isAbsolute(rel)) {
            files.add(rel);
            tracker.edit();
          }
        } else if (b.name === "Bash" && b.id) {
          tracker.shell(b.id, str(b.input.command));
        }
      }
      if (e.type === "user" && b.type === "tool_result" && b.tool_use_id) {
        tracker.result(b.tool_use_id, b.is_error === true, blockText(b.content), parseTime(e.timestamp));
      }
    }
  }
  turn.filesModified = [...files];
  return tracker.finish(turn);
}

/** Fusionne deux listes déjà dans l'ordre ; une entrée sans horodatage reste derrière sa voisine. */
function mergeByTime(a: Entry[], b: Entry[]): Entry[] {
  const out: Entry[] = [];
  let i = 0;
  let j = 0;
  let ta = 0;
  let tb = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length) ta = parseTime(a[i]!.timestamp) ?? ta;
    if (j < b.length) tb = parseTime(b[j]!.timestamp) ?? tb;
    if (j >= b.length || (i < a.length && ta <= tb)) out.push(a[i++]!);
    else out.push(b[j++]!);
  }
  return out;
}

/** Texte tapé par l'utilisateur, ou null si l'entrée n'en est pas un (résultat d'outil, méta, rappel système). */
export function humanText(e: Entry): string | null {
  // Résumé écrit par Claude Code quand il compacte la conversation : pas une demande de l'utilisateur.
  if (e.type !== "user" || e.isMeta || e.isCompactSummary || e.isVisibleInTranscriptOnly || e.origin?.kind || e.promptSource === "system") return null;
  const content = e.message?.content;
  let text: string;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content) && content.length && content.every((b) => b.type === "text")) text = content.map((b) => b.text ?? "").join("\n");
  else return null;
  text = text.trim();
  if (!text || text.startsWith("<local-command") || text.startsWith("<system-reminder>") || text.startsWith("<task-notification>")) return null;
  return text;
}

function blockText(content: string | Block[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => b.text ?? "").join("\n");
}
