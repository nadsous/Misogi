import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

  it("compte les modifications et les tests des sous-agents, dans l'ordre du temps", () => {
    const dir = mkdtempSync(join(tmpdir(), "misogi-"));
    const file = join(dir, "sess.jsonl");
    const main = [
      { type: "user", timestamp: "2026-09-30T10:00:00Z", message: { content: "Corrige le bug du panier" } },
      { type: "assistant", timestamp: "2026-09-30T10:00:01Z", message: { content: [{ type: "tool_use", id: "a1", name: "Agent", input: { prompt: "corrige" } }] } },
      { type: "user", timestamp: "2026-09-30T10:00:02Z", toolUseResult: { agentId: "abc123" }, message: { content: [{ type: "tool_result", tool_use_id: "a1", content: "lancé" }] } },
      // Fin du sous-agent en arrière-plan : pas une nouvelle demande de l'utilisateur.
      { type: "user", timestamp: "2026-09-30T10:00:09Z", origin: { kind: "task-notification" }, promptSource: "system", message: { content: "<task-notification>fini</task-notification>" } },
      { type: "assistant", timestamp: "2026-09-30T10:00:10Z", message: { content: [{ type: "text", text: "Corrigé et testé." }] } },
    ];
    const sub = [
      { type: "user", timestamp: "2026-09-30T10:00:03Z", message: { content: "corrige" } },
      { type: "assistant", timestamp: "2026-09-30T10:00:04Z", message: { content: [{ type: "tool_use", id: "s1", name: "Edit", input: { file_path: join(cwd, "cart.ts") } }] } },
      { type: "user", timestamp: "2026-09-30T10:00:05Z", message: { content: [{ type: "tool_result", tool_use_id: "s1", content: "ok" }] } },
      { type: "assistant", timestamp: "2026-09-30T10:00:06Z", message: { content: [{ type: "tool_use", id: "s2", name: "Bash", input: { command: "npm test" } }] } },
      { type: "user", timestamp: "2026-09-30T10:00:07Z", message: { content: [{ type: "tool_result", tool_use_id: "s2", content: "12 passed" }] } },
      { type: "assistant", timestamp: "2026-09-30T10:00:08Z", message: { content: [{ type: "text", text: "texte du sous-agent" }] } },
    ];
    writeFileSync(file, main.map((e) => JSON.stringify(e)).join("\n"));
    mkdirSync(join(dir, "sess", "subagents"), { recursive: true });
    writeFileSync(join(dir, "sess", "subagents", "agent-abc123.jsonl"), sub.map((e) => JSON.stringify(e)).join("\n"));

    const ctx = claude.context({ transcript_path: file, cwd });
    expect(ctx.request).toBe("Corrige le bug du panier");
    expect(ctx.filesModified).toEqual(["cart.ts"]);
    expect(ctx.checks?.map((c) => [c.command, c.failed])).toEqual([["npm test", false]]);
    expect(ctx.finalMessage).toBe("Corrigé et testé.");
  });

  it("ne prend pas le résumé de compaction pour la demande", () => {
    const turn = turnFromEntries(
      [
        { type: "user", message: { content: "Corrige le bug de la fenêtre vide" } },
        { type: "user", isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { content: "This session is being continued from a previous conversation…" } },
        { type: "assistant", message: { content: [{ type: "text", text: "Corrigé." }] } },
      ],
      cwd,
    );
    expect(turn.request).toBe("Corrige le bug de la fenêtre vide");
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
