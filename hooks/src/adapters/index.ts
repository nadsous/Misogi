import type { Agent } from "../types.js";
import { claude } from "./claude.js";
import { codex } from "./codex.js";
import type { StopAdapter } from "./common.js";
import { kimi } from "./kimi.js";

export const STOP_ADAPTERS: Record<Agent, StopAdapter> = { claude, codex, kimi };

export function isAgent(v: string | undefined): v is Agent {
  return v === "claude" || v === "codex" || v === "kimi";
}
