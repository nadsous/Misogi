// Adaptateur Codex (GPT).
// Doc : https://learn.chatgpt.com/docs/hooks
// Entrée Stop documentée : session_id, transcript_path, cwd, hook_event_name, model, turn_id, stop_hook_active,
// last_assistant_message. Codex n'était pas installé pendant le développement : entrée non observée en réel,
// le transcript (rollout JSONL) est lu d'après des sessions Codex 0.105.

import { emptyTurn, OUTPUT_TAIL_CHARS, parseArgs, readJsonlTail, str, tail, TEST_COMMAND, toProjectPath, type StopAdapter, type Turn } from "./common.js";

export const codex: StopAdapter = {
  agent: "codex",
  context(input) {
    const cwd = str(input.cwd) || process.cwd();
    const transcript = str(input.transcript_path);
    const turn = transcript ? turnFromRollout(readJsonlTail<RolloutLine>(transcript), cwd) : emptyTurn();
    return {
      agent: "codex",
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

export interface RolloutLine {
  type?: string;
  payload?: Record<string, unknown>;
}

const SHELL_TOOLS = new Set(["shell", "shell_command", "exec_command", "local_shell"]);

export function turnFromRollout(lines: RolloutLine[], cwd: string): Turn {
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.type === "event_msg" && lines[i]!.payload?.type === "user_message") {
      start = i;
      break;
    }
  }
  const turn = emptyTurn();
  if (start === -1) return turn;
  turn.request = requestText(str(lines[start]!.payload?.message));

  const files = new Set<string>();
  const tests = new Map<string, string>();
  for (const l of lines.slice(start + 1)) {
    const p = l.payload ?? {};
    if (l.type === "event_msg" && p.type === "agent_message") turn.lastAssistantText = str(p.message);
    if (l.type !== "response_item") continue;
    if (p.type === "custom_tool_call" && p.name === "apply_patch") {
      for (const m of str(p.input).matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) files.add(toProjectPath(m[1]!.trim(), cwd));
    }
    if (p.type === "function_call" && SHELL_TOOLS.has(str(p.name))) {
      const args = parseArgs(p.arguments);
      const command = Array.isArray(args.command) ? args.command.join(" ") : str(args.command || args.cmd);
      if (TEST_COMMAND.test(command)) tests.set(str(p.call_id), command);
    }
    if (p.type === "function_call_output" && tests.has(str(p.call_id))) {
      const out = outputText(p.output);
      const code = /Exit code: (-?\d+)/.exec(out)?.[1] ?? /"exit_code":\s*(-?\d+)/.exec(out)?.[1];
      turn.lastTest = { command: tests.get(str(p.call_id))!, failed: code !== undefined && code !== "0", output: tail(out, OUTPUT_TAIL_CHARS) };
    }
  }
  turn.filesModified = [...files];
  return turn;
}

/** Les extensions IDE préfixent la demande par du contexte ; on garde la demande elle-même. */
function requestText(message: string): string {
  const marker = "## My request for Codex:";
  const i = message.lastIndexOf(marker);
  return (i === -1 ? message : message.slice(i + marker.length)).trim();
}

function outputText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "output" in v) return str((v as { output: unknown }).output);
  return "";
}
