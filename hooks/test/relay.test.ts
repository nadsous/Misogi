import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { codexRelayOn, codexRelayToml, setCodexRelay } from "../src/relay.js";
import { decideRoute, modelFor, rememberCodexModels, rewriteOpenAI, routeKey, targetFor } from "../src/router.js";

afterEach(() => {
  for (const k of ["MISOGI_HOME", "CODEX_HOME"]) delete process.env[k];
});

describe("relais Kimi et Codex", () => {
  it("relaie chaque agent vers son service", () => {
    expect(targetFor("/v1/messages?beta=true", {})).toEqual({ agent: "claude", host: "api.anthropic.com", path: "/v1/messages?beta=true" });
    expect(targetFor("/codex/v1/responses", { "chatgpt-account-id": "a" })).toEqual({ agent: "codex", host: "chatgpt.com", path: "/backend-api/codex/responses" });
    expect(targetFor("/codex/v1/responses", {})).toEqual({ agent: "codex", host: "api.openai.com", path: "/v1/responses" });
    expect(targetFor("/kimi/v1/chat/completions", {})).toEqual({ agent: "kimi", host: "api.kimi.com", path: "/coding/v1/chat/completions" });
  });

  it("change le modèle d'après la session (prompt_cache_key pour Kimi, en-tête session-id pour Codex)", () => {
    const route = (key: string) => (key === "kimi-s1" ? { model: "k3" } : key === "codex-c1" ? { model: "gpt-5.4-mini" } : null);
    const kimi = rewriteOpenAI("kimi", {}, Buffer.from(JSON.stringify({ model: "kimi-for-coding", prompt_cache_key: "s1", messages: [] })), route);
    expect(JSON.parse(kimi!.body.toString())).toMatchObject({ model: "k3", prompt_cache_key: "s1" });
    const codex = rewriteOpenAI("codex", { "session-id": "c1" }, Buffer.from(JSON.stringify({ model: "gpt-5.4", input: [] })), route);
    expect(codex).toMatchObject({ model: "gpt-5.4-mini", from: "gpt-5.4" });
    expect(rewriteOpenAI("kimi", {}, Buffer.from(JSON.stringify({ model: "x", prompt_cache_key: "inconnu" })), route)).toBeNull();
  });

  it("choisit les modèles Codex d'après la liste reçue, et ne décide rien sans elle", () => {
    process.env.MISOGI_HOME = mkdtempSync(join(tmpdir(), "relay-"));
    const config = { ...DEFAULT_CONFIG, router: { ...DEFAULT_CONFIG.router, enabled: true } };
    expect(decideRoute(routeKey("codex", "c9"), "small", config, "codex")).toBeNull();
    rememberCodexModels(JSON.stringify({ models: [{ slug: "gpt-6-astra" }, { slug: "gpt-6-astra-mini" }, { slug: "old", visibility: "hide" }] }));
    expect([modelFor("codex", "fast", config), modelFor("codex", "balanced", config), modelFor("codex", "frontier", config)]).toEqual(["gpt-6-astra-mini", "gpt-6-astra", "gpt-6-astra"]);
    expect(decideRoute(routeKey("kimi", "k1"), "large", config, "kimi")).toMatchObject({ tier: "frontier", model: "k3" });
  });

  it("déclare le fournisseur misogi dans ~/.codex/config.toml, puis le retire sans rien toucher d'autre", () => {
    const original = 'model = "gpt-5.4"\napproval_policy = "on-request"\n\n[mcp_servers.docs]\ncommand = "docs"\n';
    const on = codexRelayToml(original, true);
    const parsed = parse(on) as { model_provider: string; model_providers: { misogi: { requires_openai_auth: boolean; supports_websockets: boolean } }; mcp_servers: unknown };
    expect(parsed.model_provider).toBe("misogi");
    expect(parsed.model_providers.misogi).toMatchObject({ requires_openai_auth: true, supports_websockets: false });
    expect(parsed.mcp_servers).toEqual({ docs: { command: "docs" } });
    expect(codexRelayOn(on)).toBe(true);
    expect(codexRelayToml(on, false)).toBe(original);
  });

  it("refuse de remplacer un autre fournisseur, et sauvegarde le fichier avant de l'écrire", () => {
    process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), "codex-"));
    const file = join(process.env.CODEX_HOME, "config.toml");
    writeFileSync(file, 'model_provider = "azure"\n');
    expect(setCodexRelay(true)).toMatchObject({ ok: false });
    writeFileSync(file, 'model = "gpt-5.4"\n');
    expect(setCodexRelay(true).ok).toBe(true);
    expect(readFileSync(file + ".misogi-backup", "utf8")).toBe('model = "gpt-5.4"\n');
    expect(setCodexRelay(false).ok).toBe(true);
    expect(readFileSync(file, "utf8")).toBe('model = "gpt-5.4"\n');
  });
});
