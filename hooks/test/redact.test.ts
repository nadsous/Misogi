import { describe, expect, it } from "vitest";
import { loadProjectConfig, saveProjectConfig } from "../src/config.js";
import { redact, redactDeep } from "../src/redact.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("masquage des secrets", () => {
  it.each([
    ["clé Anthropic", "export KEY sk-ant-api03-abcdefghijklmnopqrstuv", "sk-ant"],
    ["token GitHub", "token ghp_abcdefghijklmnopqrstuvwxyz0123456789", "ghp_"],
    ["clé AWS", "AKIAIOSFODNN7EXAMPLE", "AKIA"],
    ["JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "eyJ"],
    ["Bearer", "Authorization: Bearer abcdef0123456789abcdef", "abcdef0123456789"],
    ["ligne .env", "DATABASE_URL=postgres://u:p@h/db", "postgres://"],
    ["mot de passe JSON", '{"password": "hunter2"}', "hunter2"],
    ["URL avec identifiants", "git clone https://nads:s3cret@github.com/x.git", "s3cret"],
    ["e-mail", "écris à nads@example.com", "nads@example.com"],
    ["clé privée", "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----", "MIIE"],
  ])("%s", (_, input, secret) => {
    expect(redact(input)).not.toContain(secret);
  });

  it("laisse le texte ordinaire intact", () => {
    const text = "J'ai modifié src/server.ts et lancé npm test : 12 tests passent.";
    expect(redact(text)).toBe(text);
  });

  it("parcourt les structures imbriquées", () => {
    expect(redactDeep({ a: ["TOKEN=abc"], n: 3 })).toEqual({ a: ["TOKEN=[masqué]"], n: 3 });
  });
});

describe("profil code client", () => {
  it("force le niveau minimal et coupe log_state", () => {
    const dir = mkdtempSync(join(tmpdir(), "misogi-proj-"));
    saveProjectConfig(dir, { profile: "client", state_level: "full", log_state: true });
    const c = loadProjectConfig(dir);
    expect(c.state_level).toBe("minimal");
    expect(c.log_state).toBe(false);
  });
});
