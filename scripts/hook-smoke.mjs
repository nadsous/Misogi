#!/usr/bin/env node
// Test de fumée sans agent, pour la CI : envoie au hook bundlé l'entrée réelle de chaque agent
// (formats observés) et vérifie qu'une décision est écrite et que le hook sort toujours en 0.
// Usage : node scripts/hook-smoke.mjs   (après scripts/bundle-sidecar.mjs)

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(new URL("../hooks/bundle/hook.js", import.meta.url));
const home = mkdtempSync(join(tmpdir(), "misogi-ci-"));
const project = mkdtempSync(join(tmpdir(), "misogi-ci-proj-"));

const inputs = {
  claude: { session_id: "c", transcript_path: join(project, "absent.jsonl"), cwd: project, hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "Fait." },
  kimi: { hook_event_name: "Stop", session_id: "k", cwd: project, stop_hook_active: false },
  codex: { session_id: "x", transcript_path: null, cwd: project, hook_event_name: "Stop", turn_id: "t", stop_hook_active: false, last_assistant_message: "Fait." },
};

let failed = 0;
for (const [agent, input] of Object.entries(inputs)) {
  const run = spawnSync(process.execPath, [hook, agent, "stop"], {
    input: JSON.stringify(input),
    env: { ...process.env, MISOGI_HOME: home, MISOGI_MOCK: "1" },
    encoding: "utf8",
  });
  const ok = run.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${agent} : code ${run.status}${run.stderr ? ` ${run.stderr.trim()}` : ""}`);
}

// Entrée illisible : fail-open, code 0.
const broken = spawnSync(process.execPath, [hook, "claude", "stop"], { input: "pas du json", encoding: "utf8" });
if (broken.status !== 0) failed++;
console.log(`${broken.status === 0 ? "✓" : "✗"} entrée illisible : code ${broken.status}`);

const events = readFileSync(join(home, "events.jsonl"), "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));
const agents = events.map((e) => e.agent).sort().join(",");
if (agents !== "claude,codex,kimi") failed++;
console.log(`${agents === "claude,codex,kimi" ? "✓" : "✗"} journal : ${events.length} décision(s) (${agents})`);
process.exit(failed ? 1 : 0);
