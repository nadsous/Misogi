<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-dark.svg">
    <img src="docs/brand/logo.svg" width="120" alt="Misogi">
  </picture>
</p>

<h1 align="center">Misogi</h1>

<p align="center">
  <b>A second opinion on every "done" your coding agent announces.</b><br>
  A slim sidecar window for Claude Code, Codex and Kimi Code, with a judge (Jev) that checks the work before your agent stops.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-5cc8e0"></a>
  <img alt="Windows · macOS · Linux" src="https://img.shields.io/badge/Windows%20·%20macOS%20·%20Linux-desktop-5cc8e0">
  <img alt="Claude Code · Codex · Kimi" src="https://img.shields.io/badge/Claude%20Code%20·%20Codex%20·%20Kimi-hooks-d97757">
  <img alt="Local first" src="https://img.shields.io/badge/local-first-3fc49a">
</p>

<p align="center"><a href="README.fr.md">Lire en français</a></p>

<p align="center">
  <img src="docs/screenshots/feed.png" width="300" alt="Live feed, quotas and sessions">
  <img src="docs/screenshots/projects.png" width="300" alt="Projects and Jev keys">
  <img src="docs/screenshots/feed-rosee.png" width="300" alt="Light theme: Dew">
</p>

---

*Misogi* (禊) is the Shinto purification rite performed under the running water of a river or a waterfall. Your agent's work flows down the stream; Misogi makes sure only clean work reaches the end of it.

## Claude, Jev, Misogi: who does what?

Think of a building site.

| | Role | On the building site |
| --- | --- | --- |
| **Claude Code** (or Codex, Kimi Code) | The **coding agent**. You give it a task, it reads your code, edits files, runs commands, then says "done". | The **builder**. Fast and tireless, but sometimes says the wall is finished before the paint is dry. |
| **Jev** (by TypeSafe) | A **judgment model**. It does not write code: it reads a short summary of what happened and answers typed questions ("finished? yes / no, with a confidence"). In about half a second, for a fraction of a cent. | The **inspector**. Looks at the work and ticks the boxes: finished? tested? any unproven claims? |
| **Misogi** (this project) | The **link between the two, and your window on it all**. When the agent wants to stop, Misogi summarises the turn, asks Jev, shows you the verdict live, and (if you want) sends the agent back to work. | The **site office**. It calls the inspector at the right time, pins every report on the wall, and can tell the builder "not yet, finish the job". |

In one sentence: **Claude does the work, Jev judges it, Misogi connects them and shows you everything.**

A concrete example:

1. You ask Claude: *"Add a contact page and test it."*
2. Claude writes the page, forgets to run the tests, and says *"Done, everything works!"*
3. Misogi catches that moment and sends Jev: the request, the files changed, the test result (none), Claude's final message.
4. Jev answers: *task finished 40 %, tests not run, unverified claim 85 %*.
5. In the Misogi window a red card appears: **"Jev thinks the tests were not run."**
6. In **Protect** mode, Claude receives *"Tests were not run, check before stopping"* and carries on by itself.

Without Misogi, you only discover step 2 later. With Misogi, you see it immediately, and you can let the agent fix it on its own.

## Why

Coding agents are fast, and they say "done" a lot. Sometimes the tests never ran. Sometimes half of the request is still a TODO. Sometimes the final message claims things nothing proves.

Misogi hooks into the moment your agent wants to stop, asks [Jev](https://docs.typesafe.ai) (TypeSafe's typed judgment model) three questions in a single call, and shows you the answer live, in plain language:

- **Is the task actually finished?**
- **Were the tests run after the last change, and did they pass?**
- **Does the final message claim things that nothing verifies?**

Start in **Observe** mode: Misogi only logs what Jev *would* have done. When you trust it, switch a project to **Protect**, and your agent is sent back to work (once per turn) when the job is not done.

## Features

### What works with which agent

| | Claude Code | Kimi Code | Codex |
| --- | :---: | :---: | :---: |
| "Is it really done?" check at the end of the turn | ✅ | ✅ | ✅ |
| Diff review (claims, off-topic and sensitive files, check to run) | ✅ | ✅ | ✅ |
| Request check (clear? which model? which skill?) | ✅ | ✅ | ✅ |
| Shell guard before risky commands | ✅ | ✅ | ✅ |
| Model router | ✅ per project | ✅ once Kimi goes through Misogi | ✅ once Codex goes through Misogi |
| Narrowed reads of large files | ✅ rewritten | ✅ redirected | ✅ redirected (`cat`) |
| `misogi find` / `misogi ask` as a skill | ✅ | ✅ | ✅ |
| Compaction memory | ✅ | — | — |
| Stuck-agent alert, session status, sound | ✅ | ✅ | ✅ |

Codex support is written against its documented hook and provider formats; Claude Code and Kimi are tested end to end.

### Checking the work

| | |
| --- | --- |
| **"Is it really done?"** | Facts first: nothing changed → nothing to check; a test, build, lint or type check passed after the last edit → proven, Jev isn't even called. Otherwise Jev reads the final message against those facts and flags a "done" with no proof, an "I checked" with no check, or a "done" while a check fails. |
| **Diff review** | Every claim of the agent ("I added the tests") is checked against the diff, off-topic files are flagged, sensitive ones (auth, billing, migrations, secrets) come first in the review list, and Misogi names the project's check command to run (`cd apps/backend && npm run test`). Never blocks on its own. |
| **Request check** | Before the agent starts: is your request clear enough, or does it miss the expected result, the place to change, how far to go? Which skill, subagent or `CLAUDE.md` section applies? In Protect mode, the useful hints are given to Claude. |
| **Ticket-aware** | The branch (`feat/123-contact`, `ENG-42-login`) or the request (`#123`) links the session to its GitHub, GitLab or Linear ticket; Jev checks the **acceptance criteria**, not just "done?". |
| **Shell guard** | Before a risky command runs (`rm -rf`, `git push --force`, reading `.env`, uploading data…), Jev judges if it is destructive or leaks secrets, and Misogi refuses it in Protect mode. Ordinary commands run with no delay, in auto and bypass modes too. |
| **Stuck-agent alert** | The same check failing again and again? Jev tells apart an agent going in circles from one that fails differently each time and is making progress; only the first gets a sound and a notification. No hook, no delay for the agent. |

### Saving tokens and your plan

| | |
| --- | --- |
| **Model router** | For each message, Jev picks the model from the size of the work: Haiku, Sonnet or Opus for Claude Code (a rename on Haiku, a billing refactor on Opus); `kimi-for-coding-highspeed`, `kimi-for-coding` or `k3` for Kimi; a "mini" or the most capable model of your list for Codex. Only main turns change, the model never goes down within a session, your login (Claude, Kimi, ChatGPT or API key) is passed through unchanged, and if the chosen model rejects a request it goes back to the original one. Off by default. |
| **Narrowed reads** | When the agent reads a large file (400+ lines) in full, Jev picks the part it is looking for. Claude Code only gets that window (about a fifth); Kimi and Codex are told which lines to re-read, and get the whole file if they insist. Ambiguous cases are left whole. |
| **Search by meaning** | `misogi find "where the user signs up"` finds code by describing it, even when the words differ; `misogi ask "does it build SQL by concatenation?" api/` asks a yes/no question to every file. The three agents get them as a skill: only the answer enters their context. |
| **Compaction memory** | When Claude Code compacts the conversation, Jev picks your lasting instructions ("never touch migrations/", "use pnpm") and they are given back word for word right after the summary. |

### The window

| | |
| --- | --- |
| **Live sidecar** | A 380 px window docked to the edge of your screen, always on top, never steals focus. It reconnects on its own after sleep and restarts its local server if needed. |
| **A sound when it's done** | A drop when an agent finishes its turn (in every project, connected or not), two notes when Misogi needs your call, and a system notification when the window is hidden. |
| **Readable decisions** | The verdict in one sentence, why, what Misogi did, what to do; then the facts, what Jev read, and the agent's request and answer rendered as Markdown. Raw numbers are in "Technical details". |
| **Connect in one click** | A banner shows up when an agent works in a project without Misogi, and *Projects & keys* lists the folders where an agent worked in the last 30 days, each with a **Connect** button. |
| **You stay in charge** | When Jev wants to send the agent back, the window gives you a few seconds: **Let it through** or **Relaunch now**. At most 2 relaunches in a row (configurable). |
| **Quotas, sessions, guides** | Claude and Codex plan limits, tokens per agent, Jev cost, each model's share with the router and tokens kept out of context; working / done / waiting per session; the files that steer your agent (`CLAUDE.md`, skills, hooks, MCP servers). |
| **Your projects, your keys** | Icons found automatically (or a blobatar), agents plugged in, Jev key in the OS keychain, reused when you connect a new project. |
| **13 drops** | Themes named after drops that fall into the stream: water, dew, milk, coffee, latte, fire, dawn, matcha, washi, sakura, salt… Your theme and preferences survive updates. |

### Reliable and private

| | |
| --- | --- |
| **Safe by default** | Fail-open (if anything breaks, the agent carries on), Observe mode first, secrets masked before anything leaves your machine, keys in the OS keychain, logs purged after 30 days (configurable). |
| **Tune it on your data** | Mark each decision "Jev was right / wrong": reliability per helper, replay of past decisions with another threshold, and after 8 ratings Misogi suggests the threshold that would have made the fewest mistakes. |
| **Stable results** | Pin a Jev version per project. The state sent is capped at ~30k tokens and trimmed cleanly. |
| **Headless & remote** | `claude -p` and CI never wait for a click. SSH sessions and dev containers send their decisions to your window with a token (`misogi remote`). |
| **Signed updates** | The desktop app (Windows, macOS, Linux) updates itself from GitHub Releases, checked against a signature. |
| **Accessible** | Keyboard navigation (arrows between decisions, ⌘K palette), screen-reader announcements, every theme checked for WCAG AA contrast in CI. |
| **Clean uninstall** | Agent configs are backed up before any change; removing a project takes back only what Misogi added. |

## FAQ

**"Claude Opus is smarter than Jev. Why ask Jev?"**
Jev does not replace Claude and never writes code. It is an independent checkpoint, like a smoke detector next to a chef. Three reasons it is a separate model:
1. **A model should not grade its own homework.** Claude saying "done" and Claude checking "am I done?" share the same blind spots.
2. **Speed and cost.** Asking Opus to re-read every turn would take 10–60 s and eat your plan quota. Jev answers in ~0.5 s for about $0.0001, and returns a *calibrated* confidence score, not an opinion.
3. **Typed answers.** Jev answers precise yes/no questions ("tests run after the last change?"), which is exactly what an automatic gate needs.

**"Does it stop me from using auto mode?"**
No, it is the opposite. Hooks run in every permission mode, auto and bypass included. The Stop check never asks you anything. The shell guard is what makes auto mode *safer*: dangerous commands are caught before they run, the rest goes through untouched.

**"T3 Code already tracks tasks."**
T3 Code is an interface: it shows the agent's work nicely. It does not verify anything. Misogi runs alongside it (and alongside the terminal, Cursor, anything that drives Claude Code, Codex or Kimi) and adds the verification, the quotas and the shell guard.

**"I don't want to combine 50 tools."**
One install, one window: session status, plan quotas, what guides your agent, "is it really done?", shell guard. Everything else is optional.

**"Why don't I see my Claude plan percentages?"**
Claude Code only shares its 5-hour and 7-day limits with its *status line*, which exists in the terminal (`claude`). Apps built on the Claude Agent SDK, like T3 Code, never run a status line, so the percentages only appear once you have used `claude` in a terminal after clicking *Show my Claude quotas*. Tokens burned are always shown, whatever the app. Codex limits are read from its session files and always work.

**"I coded on a project and Jev did nothing."**
Misogi probably wasn't connected to that project: it only watches the ones you enabled. Click **Connect** in the banner or in **Projects & keys** (see [Connect Misogi to a project](#connect-misogi-to-a-project)). If the project is already connected, run `npx misogi doctor` in its folder.

**"What does it cost?"**
Misogi is free and open source. Jev costs about $0.0001 per check. Nothing is sent without a key.

## Zero telemetry

Misogi sends **nothing** about you, your code or your usage to anyone: no analytics, no crash reporting. What leaves your machine:

- calls to Jev (`hooks/src/jev.ts`), only for projects where you added a key;
- if you turn the router on, your agents' requests, passed through unchanged to their provider (Anthropic, Kimi, OpenAI) with your own login (`hooks/src/router.ts`); Misogi only keeps the model used and the token counts;
- when the app starts, a read of `latest.json` on GitHub to see if an update exists, with no identifier;
- optionally, remote sessions post to *your own* window with *your own* token.

That's it, and you can check it in the code.

## Drops (themes)

<p align="center"><img src="docs/brand/drops.svg" alt="The 13 Misogi drops"></p>

Every theme recolors the glass drop logo. Pick one in **Settings → Drop**, or let **System** switch between *Water* and *Dew* with your OS.

<p align="center">
  <img src="docs/screenshots/drops.png" width="280" alt="Drop picker">
  <img src="docs/screenshots/guides.png" width="280" alt="What guides the agent">
  <img src="docs/screenshots/feed-feu.png" width="280" alt="Fire theme">
</p>

## How it works

```
agent ──Stop hook──▶ node hook.js ──▶ Jev (1.5 s max, otherwise let it through)
                          │
                          ▼
               ~/.misogi/events.jsonl ──▶ misogi serve (SSE) ──▶ sidecar window
```

The window never talks to your agent. Hooks write one JSON line per decision; the local server streams them to the window. Close the window and the hooks keep working.

## Quick start

Requirements: Node 20+, and at least one of Claude Code, Codex or Kimi Code.

The fastest way, nothing to clone:

```sh
npx misogi               # opens the window
npx misogi install       # in your project: hooks for every agent found
```

Or the desktop app from the [Releases](https://github.com/nadsous/Misogi/releases) page (Windows, macOS, Linux, auto-updating). Or from source:

```sh
git clone https://github.com/nadsous/Misogi && cd Misogi
npm install
npm run build
npm run serve            # open http://127.0.0.1:4317
```

### Connect Misogi to a project

Misogi only watches the projects you connect it to. In a project that isn't connected, your agent works as usual, but Jev sees nothing and no decision shows up.

**The easy way: from the window**

1. **When an agent works in a project without Misogi**, a banner appears at the top of the window: *"Claude is working in my-project without Misogi"*. Click **Connect**.
2. **For your other projects**, open **Projects & keys**. The *Recent projects without Misogi* section lists the folders where Claude, Codex or Kimi worked in the last 30 days. Click **Connect** next to the one you want.
3. **For a project no agent has opened yet**, use *Add a project* at the bottom of **Projects & keys** (**Browse** button in the app).

Connecting a project:
- installs the hooks for every agent found on your machine;
- puts them in **Observer** mode: Misogi records what Jev thinks but never blocks anything;
- reuses your Jev key if you already set it for another project. Otherwise, paste it once in the project card ([TypeSafe console](https://console.typesafe.ai)).

**From the terminal, inside the project folder**

```sh
npx misogi install       # hooks for every agent found (or: install claude)
npx misogi key set       # Jev key, stored in the OS keychain
npx misogi doctor        # checks everything at once: tracked project, hooks, key, log
```

**What it changes in your project**
- `.claude/settings.local.json` (Claude Code) or `.codex/hooks.json` (Codex) gets the hook. The original file is backed up next to it (`.misogi-backup`).
- For Kimi, the hook goes in `~/.kimi/config.toml` and only reacts to connected projects.
- `.misogi/config.json` keeps the project settings (mode, threshold, shell guard). Commit it to share the settings with your team, or add `.misogi/` to your `.gitignore`.

**Check it works.** Finish a turn with your agent in that project: a decision appears in the feed. If it was just a question with no file changes, Misogi shows it without calling Jev, since there was nothing to verify.

**Disconnect it.** In **Projects & keys**, open the project and click **Remove from Misogi**: the hooks are removed and your config files restored.

No key yet? `MISOGI_MOCK=1` gives simulated answers so you can try everything.

📘 **[How to get the most out of Jev in your projects](docs/jev-guide.md)**: key, observation week, pinning, tests, shell guard, CI, remote sessions.

**Claude quotas**: click *Show my Claude quotas* in the Quotas panel. Misogi adds a status line to Claude Code that records your plan limits; if you already had a status line, it is kept and still displayed.

### Desktop app

```sh
npm run tauri -- dev      # needs Rust (rustup.rs)
npm run tauri -- build    # .msi/.exe, .dmg, AppImage/.deb/.rpm
```

Global shortcut: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> on macOS). Command palette: <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>K</kbd>.

## Privacy

- Nothing leaves your machine except the short state sent to Jev, and only for projects where you added a key.
- Choose what is sent per project: **minimal** (metadata only), **reduced** (request, file names, test result, agent message) or **full**. A *client code* profile forces minimal.
- API keys, tokens, `.env` values, e-mails and private keys are masked before sending, at every level.
- The log keeps a SHA-256 hash of the state, not the state itself, unless you turn on `log_state` for debugging.

## Project settings

`<project>/.misogi/config.json`, editable from the window:

```json
{ "mode": "shadow", "profile": "default", "threshold": 0.5, "state_level": "reduced", "log_state": false, "model": "jev-latest", "timeout_ms": 1500 }
```

## Development

```sh
npm test                          # unit tests
npm run typecheck
node scripts/hook-smoke.mjs       # bundled hook, no agent needed (CI)
node scripts/smoke.mjs --active   # real agents on a scratch project, mock mode
node scripts/brand.ts             # regenerate logo, favicon, icons and the drops banner
node scripts/screenshots.mjs      # regenerate README screenshots (uses your installed Edge/Chrome)
```

Adding an agent is one adapter in `hooks/src/adapters/` (hook input → `StopContext`, plus the reply that makes it continue) and one config file in `install.ts`.

## Roadmap

- [x] Stop hook "is it really done?", shadow and active modes
- [x] Claude Code, Kimi Code, Codex adapters
- [x] Live sidecar, quotas, session status, what guides your agent, 13 themes
- [x] Desktop app (Tauri): docked window, tray, global shortcut, autostart, notifications
- [x] Shell guard before commands (destructive? secrets? `.env`?)
- [x] Relaunch limit, decide from the window, headless mode, remote sessions, log retention, Jev pinning
- [x] Threshold replay on past decisions, "Jev was right / wrong" labels, measured reliability
- [x] Ticket acceptance criteria (GitHub, GitLab, Linear) judged by Jev
- [x] `npx misogi`, signed auto-updates
- [x] Claude Code subagents: their edits and checks count in the turn
- [x] Request check, diff review, stuck-agent alert, compaction memory, suggested threshold
- [x] Model router, narrowed reads, `misogi find` / `misogi ask`, all native and visible in the window
- [x] Kimi and Codex: router, narrowed reads and search, like Claude Code
- [ ] Signed macOS / Windows builds (see [docs/signing.md](docs/signing.md))
- [ ] Optional Supabase sync across machines

## Credits

Agent logos come from [Simple Icons](https://simpleicons.org) (CC0); Claude, OpenAI, Kimi, TypeSafe and Jev are trademarks of their respective owners. Misogi is not affiliated with any of them.

## License

[MIT](LICENSE)
