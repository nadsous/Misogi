import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claude, turnFromEntries } from "../src/adapters/claude.js";
import { parseJsonl } from "../src/adapters/common.js";

const cwd = join(tmpdir(), "proj");

const transcript = [
  { type: "user", message: { content: "ancienne demande" } },
  { type: "assistant", message: { content: [{ type: "tool_use", id: "t0", name: "Write", input: { file_path: join(cwd, "old.ts") } }] } },
  { type: "user", message: { content: [{ type: "text", text: "Ajoute une route /health et teste-la" }] } },
  { type: "user", isMeta: true, message: { content: "<system-reminder>ignore</system-reminder>" } },
  { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: join(cwd, "src", "server.ts") } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
  { type: "assistant", isSidechain: true, message: { content: [{ type: "tool_use", id: "s1", name: "Write", input: { file_path: join(cwd, "side.ts") } }] } },
  { type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "npm test" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: true, content: [{ type: "text", text: "1 failed" }] }] } },
  { type: "assistant", message: { content: [{ type: "text", text: "C'est fait, tout passe." }] } },
];

describe("adaptateur Claude", () => {
  it("extrait la demande, les fichiers et le dernier test du tour courant", () => {
    const turn = turnFromEntries(transcript, cwd);
    expect(turn.request).toBe("Ajoute une route /health et teste-la");
    expect(turn.filesModified).toEqual(["src/server.ts"]);
    expect(turn.lastTest).toEqual({ command: "npm test", failed: true, output: "1 failed" });
    expect(turn.lastAssistantText).toBe("C'est fait, tout passe.");
  });

  it("lit le transcript sur disque et préfère last_assistant_message", () => {
    const dir = mkdtempSync(join(tmpdir(), "misogi-"));
    const file = join(dir, "t.jsonl");
    writeFileSync(file, transcript.map((e) => JSON.stringify(e)).join("\r\n") + "\r\n");
    const ctx = claude.context({ session_id: "s", transcript_path: file, cwd, last_assistant_message: "Fini.", stop_hook_active: true });
    expect(ctx.agent).toBe("claude");
    expect(ctx.finalMessage).toBe("Fini.");
    expect(ctx.filesModified).toEqual(["src/server.ts"]);
    expect(ctx.alreadyContinued).toBe(true);
  });

  it("survit à un transcript absent", () => {
    const ctx = claude.context({ transcript_path: join(tmpdir(), "absent.jsonl"), cwd });
    expect(ctx.request).toBe("");
    expect(ctx.lastTest).toBeNull();
  });

  it("ignore les lignes JSONL abîmées", () => {
    expect(parseJsonl('{"a":1}\r\n{cassé\n\n{"b":2}')).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
