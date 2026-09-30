// Adaptateur Claude Code : entrée JSON du hook Stop + transcript de la session.
// Doc : https://code.claude.com/docs/en/hooks
// Entrée observée (v2.1) : session_id, transcript_path, cwd, hook_event_name, stop_hook_active, last_assistant_message.

import { emptyTurn, OUTPUT_TAIL_CHARS, readJsonlTail, str, tail, TEST_COMMAND, toProjectPath, type StopAdapter, type Turn } from "./common.js";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export const claude: StopAdapter = {
  agent: "claude",
  context(input) {
    const cwd = str(input.cwd) || process.cwd();
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
    };
  },
  block(reason) {
    return { stdout: JSON.stringify({ decision: "block", reason }), exitCode: 0 };
  },
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

  const files = new Set<string>();
  const testCommands = new Map<string, string>();
  for (const e of main.slice(start + 1)) {
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (e.type === "assistant" && b.type === "text" && b.text) turn.lastAssistantText = b.text;
      if (e.type === "assistant" && b.type === "tool_use" && b.name && b.input) {
        if (EDIT_TOOLS.has(b.name)) {
          const p = str(b.input.file_path ?? b.input.notebook_path);
          if (p) files.add(toProjectPath(p, cwd));
        } else if (b.name === "Bash" && TEST_COMMAND.test(str(b.input.command)) && b.id) {
          testCommands.set(b.id, str(b.input.command));
        }
      }
      if (e.type === "user" && b.type === "tool_result" && b.tool_use_id && testCommands.has(b.tool_use_id)) {
        turn.lastTest = {
          command: testCommands.get(b.tool_use_id)!,
          failed: b.is_error === true,
          output: tail(blockText(b.content), OUTPUT_TAIL_CHARS),
        };
      }
    }
  }
  turn.filesModified = [...files];
  return turn;
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
