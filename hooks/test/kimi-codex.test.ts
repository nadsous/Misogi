import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codex, turnFromRollout } from "../src/adapters/codex.js";
import { kimi, kimiWirePath, turnFromWire } from "../src/adapters/kimi.js";

const cwd = join(tmpdir(), "kimi-proj");

// Extrait réel de wire.jsonl (kimi 1.30, protocole 1.8), raccourci.
const wire = [
  { type: "metadata", protocol_version: "1.8" },
  { timestamp: 1, message: { type: "TurnBegin", payload: { user_input: "ancienne demande" } } },
  { timestamp: 2, message: { type: "TurnEnd", payload: {} } },
  { timestamp: 3, message: { type: "TurnBegin", payload: { user_input: [{ type: "text", text: "Crée b.txt puis lance les tests" }] } } },
  { timestamp: 4, message: { type: "StepBegin", payload: { n: 1 } } },
  { timestamp: 5, message: { type: "ToolCall", payload: { type: "function", id: "t1", function: { name: "WriteFile", arguments: '{"path":"b.txt","content":"ok"}' } } } },
  { timestamp: 6, message: { type: "ToolResult", payload: { tool_call_id: "t1", return_value: { is_error: false, output: "", message: "File successfully overwritten." } } } },
  { timestamp: 7, message: { type: "StepBegin", payload: { n: 2 } } },
  { timestamp: 8, message: { type: "ToolCall", payload: { type: "function", id: "t2", function: { name: "Shell", arguments: '{"command":"npm test","timeout":10}' } } } },
  { timestamp: 9, message: { type: "ToolResult", payload: { tool_call_id: "t2", return_value: { is_error: true, output: "1 failing\r\n", message: "Command failed." } } } },
  { timestamp: 10, message: { type: "StepBegin", payload: { n: 3 } } },
  { timestamp: 11, message: { type: "ContentPart", payload: { type: "think", think: "..." } } },
  { timestamp: 12, message: { type: "ContentPart", payload: { type: "text", text: "C'est " } } },
  { timestamp: 13, message: { type: "ContentPart", payload: { type: "text", text: "fait." } } },
];

afterEach(() => {
  delete process.env.KIMI_HOME;
});

describe("adaptateur Kimi", () => {
  it("résume le dernier tour du wire", () => {
    const turn = turnFromWire(wire, cwd);
    expect(turn.request).toBe("Crée b.txt puis lance les tests");
    expect(turn.filesModified).toEqual(["b.txt"]);
    expect(turn.lastTest).toEqual({ command: "npm test", failed: true, output: "1 failing\r\n" });
    expect(turn.lastAssistantText).toBe("C'est fait.");
  });

  it("retrouve wire.jsonl via md5(cwd) à partir de l'entrée réelle du hook", () => {
    const home = mkdtempSync(join(tmpdir(), "kimi-home-"));
    process.env.KIMI_HOME = home;
    const dir = join(home, "sessions", createHash("md5").update(cwd).digest("hex"), "895f2ad2");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "wire.jsonl"), wire.map((l) => JSON.stringify(l)).join("\n"));
    expect(kimiWirePath(cwd, "895f2ad2")).toBe(join(dir, "wire.jsonl"));
    // Entrée observée : { hook_event_name, session_id, cwd, stop_hook_active }
    const ctx = kimi.context({ hook_event_name: "Stop", session_id: "895f2ad2", cwd, stop_hook_active: false });
    expect(ctx.agent).toBe("kimi");
    expect(ctx.finalMessage).toBe("C'est fait.");
    expect(kimi.block("continue")).toEqual({ stderr: "continue", exitCode: 2 });
  });
});

// Extrait de rollout Codex 0.105, raccourci.
const rollout = [
  { type: "session_meta", payload: { id: "019c", cwd: "c:\\proj" } },
  { type: "event_msg", payload: { type: "user_message", message: "# Context from my IDE setup:\n\n## Active file: a.js\n\n## My request for Codex:\nCorrige l'API" } },
  { type: "response_item", payload: { type: "custom_tool_call", name: "apply_patch", call_id: "c1", input: "*** Begin Patch\n*** Update File: pb_hooks/api.js\n@@\n-a\n+b\n*** Add File: test/api.test.js\n+x\n*** End Patch" } },
  { type: "response_item", payload: { type: "function_call", name: "shell_command", call_id: "c2", arguments: '{"command":"npm test","workdir":"c:\\\\proj"}' } },
  { type: "response_item", payload: { type: "function_call_output", call_id: "c2", output: "Exit code: 0\nWall time: 0.7 seconds\nOutput:\nok" } },
  { type: "event_msg", payload: { type: "agent_message", message: "Corrigé." } },
];

describe("adaptateur Codex", () => {
  it("résume le dernier tour du rollout", () => {
    const turn = turnFromRollout(rollout, "c:\\proj");
    expect(turn.request).toBe("Corrige l'API");
    expect(turn.filesModified).toEqual(["pb_hooks/api.js", "test/api.test.js"]);
    expect(turn.lastTest?.failed).toBe(false);
    expect(turn.lastAssistantText).toBe("Corrigé.");
  });

  it("préfère last_assistant_message et répond au format decision/reason", () => {
    const ctx = codex.context({ session_id: "s", cwd: "c:\\proj", last_assistant_message: "Fini", stop_hook_active: true });
    expect(ctx.finalMessage).toBe("Fini");
    expect(ctx.alreadyContinued).toBe(true);
    expect(JSON.parse(codex.block("encore").stdout!)).toEqual({ decision: "block", reason: "encore" });
  });
});
