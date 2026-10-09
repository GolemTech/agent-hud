# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Agent HUD is a Claude Code plugin ("mod"): a hooks module that draws a live sidebar (Session, Context, MCP, Subagents, Todo) and a band above the prompt. User-facing behavior and data sources are documented in `README.md`; keep both in sync when behavior changes.

## Commands

```sh
claude --plugin-dir .                            # session with the plugin loaded from this folder (also writes .claude-plugin/types/)
claude plugin test .                             # runs every hooks/*.test.ts(x); there is no per-test or per-file filter
claude plugin validate .                         # manifest, marketplace and hooks module; lists hooks, $ calls, gating hooks
npx -y -p typescript@5.6.3 tsc -p . --noEmit     # type-check; needs .claude-plugin/types/ (git-ignored, written by a --plugin-dir load)
```

`validate` does not type-check: run `tsc` too, it catches errors `validate` passes. The only expected `validate` warning is that a root `CLAUDE.md` is not shipped as plugin context; that is intended (this file is for developers, not for users of the plugin).

CI (`.github/workflows/ci.yml`) runs `test`, `validate`, gitleaks and semgrep; `tsc` is not in CI because it needs the generated types, so run it locally.

API reference: `.claude-plugin/types/claude-code/index.d.ts` (~15k lines). Grep for the event or noun (`'turn.step'`, `PaneOpenArgs`, `ButtonProps`) and read the doc comment; it is the source of truth over memory.

## Architecture

Everything runs from `hooks/register.tsx`. The top of the file is pure, exported helpers (formatting, merging, ordering, parsing), unit-tested in `hooks/timing.test.ts`. `register` at the bottom wires the hooks.

- **Poller drives redraws.** `session.start` registers `/hud`, opens the pane and starts `$.clock.every(1000, tick)`. Each tick refreshes slow caches on their own cadence (session title every 2 ticks, git branch 5, account 60, UTC offset 600), then writes the `rows` atom. Writing an atom redraws every render that read it, which is why both the Pane and the AbovePrompt band read `rows` first: that is their refresh signal.
- **State lives in two places.** `$.state` atoms (`rows`, `collapsed`, `todos`, `private`, declared in `types/index.d.ts` under `PluginState['agent-hud']`) survive reloads. Module-level variables (`seen` timing map, `loopModel`, the caches, the `cleared*` sets) reset on every reload; that is accepted.
- **Event-sourced data.** `agent.spawn` stamps a subagent's real start time and model; `turn.step` records model and effort per loop (`agentId`, or `'main'`); `turn.complete` gives per-subagent tokens; `tool.call` on `TodoWrite` / `TaskCreate` / `TaskUpdate` mirrors the main loop's todos (`!e.agentId`). `$.agent.list()` gives live status only, and finished agents drop out of it, so `mergeRows` keeps them as history until "clear done".
- **Two surfaces.** The `Pane` (id `hud`) and the `AbovePrompt` band. The band shows only when `isSidebarShown($.ui.panes())` is false; it asks the engine instead of tracking opens and closes (see gotchas).
- **Demo mode.** `hooks/demo.ts` provides the sample session behind `/hud-demo`, used for README recordings; both surfaces render from one view object, live or demo, and demo data never reaches `$.state`.
- **Privacy mode.** `/hud-private` flips the `private` atom; `liveView` applies the pure `maskView` (identity fields only) when it is set, so both surfaces read masked data from one place. Demo mode wins over it.
- **Fragile inputs** are read from Claude Code internals with a fallback, never trusted: `~/.claude/projects/<projectDir(root)>/<sessionId>/custom-title.json` (session title) and `~/.claude.json` `oauthAccount` (account; only email user and organization are kept, never the email domain). Both move under `CLAUDE_CONFIG_DIR` when it is set (`claudePaths`). External strings pass through `clean` (control characters stripped) where they enter.

## Mods API gotchas (all hit in practice)

- Every `<Button>` needs `onPress`; without it the render hook throws and the whole Pane draws blank. State changes from a button go through `update($, atom, fn)` inside `onPress`.
- Call `$` at the call site: `$.process.run(...)` works, passing `$.process.run` as a value is refused by `validate`.
- A plugin's own `$.ui.open` / `$.ui.close` is not seen by its own `ui.open` / `ui.close` hooks (origin `plugin`), and a state write from a closing pane's button can be lost when the pane unmounts. Derive visibility from `$.ui.panes()` instead of tracking it.
- "plugin panel hidden · ctrl+x ctrl+a or click to show" is the engine collapsing the AbovePrompt band, not a missing band. A plugin cannot expand it.
- `$.ui.open({ columns })` is a request: a dock width the person set wins, so a narrow "rail" is not reliable.
- `turn.step` is a streaming event: the hook must be `async function*` ending in `return yield* next(e)`, and must not await `$` before forwarding (it would delay every response).
- Gating hooks (`agent.spawn`, `tool.call`) are observers here: keep `.catch((_$, e, next) => next(e))` so a failure never blocks the call.
- Use `$.clock.now()`, not `Date.now()`, so the clock is mockable; and get the time zone from the host (`date +%z`), not from `Date`, whose zone may differ from the user's.
- Colors are theme keys (`claude`, `success`, `warning`, `error`, `subtle`), never raw colors, so the sidebar follows `/theme`.

## Tests (`claude-code/testing` kit)

- Prefer pure helpers tested directly; engine tests are for wiring. `hooks/band.test.ts` is the reference: it mounts the Pane, presses a button by `key`, and asserts the band's `drawn()` tree.
- The test's `on(...)` hooks are the engine's bottom. `$` calls are answered as `{ value }`, lifecycle events raw (`session.start` → `{ cwd }`), and `ui.render` must return a tree element, e.g. `h(Box, {})` from `$.ui.resolve(e)`.
- Anything the code under test calls needs a bottom answer, or the hook is skipped with "no implementation".
- A test cannot read another plugin's `$.state` (host rule); assert through rendered output instead. The test `$` has no `$.ui.close`; reach it by pressing the plugin's own button.
- `mock.clock(on)` controls `$.clock.now()` / `every`; advance it instead of sleeping.
- Fixtures use reserved names only (`example.com`, `.test`, `/home/myuser`): a local identity guard blocks commits with real-looking data.
