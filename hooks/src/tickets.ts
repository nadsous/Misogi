// Tickets liés à une session : GitHub, GitLab ou Linear.
// On repère la référence dans le nom de branche (feat/123-contact, ENG-42-login) ou dans la demande (#123, ENG-42),
// on récupère le ticket, et ses critères d'acceptation sont envoyés à Jev avec le reste du tour.
// Jev peut alors juger « le travail remplit-il les critères du ticket ? », bien plus précis que « est-ce fini ? ».
//
// Jetons : GitHub via `gh auth token` ou GITHUB_TOKEN ; GitLab via GITLAB_TOKEN ; Linear via LINEAR_API_KEY ;
// ou rangés dans le trousseau depuis la fenêtre (Réglages → Tickets).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { misogiHome } from "./config.js";
import { getSecret } from "./keys.js";

export type Provider = "github" | "gitlab" | "linear";

export interface Ticket {
  provider: Provider;
  id: string;
  title: string;
  url: string;
  /** Critères d'acceptation extraits, sinon le début de la description. */
  criteria: string;
}

export interface TicketRef {
  provider: Provider;
  id: string;
  /** owner/repo pour GitHub et GitLab. */
  repo?: string;
  host?: string;
}

const CACHE_TTL_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 1500;

// --- git : branche courante et dépôt distant, lus directement dans .git (pas de processus git)

function gitDir(root: string): string | null {
  const dotGit = join(root, ".git");
  if (!existsSync(dotGit)) return null;
  if (statSync(dotGit).isDirectory()) return dotGit;
  // worktree / sous-module : fichier « gitdir: chemin »
  const m = /gitdir:\s*(.+)/.exec(readFileSync(dotGit, "utf8"));
  if (!m) return null;
  const p = m[1]!.trim();
  return isAbsolute(p) ? p : resolve(root, p);
}

export function gitInfo(root: string): { branch: string | null; host: string | null; repo: string | null } {
  const dir = gitDir(root);
  if (!dir) return { branch: null, host: null, repo: null };
  let branch: string | null = null;
  try {
    branch = /ref:\s*refs\/heads\/(.+)/.exec(readFileSync(join(dir, "HEAD"), "utf8"))?.[1]?.trim() ?? null;
  } catch {
    // HEAD illisible
  }
  let host: string | null = null;
  let repo: string | null = null;
  // Pour un worktree, la config est dans le dépôt principal (commondir).
  const commondir = existsSync(join(dir, "commondir")) ? resolve(dir, readFileSync(join(dir, "commondir"), "utf8").trim()) : dir;
  try {
    const config = readFileSync(join(commondir, "config"), "utf8");
    const url = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(config)?.[1];
    if (url) ({ host, repo } = parseRemote(url));
  } catch {
    // pas de remote
  }
  return { branch, host, repo };
}

export function parseRemote(url: string): { host: string | null; repo: string | null } {
  const m = /^(?:[\w+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](?:\d+\/)?(.+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { host: m[1]!.toLowerCase(), repo: m[2]! } : { host: null, repo: null };
}

// --- repérer une référence

const LINEAR = /\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/;
// Faux amis courants de la forme ABC-123.
const NOT_LINEAR = /^(UTF|ISO|SHA|RFC|CVE|MD|AES|HTTP|TLS|SSL|X|ES|IE|WCAG)-/;

export function findRef(branch: string | null, request: string, host: string | null, repo: string | null, hasLinear: boolean): TicketRef | null {
  const provider: Provider | null = host?.includes("gitlab") ? "gitlab" : host?.includes("github") ? "github" : host ? "gitlab" : null;
  const sources = [branch ?? "", request.slice(0, 2000)];
  for (const text of sources) {
    if (hasLinear) {
      const m = LINEAR.exec(text.toUpperCase() === text ? text : text.replace(/[a-z]+-\d+/gi, (s) => s.toUpperCase()));
      if (m && !NOT_LINEAR.test(m[1]!)) return { provider: "linear", id: m[1]! };
    }
    if (provider && repo) {
      const inBranch = text === branch ? /(?:^|\/)(?:(?:issues?|gh|gl)[-_]?(\d{1,7})\b|(\d{1,7})[-_][a-z])/i.exec(text) : null; // feat/123-contact, issue-123
      const num = /(?:^|[\s(])#(\d{1,7})\b/.exec(text)?.[1] ?? inBranch?.[1] ?? inBranch?.[2]; // ou #123 dans la demande
      if (num) return { provider, id: num, repo, host: host ?? undefined };
    }
  }
  return null;
}

// --- récupérer le ticket

async function getJson(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function githubToken(): Promise<string | undefined> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const stored = await getSecret("github");
  if (stored) return stored;
  try {
    return execFileSync("gh", ["auth", "token"], { timeout: 800, encoding: "utf8", windowsHide: true }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function fetchTicket(ref: TicketRef): Promise<Ticket | null> {
  if (ref.provider === "github") {
    const token = await githubToken();
    const host = !ref.host || ref.host === "github.com" ? "api.github.com" : `${ref.host}/api/v3`;
    const j = (await getJson(`https://${host}/repos/${ref.repo}/issues/${ref.id}`, {
      headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    })) as { title: string; body: string | null; html_url: string };
    return { provider: "github", id: `#${ref.id}`, title: j.title, url: j.html_url, criteria: extractCriteria(j.body ?? "") };
  }
  if (ref.provider === "gitlab") {
    const token = process.env.GITLAB_TOKEN ?? (await getSecret("gitlab"));
    const j = (await getJson(`https://${ref.host ?? "gitlab.com"}/api/v4/projects/${encodeURIComponent(ref.repo ?? "")}/issues/${ref.id}`, {
      headers: token ? { "private-token": token } : {},
    })) as { title: string; description: string | null; web_url: string };
    return { provider: "gitlab", id: `#${ref.id}`, title: j.title, url: j.web_url, criteria: extractCriteria(j.description ?? "") };
  }
  const key = process.env.LINEAR_API_KEY ?? (await getSecret("linear"));
  if (!key) return null;
  const j = (await getJson("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: key },
    body: JSON.stringify({ query: "query($id: String!) { issue(id: $id) { identifier title description url } }", variables: { id: ref.id } }),
  })) as { data?: { issue?: { identifier: string; title: string; description: string | null; url: string } } };
  const i = j.data?.issue;
  return i ? { provider: "linear", id: i.identifier, title: i.title, url: i.url, criteria: extractCriteria(i.description ?? "") } : null;
}

/** Garde la section « critères d'acceptation » (ou les cases à cocher) ; à défaut, le début de la description. */
export function extractCriteria(body: string, max = 2500): string {
  const text = body.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "").trim();
  const heading = /^(#{1,6}\s*|\*\*)?\s*(acceptance criteria|crit[eè]res d['’]acceptation|crit[eè]res|definition of done|done when|to do|requirements|exigences)\b.*$/im;
  const m = heading.exec(text);
  if (m) {
    const after = text.slice(m.index + m[0].length);
    const end = after.search(/^#{1,6}\s|^\*\*[^*\n]+\*\*\s*$/m);
    const section = (end === -1 ? after : after.slice(0, end)).trim();
    if (section) return section.slice(0, max);
  }
  const boxes = text.split("\n").filter((l) => /^\s*[-*]\s*\[[ xX]\]/.test(l));
  if (boxes.length) return boxes.join("\n").slice(0, max);
  return text.slice(0, max);
}

// --- avec cache : un ticket ne change pas toutes les minutes, et le hook doit rester rapide

function cacheFile(ref: TicketRef): string {
  return join(misogiHome(), "tickets", `${ref.provider}-${(ref.repo ?? "").replace(/[^\w.-]+/g, "_")}-${ref.id.replace(/[^\w-]/g, "")}.json`);
}

export async function ticketFor(projectRoot: string, request: string): Promise<Ticket | null> {
  const { branch, host, repo } = gitInfo(projectRoot);
  const hasLinear = !!(process.env.LINEAR_API_KEY || (await getSecret("linear")));
  const ref = findRef(branch, request, host, repo, hasLinear);
  if (!ref) return null;
  const file = cacheFile(ref);
  try {
    const cached = JSON.parse(readFileSync(file, "utf8")) as { at: number; ticket: Ticket | null };
    if (Date.now() - cached.at < CACHE_TTL_MS) return cached.ticket;
  } catch {
    // pas en cache
  }
  let ticket: Ticket | null = null;
  try {
    ticket = await fetchTicket(ref);
  } catch {
    // ticket introuvable, privé sans jeton, ou réseau : on juge sans
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ at: Date.now(), ticket }));
  return ticket;
}
