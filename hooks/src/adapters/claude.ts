// Adaptateur Claude Code : entrée JSON du hook Stop + transcript de la session.
// Doc : https://code.claude.com/docs/en/hooks
// Entrée observée (v2.1) : session_id, transcript_path, cwd, hook_event_name, stop_hook_active, last_assistant_message.

import { isAbsolute } from "node:path";
import { denyJson, emptyTurn, parseTime, readJsonlTail, shellCommand, str, toProjectPath, TurnTracker, type StopAdapter, type Turn } from "./common.js";
import { projectRoot } from "../platform.js";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export const claude: StopAdapter = {
  agent: "claude",
  context(input) {
    const cwd = projectRoot(str(input.cwd) || process.cwd());
    const transcript = str(input.transcript_path);
    const turn = transcript ? turnFromEntries(readJsonlTail<Entry>(transcript), cwd) : emptyTurn();
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
  cwd?: string;
  timestamp?: string;
  message?: { content?: string | Block[]; stop_reason?: string | null };
}

export function turnFromEntries(entries: Entry[], cwd: string): Turn {
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
  for (const e of main.slice(start + 1)) {
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (e.type === "assistant" && b.type === "text" && b.text) turn.lastAssistantText = b.text;
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

/** Texte tapé par l'utilisateur, ou null si l'entrée n'en est pas un (résultat d'outil, méta, rappel système). */
export function humanText(e: Entry): string | null {
  if (e.type !== "user" || e.isMeta) return null;
  const content = e.message?.content;
  let text: string;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content) && content.length && content.every((b) => b.type === "text")) text = content.map((b) => b.text ?? "").join("\n");
  else return null;
  text = text.trim();
  if (!text || text.startsWith("<local-command") || text.startsWith("<system-reminder>")) return null;
  return text;
}

function blockText(content: string | Block[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => b.text ?? "").join("\n");
}
