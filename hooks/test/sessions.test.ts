import { describe, expect, it } from "vitest";
import { claudeState, codexState, kimiState } from "../src/sessions.js";

describe("statut des sessions", () => {
  it("Claude : terminé, travaille, attend", () => {
    const done = [{ type: "assistant", message: { content: [{ type: "text" }], stop_reason: "end_turn" } }];
    const tool = [{ type: "assistant", message: { content: [{ type: "tool_use" }], stop_reason: "tool_use" } }];
    expect(claudeState(done, 1000)).toBe("done");
    expect(claudeState(tool, 1000)).toBe("working");
    expect(claudeState(tool, 20_000)).toBe("waiting");
    expect(claudeState([{ type: "user", message: { content: "fais ça" } }], 1000)).toBe("working");
  });

  it("Kimi : TurnEnd = terminé, outil sans résultat = attend", () => {
    const begin = { message: { type: "TurnBegin", payload: {} } };
    const call = { message: { type: "ToolCall", payload: { id: "t" } } };
    expect(kimiState([begin, call, { message: { type: "ToolResult", payload: { tool_call_id: "t" } } }, { message: { type: "TurnEnd", payload: {} } }], 1000)).toBe("done");
    expect(kimiState([begin, call], 20_000)).toBe("waiting");
    expect(kimiState([begin], 1000)).toBe("working");
  });

  it("Codex : task_complete = terminé", () => {
    const started = { type: "event_msg", payload: { type: "task_started" } };
    expect(codexState([started, { type: "event_msg", payload: { type: "task_complete" } }], 1000)).toBe("done");
    expect(codexState([started, { type: "response_item", payload: { type: "function_call", call_id: "c" } }], 20_000)).toBe("waiting");
  });

  it("une session muette depuis longtemps est terminée", () => {
    expect(kimiState([{ message: { type: "TurnBegin", payload: {} } }], 60 * 60_000)).toBe("done");
  });
});
