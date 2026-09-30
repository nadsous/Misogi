import { execFileSync } from "node:child_process";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { turnFromEntries } from "../src/adapters/claude.js";
import { CHECK_COMMAND, outputLooksFailed, WRITE_COMMAND } from "../src/adapters/common.js";
import { gitChangesSince, withGitEvidence } from "../src/evidence.js";
import type { StopContext } from "../src/types.js";

const t = (s: number) => new Date(Date.parse("2026-09-30T10:00:00Z") + s * 1000).toISOString();
const user = (text: string, s: number) => ({ type: "user", timestamp: t(s), message: { content: text } });
const bash = (id: string, command: string, s: number) => ({ type: "assistant", timestamp: t(s), message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
const result = (id: string, output: string, s: number, isError = false) => ({ type: "user", timestamp: t(s), message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: output }] } });

describe("faits du tour", () => {
  it("reconnaît vérifications et écritures shell", () => {
    for (const c of ["npm test", "npx vitest run", "npx tsc --noEmit", "npm run build", "cargo clippy", "ruff check .", "go vet ./..."]) expect(CHECK_COMMAND.test(c)).toBe(true);
    for (const c of ["sed -i 's/a/b/' x.ts", "python scripts/fix.py", "echo hi > a.txt", "cp a b", "npm install zod"]) expect(WRITE_COMMAND.test(c)).toBe(true);
    for (const c of ["ls -la", "git status", "cat a.txt", "npm test 2>&1 | grep FAIL"]) expect(WRITE_COMMAND.test(c)).toBe(false);
  });

  it("lit l'échec dans la sortie quand un | grep masque le code de sortie", () => {
    expect(outputLooksFailed("Tests  3 failed | 70 passed (73)")).toBe(true);
    expect(outputLooksFailed("src/a.ts(3,1): error TS2322: Type")).toBe(true);
    expect(outputLooksFailed("Tests  73 passed (73)")).toBe(false);
    expect(outputLooksFailed("0 errors, 0 warnings")).toBe(false);
  });

  it("une modification par script shell après le test annule la preuve", () => {
    const turn = turnFromEntries(
      [user("corrige le bug", 0), bash("a", "npx vitest run", 10), result("a", "Tests 12 passed", 20), bash("b", "python scripts/patch.py", 30), result("b", "ok", 31)],
      "/p",
    );
    expect(turn.editCount).toBe(1);
    expect(turn.checks).toEqual([expect.objectContaining({ command: "npx vitest run", failed: false, afterLastEdit: false })]);
    expect(turn.startedAt).toBe(Date.parse(t(0)));
  });

  it("un test réussi après la dernière écriture prouve le travail", () => {
    const turn = turnFromEntries([user("x", 0), bash("b", "sed -i 's/a/b/' src/x.ts", 5), result("b", "", 6), bash("a", "npm test | grep -E 'Tests|FAIL'", 10), result("a", "Tests 12 passed", 20)], "/p");
    expect(turn.checks[0]).toMatchObject({ failed: false, afterLastEdit: true, at: Date.parse(t(20)) });
  });

  it("git voit les fichiers modifiés hors des outils d'édition", () => {
    const root = mkdtempSync(join(tmpdir(), "misogi-git-ev-"));
    execFileSync("git", ["init", "-q", root]);
    writeFileSync(join(root, "old.txt"), "ancien");
    const past = Date.now() / 1000 - 3600;
    utimesSync(join(root, "old.txt"), past, past);
    writeFileSync(join(root, "new.ts"), "export {}");
    const since = Date.now() - 60_000;
    const changes = gitChangesSince(root, since);
    expect(changes.map((c) => c.file)).toEqual(["new.ts"]);

    const ctx: StopContext = {
      agent: "claude",
      project: root,
      session: "s",
      request: "",
      filesModified: [],
      lastTest: null,
      finalMessage: "",
      alreadyContinued: false,
      editCount: 0,
      checks: [{ command: "npm test", failed: false, afterLastEdit: true, at: since, output: "" }],
    };
    const merged = withGitEvidence(ctx, changes);
    expect(merged.filesModified).toEqual(["new.ts"]);
    expect(merged.editCount).toBe(1);
    // Le test a tourné avant que new.ts ne change : il ne prouve plus l'état final.
    expect(merged.checks?.[0]?.afterLastEdit).toBe(false);
  });
});
