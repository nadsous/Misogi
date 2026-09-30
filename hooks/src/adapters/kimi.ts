// Adaptateur Kimi Code (hooks en beta).
// Doc : https://www.kimi.com/code/docs/kimi-code-cli/customization/hooks.html
// Entrée Stop observée (kimi 1.30, protocole wire 1.8) : hook_event_name, session_id, cwd, stop_hook_active.
// Pas de transcript_path : la session vit dans ~/.kimi/sessions/<md5(cwd)>/<session_id>/wire.jsonl.
// Le format change encore : WIRE_PROTOCOLS liste les versions testées.
// Après un blocage, Kimi relance le tour une seule fois et ne rappelle pas le hook Stop : pas de boucle possible.

import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { emptyTurn, OUTPUT_TAIL_CHARS, parseArgs, readJsonlTail, str, tail, TEST_COMMAND, toProjectPath, type StopAdapter, type Turn } from "./common.js";

export const WIRE_PROTOCOLS = ["1.8"];

const EDIT_TOOLS = new Set(["WriteFile", "StrReplaceFile", "write_file", "edit_file"]);
const SHELL_TOOLS = new Set(["Shell", "Bash"]);

export function kimiHome(): string {
  return process.env.KIMI_HOME || join(homedir(), ".kimi");
}

export function kimiWirePath(cwd: string, sessionId: string, home = kimiHome()): string | null {
  const direct = join(home, "sessions", createHash("md5").update(cwd).digest("hex"), sessionId, "wire.jsonl");
  if (existsSync(direct)) return direct;
  // Repli : le hash dépend de la casse exacte du chemin, on cherche la session partout.
  try {
    for (const dir of readdirSync(join(home, "sessions"))) {
      const p = join(home, "sessions", dir, sessionId, "wire.jsonl");
      if (existsSync(p)) return p;
    }
  } catch {
    // pas de dossier sessions
  }
  return null;
}

export const kimi: StopAdapter = {
  agent: "kimi",
  context(input) {
    const cwd = str(input.cwd) || process.cwd();
    const session = str(input.session_id);
    const wire = session ? kimiWirePath(cwd, session) : null;
    const turn = wire ? turnFromWire(readJsonlTail<WireLine>(wire), cwd) : emptyTurn();
    return {
      agent: "kimi",
      project: cwd,
      session,
      request: turn.request,
      filesModified: turn.filesModified,
      lastTest: turn.lastTest,
      finalMessage: turn.lastAssistantText,
      alreadyContinued: input.stop_hook_active === true,
    };
  },
  // Kimi : code 2 = bloquer, stderr = message ajouté pour l'agent.
  block(reason) {
    return { stderr: reason, exitCode: 2 };
  },
};

export interface WireLine {
  type?: string;
  protocol_version?: string;
  message?: { type?: string; payload?: Record<string, unknown> };
}

export function turnFromWire(lines: WireLine[], cwd: string): Turn {
  const msgs = lines.map((l) => l.message).filter((m): m is NonNullable<WireLine["message"]> => !!m?.type);
  let start = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]!.type === "TurnBegin") {
      start = i;
      break;
    }
  }
  const turn = emptyTurn();
  if (start === -1) return turn;
  turn.request = userInputText(msgs[start]!.payload?.user_input);

  const files = new Set<string>();
  const tests = new Map<string, string>();
  let text = "";
  for (const m of msgs.slice(start + 1)) {
    const p = m.payload ?? {};
    if (m.type === "StepBegin") text = "";
    if (m.type === "ContentPart" && p.type === "text") text += str(p.text);
    if (m.type === "ToolCall") {
      const fn = (p.function ?? {}) as { name?: string; arguments?: unknown };
      const args = parseArgs(fn.arguments);
      if (fn.name && EDIT_TOOLS.has(fn.name) && str(args.path)) files.add(toProjectPath(str(args.path), cwd));
      if (fn.name && SHELL_TOOLS.has(fn.name) && TEST_COMMAND.test(str(args.command))) tests.set(str(p.id), str(args.command));
    }
    if (m.type === "ToolResult" && tests.has(str(p.tool_call_id))) {
      const rv = (p.return_value ?? {}) as { is_error?: boolean; output?: unknown; message?: string };
      turn.lastTest = {
        command: tests.get(str(p.tool_call_id))!,
        failed: rv.is_error === true,
        output: tail(outputText(rv.output) || str(rv.message), OUTPUT_TAIL_CHARS),
      };
    }
  }
  turn.lastAssistantText = text.trim();
  turn.filesModified = [...files];
  return turn;
}

function userInputText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map((p) => str((p as { text?: string }).text)).join("\n").trim();
  return "";
}

function outputText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((p) => str((p as { text?: string }).text)).join("\n");
  return "";
}
