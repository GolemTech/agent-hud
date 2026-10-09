# Agent HUD

<a href="https://github.com/GolemTech/agent-hud/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-F095C8?style=for-the-badge&labelColor=1A1218" alt="License: MIT"></a>

A live sidebar for Claude Code. It docks beside the transcript and shows the
current session at a glance: who and where you are, how much context and
rate limit is left, which MCP servers are connected, what your subagents are
doing, and the main loop's todo list.

## What the sidebar shows

| Section   | Contents |
| --------- | -------- |
| Session   | Session title (or short id), signed-in account, model and effort, git branch, working directory shortened to fit. |
| Context   | Meters for the context window and each rate-limit window, with time to reset and the local reset time; a footer with total tokens and cost. |
| MCP       | MCP servers, connected first; servers waiting for authentication are dimmed. |
| Subagents | Running / done / error counts, then one card per subagent: description, type, model, elapsed time and context tokens. |
| Todo      | The main loop's task list: done first, then in progress, then pending. |

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
  It persists across plugin reloads until you run it again. Claude Code's own
  welcome header and status line are not affected: a plugin cannot draw them.

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
- **Account** (email user and organization) is read from the `oauthAccount`
  field of `~/.claude.json`; nothing else in that file is used.
- **Git branch** comes from `git branch --show-current`, refreshed about every
  5 seconds.
- **Reset times** use the system UTC offset from `date +%z`.
- **Dock width** cannot be forced by a plugin; a width you set wins.
- **No network calls** are made.

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

[![Built with Gentle-AI](https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png)](https://github.com/Gentleman-Programming/gentle-ai)

## License

[MIT](LICENSE) © GolemTech
