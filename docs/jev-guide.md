# Getting the most out of Jev in your projects

How to plug Jev into a project with Misogi, and tune it so it saves you time instead of getting in the way.

## How Misogi judges a "done"

Misogi follows what was measured on real agent stops (jev-belay: AUROC 0.976 with the facts, 0.777 judging the sentence alone). **Facts** come before words (for Claude Code, edits and checks made by subagents count too):

1. **Nothing changed** during the turn (a question, an explanation) → nothing to verify, Jev is not called.
2. **A test, build, lint or type check passed after the last edit** → proven, Jev is not called.
3. Otherwise Jev reads the final message in light of the facts: *does it claim "done"? does it claim it checked? would a check be meaningful here? what is the outcome (complete, partial, blocked, just an explanation)?* Misogi flags a "done" with no proof, an "I checked" with no check, or a "done" while a check fails.

Facts come from the agent's transcript **and from git**: a file changed by a script or shell command counts too, and a test run *before* the last edit no longer proves anything. Test results are never asked to Jev, so pasted text in the request cannot fool it.

## 1. Get a key

1. Create an account on the [TypeSafe console](https://console.typesafe.ai) and generate an API key.
2. One key works for every project. You can also use one per project to track costs separately.

Indicative price: $0.042 per million input tokens, nothing for output. A Misogi check is 1,000–2,000 tokens, about **$0.00005–0.0001**. A thousand checks cost less than 10 cents.

## 2. Plug a project in

Misogi only watches connected projects. In the window:

- **An agent is working in a project that isn't connected**: a banner at the top of the window says so, click **Connect**.
- **Projects & keys → Recent projects without Misogi**: every folder where an agent worked in the last 30 days, with a **Connect** button.
- **Any other folder**: **+** (left column) → pick the folder.

The Jev key you already use for another project is reused. Otherwise, paste it in the project card and click **Test**.

Tick "Use this key for all my projects" to reuse it everywhere.

From the terminal, inside the project:

```sh
misogi install        # hooks for every agent found (Claude Code, Codex, Kimi)
misogi key set        # stored in the OS keychain, never in a file
misogi doctor --ping  # checks key, hooks, log, and that Jev answers
```

The key is never written to the repository. In CI or on a server, pass it through `TYPESAFE_API_KEY` (a repository secret).

## 3. The observation week

Keep the project in **Observe** mode for a few days. Misogi logs what Jev *would* have done and never blocks.

Then read the feed:
- Were the red "would have blocked" cards right? If so, switch to **Protect**.
- Too many false alarms? Raise the **threshold** (0.80 instead of 0.70) or improve what Jev sees (section 5). The replay shows the effect before you apply it.

## 4. Pin the Jev version

Misogi uses `jev-latest` by default. Once you like the results, click **Pin** in the project settings: the current version (e.g. `jev-1.13.0`) is frozen. A new Jev release will not change your results overnight; you decide when to move on.

## 5. Help Jev judge well

Jev judges a short summary of the turn (the "state"). The clearer the summary, the more reliable Jev is.

- **Visible tests.** Misogi spots test commands (`npm test`, `pytest`, `vitest`, `cargo test`, `go test`…). Give your project one standard test command and write it in `CLAUDE.md` / `AGENTS.md`: "Run `npm test` before saying you are done."
- **Precise requests.** "Add the contact page and its tests" is easier to judge than "improve the site".
- **The right state level.**
  - *Reduced* (default): request, file names, test result, final message. The sweet spot.
  - *Full*: adds the test output. Useful when Jev lacks context.
  - *Minimal*: metadata only, for sensitive code ("client code" profile).
- **Secrets stay home.** Keys, tokens, `.env` values and e-mails are masked before sending, at every level. The state is capped at ~30,000 tokens; beyond that, Misogi trims the middle of overly long texts.

## 6. Protect without looping

In **Protect** mode, Jev can send the agent back to work. Three safety nets:

- **Max relaunches** (2 by default): after two relaunches in a row, Misogi lets it through and tells you. No infinite loop.
- **Let me decide**: when the window is open, you get a few seconds to click "Let it through" or "Relaunch now". No answer, the rule applies.
- **Instructions**: on a red card, "Let the next stop through" or "Relaunch at the next stop" apply to that session's next stop.

## 7. The shell guard

Turn on **Shell guard** in the project settings. Before each *risky* command (`rm -rf`, `git push --force`, `git reset --hard`, reading a `.env`, uploading data with `curl -d`…), Jev judges whether it is destructive, leaks secrets or touches secrets files. Ordinary commands (`ls`, `npm test`, `git status`) run with no call and no delay.

Start in **Observe**, then **Protect**: the dangerous command is refused and the agent looks for another way. It also works in Claude Code's auto and bypass modes, which is exactly where it matters most.

## 7b. Helpers around the turn

In **Project settings → Jev helpers**, four helpers are on by default (cost: about $0.0001 to $0.0005 each):

- **Read my request** (Claude Code): before the agent starts, Jev says whether your request is clear, what is missing otherwise, which model is enough and which skill or `CLAUDE.md` section applies. In Protect mode, these hints are given to the agent. Checks with nothing to report don't show in the feed.
- **Review the diff**: at the end of the turn, each claim of the agent is checked against the diff, off-topic and sensitive files are flagged, and the project's check command is suggested. In Protect mode, that command is what the agent is told to run when it must keep going. These findings never block on their own.
- **Spot an agent going in circles**: the window watches running sessions; when the same check fails again and again, Jev judges whether the agent is going in circles or making progress. If it is stuck: sound and notification.
- **Keep my instructions through compaction** (Claude Code): your lasting instructions are picked before compaction and given back word for word right after.

With the *client code* profile or the *minimal* level, none of your code or messages leave: only loop detection remains possible.

## 7c. Saving your plan: router, narrowed reads, search

- **Model router** (Project settings → Router, off by default): Claude Code goes through Misogi (`ANTHROPIC_BASE_URL` in `.claude/settings.local.json`). For each message, the request check gives the size of the work and Misogi picks Haiku, Sonnet or Opus; within a session the model never goes down. The app must stay open, and Claude sessions already open must be restarted. The Quotas panel shows each model's share.
- **Narrowed reads** (on by default, Claude Code, Kimi and Codex): for a 400-line to 80 KB file read in full, Jev picks the useful part; it only narrows when it is sure (measured: 0.96 to 0.98 when it knows) and leaves the file whole when two distant places match.
- **Search by meaning**: `misogi find "<what the code does>"` and `misogi ask "<yes/no question>" [folder]`, from the terminal or by the agent (`misogi-search` skill). Grep is still better when you know the exact name.

## 8. Headless (CI, `claude -p`)

Nobody can click: Misogi applies the rule immediately, never waits, and prints its reason on stderr. Detected through `CI`, `GITHUB_ACTIONS`, `GITLAB_CI`… or `MISOGI_HEADLESS=1`.

## 9. Remote sessions

SSH, dev container: run `misogi remote` for the steps. The remote hook sends its decisions to your window with a token; if the window is unreachable, it keeps its own log and still works.

## 10. Link tickets

Name your branch after the ticket (`feat/123-contact`, `ENG-42-login`) or mention it in the request (`#123`). Misogi fetches the ticket (GitHub through your `gh` login, GitLab and Linear with a token in Settings → Tickets) and Jev judges its **acceptance criteria**: write them as checkboxes or under an "Acceptance criteria" heading in the ticket.

## 11. Tune Jev on your data

Under each decision: "Was Jev right? Yes / No". After a dozen ratings, the project settings show its **reliability** (false alarms, missed problems). When you move the **threshold**, Misogi replays past decisions and tells you how many mistakes it would have fixed or introduced, before you apply it.

## Quick checklist

- [ ] Key added and **Test** is green
- [ ] A test command written in `CLAUDE.md` / `AGENTS.md`
- [ ] A few days in **Observe**, then **Protect**
- [ ] Jev version **pinned**
- [ ] **Shell guard** on
- [ ] **Client code** profile on NDA projects
