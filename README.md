# Agent HUD

<a href="https://github.com/GolemTech/agent-hud/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-F095C8?style=for-the-badge&labelColor=1A1218" alt="License: MIT"></a>

A live sidebar for Claude Code. It docks beside the transcript and shows the
current session at a glance: who and where you are, how much context and
rate limit is left, which MCP servers are connected, what your subagents are
doing, and the main loop's todo list.

## What the sidebar shows

| Section   | Contents |
| --------- | -------- |
| Session   | Session title (or short id), signed-in account, model and effort, output style (when not the default), git branch with working-tree changes (`+N` added, `-M` removed lines, shown only when there are any), working directory shortened to fit. |
| Context   | Meters for the context window and each rate-limit window, with time to reset and the local reset time; a footer with total tokens and cost. |
| MCP       | MCP servers, connected first; servers waiting for authentication are dimmed. |
| Subagents | Running / done / error counts, then one card per subagent: description, type, model, elapsed time and context tokens. |
| Todo      | The main loop's task list: done first, then in progress, then pending. |
| Gentle AI | The [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) toolset: `gentle-ai`, `gga` and `engram` versions with `✓ up to date` or `↑ <newer>` (as fresh as your local brew tap), the gga review hook and its rules file, receipt-driven development (RDD) on or off and where that comes from, and the TDD policy (test-first by default under ODD; strict TDD on, off or unset). Shows "gentle-ai not installed" when it is not. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install agent-hud --marketplace GolemTech/agent-hud
```

Answer `y` to add the marketplace, then choose a scope (user scope is first).
The sidebar becomes active in that session without a reload.

To add the marketplace first and install separately:

```
/plugin marketplace add GolemTech/agent-hud
/plugin install agent-hud@agent-hud
```

## Usage

- The sidebar opens on session start. `/hud` opens it again at any time.
- `→` (top right of the sidebar) hides it. A band above the prompt then shows
  a one-line summary (`▸ Agent HUD  55% · MCP 3/4 · 2 agents`); click it to
  reopen the sidebar.
- Claude Code can collapse that band itself, showing
  `plugin panel hidden · ctrl+x ctrl+a or click to show`. Click it or press
  `ctrl+x ctrl+a` to expand it.
- `▾` / `▸` on each section header collapses or expands that section.
- `✕ clear done` on Subagents and Todo removes finished entries.
- `/hud-demo` toggles a sample session (fixed data, progressing subagents
  and todos) for demos and screenshots. It spends no tokens and shows no
  personal data; run it again to return to the live session.
- `/hud-private` toggles privacy mode for screen sharing and streaming. The
  sidebar stays live (model, context, rate limits, cost, MCP, subagents,
  todos), but the account shows as `you@example`, the session title as
  `private session`, the session id is hidden, the branch shows as `••••` and
  the path as `~/…`; `🔒 private` next to the Session header shows it is on.
  It persists across plugin reloads until you run it again. MCP server names,
  subagent descriptions and todo text are **not** masked, and can contain
  project or client names. Claude Code's own welcome header and status line are
  not affected either: a plugin cannot draw them.
- Gentle AI section:
  - `↻` checks again now (otherwise at session start and about every 5
    minutes, and after each action).
  - Command buttons ask first: `[install]` (gga pre-commit hook, `gga install`),
    `[init]` (sample `.gga`, `gga init`, only when the project has none), and
    RDD `project [on] [off]` / `global [on] [off]`
    (`gentle-ai review mode enable|disable --scope clone|global`). Nothing runs
    unless you choose **Run it**; a short toast says how it went. Off always
    wins: a project "on" cannot override a global "off".
  - Prompt buttons only fill the prompt box, they never send it:
    `[create rules]` (asks Claude to write the gga rules file) and
    `[configure]` (asks Claude to set up strict TDD through the sdd-init flow).
    Review the text and press Enter yourself.
  - In demo mode the section shows sample values and its buttons do nothing.

## How it gets its data

Most values come from the plugin API (`$.session`, `$.agent`, `$.tool`). The
rest, and the limits that come with them:

- **Per-subagent tokens** come from `turn.complete`, so they appear when a
  subagent turn ends and show the context size of that turn.
- **Todos** mirror the main loop's `TodoWrite`, `TaskCreate` and `TaskUpdate`
  calls only, and only those made after the plugin loads. Subagents' own lists
  are ignored.
- **Session title** is read from Claude Code's internal file
  `~/.claude/projects/<project>/<session>/custom-title.json`. If that file
  moves or changes shape, the short session id is shown instead.
- **Account** is read from the `oauthAccount` field of `~/.claude.json` and
  shown as `user@Organization`, or only the email's user part when there is no
  organization; the email domain is never shown and nothing else in that file
  is used. When `CLAUDE_CONFIG_DIR` is set (a leading `~` is expanded), both
  files are read from that folder instead.
- **Git branch** comes from `git branch --show-current`, refreshed about every
  5 seconds.
- **Working-tree changes** come from `git diff --shortstat HEAD` on the same
  cadence: staged and unstaged lines added and removed against `HEAD`.
  Untracked files are not counted, and nothing shows in a repository with no
  commit yet.
- **Output style** is the one Claude Code composes each request's system
  prompt with, observed on `prompt.compose` without changing the prompt.
  Before the first request it is read from the `outputStyle` setting
  (`.claude/settings.local.json`, then `.claude/settings.json` in the
  repository root, then the user `settings.json`, which also follows
  `CLAUDE_CONFIG_DIR`), about every 30 seconds; nothing else in those files is
  used. The default style shows no line. Privacy mode leaves the style and the
  change counts visible: they are not identity.
- **Reset times** use the system UTC offset from `date +%z`.
- **Dock width** cannot be forced by a plugin; a width you set wins.
- **Gentle AI versions** come from `brew list --versions` and
  `gentle-ai --version`. **Update status** comes from
  `brew outdated --json=v2` run with `HOMEBREW_NO_AUTO_UPDATE=1`: it compares
  against your local tap metadata, so it is only as fresh as your last
  `brew update`; "updates as of" is when the tap was last fetched. Tools not
  installed through brew show no update status.
- **gga** is detected by reading files, never by running gga (its commands
  check GitHub for updates, and `gga config` executes the project's `.gga`):
  the hook from the `pre-commit` / `commit-msg` files in the repository's
  hooks folder (the `core.hooksPath` set in the repository's own config file,
  else `<git common dir>/hooks`; Claude Code runs git with `core.hooksPath`
  forced to `/dev/null`, so git cannot be asked for it), the configuration from the project `.gga`
  over `~/.config/gga/config` (`XDG_CONFIG_HOME` respected), parsed as plain
  text and never executed, and the rules file (`RULES_FILE`, default
  `AGENTS.md`) by checking that it exists.
- **RDD** comes from `gentle-ai review mode status --json` (read only).
- **TDD**: "test-first by default (ODD)": test-first is the default of
  gentle-ai's Organic Driven Development workflow; strict TDD is `strict_tdd` in
  the project's `openspec/config.yaml`, matched as text.
- **No network calls** are made by the plugin itself.
- **Control characters** (escape sequences, newlines, bells) are stripped from
  every displayed string that comes from outside the plugin.

## Security and privacy

What the plugin reads, keeps and shows, and how to report a vulnerability:
see [SECURITY.md](SECURITY.md).

## Development

```sh
claude --plugin-dir .          # run a session with the plugin loaded from this folder
claude plugin test .           # run hooks/*.test.ts against the engine
claude plugin validate .       # check manifest, marketplace and hooks module
npx -y -p typescript@5.6.3 tsc -p . --noEmit   # type-check
```

Type-checking needs `.claude-plugin/types/`, which Claude Code writes when a
session loads the plugin from this folder (`claude --plugin-dir .`). It is
git-ignored.

## Credits

[![Built with Gentle-AI](https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/f182ea2018a6399f5d1b6557cf36d71a3df0f723/docs/assets/brand/built-with-gentle-ai.png)](https://github.com/Gentleman-Programming/gentle-ai)

## License

[MIT](LICENSE) © GolemTech

Not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC.
