# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Agent HUD is a Claude Code plugin ("mod"): a hooks module that draws a live sidebar (Session, Context, MCP, Subagents, Todo, Gentle AI) and a band above the prompt. User-facing behavior and data sources are documented in `README.md`; keep both in sync when behavior changes.

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

- **Poller drives redraws.** `session.start` registers `/hud`, opens the pane and starts `$.clock.every(1000, tick)`. Each tick refreshes slow caches on their own cadence (session title every 2 ticks, git branch and `git diff --shortstat HEAD` change counts 5, output style from settings 30, account 60, UTC offset 600), then writes the `rows` atom. Writing an atom redraws every render that read it, which is why both the Pane and the AbovePrompt band read `rows` first: that is their refresh signal.
- **State lives in two places.** `$.state` atoms (`rows`, `collapsed`, `todos`, `private`, declared in `types/index.d.ts` under `PluginState['agent-hud']`) survive reloads. Module-level variables (`seen` timing map, `loopModel`, the caches, the `cleared*` sets) reset on every reload; that is accepted.
- **Event-sourced data.** `agent.spawn` stamps a subagent's real start time and model; `turn.step` records model and effort per loop (`agentId`, or `'main'`) and, from its result's own usage, a subagent's context size (never `turn.complete`'s usage: it sums every request of the turn and runs into millions; the kit could not be made to answer `turn.step` in a test, so that path is covered by `ctxTokens` alone); `prompt.compose` records the output style's name (a pure observer, forwards `next(e)` untouched; its input names no loop and `PromptComposeInput` has no field that tells the main loop from a subagent, so only a named style updates it and a style-less compose, like a subagent's, is ignored; a change in the polled `outputStyle` setting resets it, which is how a switch back to the default shows); `tool.call` on `TodoWrite` / `TaskCreate` / `TaskUpdate` mirrors the main loop's todos (`!e.agentId`). `$.agent.list()` gives live status only, and finished agents drop out of it, so `mergeRows` keeps them as history until "clear done".
- **Two surfaces.** The `Pane` (id `hud`) and the `AbovePrompt` band. The band shows only when `isSidebarShown($.ui.panes())` is false; it asks the engine instead of tracking opens and closes (see gotchas).
- **Gentle AI section.** `hooks/gentle.ts` holds its pure parsers, the action table (`actionSpec`: confirmation text, constant argv, env, result toast) and types, unit-tested in `hooks/gentle.test.ts` with the section's wiring tests. Everything that calls `$` (`detectGentle`, `runAction`, `fillPrompt`, `refreshGentle`) lives in `register.tsx`. Detection runs at session start, every 300 ticks, on `↻` and after an action, not awaited by the tick; a periodic or `↻` run joins one under way unless it started `GENTLE_JOIN_DEADLINE_MS` ago (stuck), an action's run starts fresh, and a generation number drops an older run's result. Command buttons run with `ACTION_TIMEOUT_MS`; a failure (exit code, rejection, unreadable cwd) is a `failed (...)` toast. Each probe is guarded on its own and leaves its field unknown when it fails. Command buttons go through `$.ui.ask` ('Run it' / 'Cancel', a rejection is a cancel) before `$.process.run`; prompt buttons only `$.prompt.fill` (`replace`), never submit.
- **Responsive layout.** `hooks/layout.ts` holds the pure sizing helpers, unit-tested in `hooks/layout.test.ts` with renders of the Pane at several widths and heights. The Pane sizes itself with `layoutFor(e.props.bodyColumns, e.props.scroll?.bodyRows ?? e.viewport?.rows)`: drawable columns (body less `paddingX`), meter `barWidth`, the `compact` subagent tally and the tool-version `toolPad`. Rules: in a row of a label and what follows it, the label sits in a `flexShrink={0}` Box and the row has `flexWrap="wrap"`, so buttons and values go below instead of squeezing the label into one letter per line; anything else in such a row only holds truncating Text. The subagent card budget is `cardsFor(rows, usedRows)`, `usedRows` counted from the rows the other sections draw at this width (`flowRows` for wrap rows, `textRows` for wrapping text); keep that count in step with the tree when a section changes.
- **Demo mode.** `hooks/demo.ts` provides the sample session behind `/hud-demo`, used for README recordings; both surfaces render from one view object, live or demo, and demo data never reaches `$.state`.
- **Privacy mode.** `/hud-private` flips the `private` atom; `liveView` applies the pure `maskView` (identity fields only) when it is set, so both surfaces read masked data from one place. Demo mode wins over it.
- **Fragile inputs** are read from Claude Code internals with a fallback, never trusted: `~/.claude/projects/<projectDir(root)>/<sessionId>/custom-title.json` (session title), `~/.claude.json` `oauthAccount` (account; only email user and organization are kept, never the email domain), and the `outputStyle` setting from `<root>/.claude/settings.local.json` > `<root>/.claude/settings.json` > `~/.claude/settings.json` (`outputStyleFrom`). The `~/.claude` files move under `CLAUDE_CONFIG_DIR` when it is set (`claudePaths`). External strings pass through `clean` (`hooks/text.ts`, control characters stripped) where they enter.

## Mods API gotchas (all hit in practice)

- Every `<Button>` needs `onPress`; without it the render hook throws and the whole Pane draws blank. State changes from a button go through `update($, atom, fn)` inside `onPress`.
- Call `$` at the call site: `$.process.run(...)` works, passing `$.process.run` as a value is refused by `validate`.
- `$` is followed only into functions declared in the same file, never across an import: a helper in `gentle.ts` that takes `$` makes the whole module fail to load ("$ is passed to ..., imported from ..."). Keep `$`-calling code in `register.tsx` and only pure code in other modules.
- Never run gga for detection: every gga command except `run` checks GitHub for updates (curl; `CURL_CMD=false` turns it off), and `gga config` / `gga version` source the repository's `.gga`, which executes it. Read the hook files and `.gga` as text instead (`parseGgaConfig`).
- `brew outdated --json=v2` exits 1 when something is outdated: parse stdout, do not gate on `exitCode`. Run brew with `HOMEBREW_NO_AUTO_UPDATE=1` so it reads only the local tap.
- A plugin's own `$.ui.open` / `$.ui.close` is not seen by its own `ui.open` / `ui.close` hooks (origin `plugin`), and a state write from a closing pane's button can be lost when the pane unmounts. Derive visibility from `$.ui.panes()` instead of tracking it.
- "plugin panel hidden · ctrl+x ctrl+a or click to show" is the engine collapsing the AbovePrompt band, not a missing band. A plugin cannot expand it.
- Size the Pane from `e.props.bodyColumns` (the body's own cells) and `e.props.scroll.bodyRows`, not `e.viewport`: the viewport is the whole conversation's width and the surface's rows, and a height-only change of the viewport re-draws nothing. The Pane's props change on a resize, which re-runs `ui.render` (and the poller's `rows` write redraws every second anyway), so no refresh signal is needed. The test kit draws trees, not text: `pane.redraw(props)` re-renders at another size.
- `$.ui.open({ columns })` is a request: a dock width the person set wins, so a narrow "rail" is not reliable.
- `turn.step` is a streaming event: the hook must be `async function*` ending in `return yield* next(e)`, and must not await `$` before forwarding (it would delay every response).
- `$.process.run` resolves on any exit code (it rejects only when the command cannot start or outlasts `timeoutMs`, default 30 s): check `exitCode`, as the `git diff` refresh does for a repository with no `HEAD`. Every read-only run passes `CMD_TIMEOUT_MS` or `BREW_TIMEOUT_MS` (`gentle.ts`).
- Claude Code runs every git with `core.hooksPath` forced to `/dev/null` (also through `GIT_CONFIG_*`), so `git rev-parse --git-path hooks` answers `/dev/null`. Find a repo's hooks folder with `--git-common-dir` plus `git config --file <common>/config --get core.hooksPath` (`hooksDir` in `gentle.ts`).
- A lambda parameter named `on` inside `register` makes the hooks module fail to load (it shadows the `on` the loader follows); use another name.
- Gating hooks (`agent.spawn`, `tool.call`) are observers here: keep `.catch((_$, e, next) => next(e))` so a failure never blocks the call.
- Use `$.clock.now()`, not `Date.now()`, so the clock is mockable; and get the time zone from the host (`date +%z`), not from `Date`, whose zone may differ from the user's.
- Colors are theme keys (`claude`, `success`, `warning`, `error`, `subtle`), never raw colors, so the sidebar follows `/theme`.

## Tests (`claude-code/testing` kit)

- Prefer pure helpers tested directly; engine tests are for wiring. `hooks/band.test.ts` is the reference: it mounts the Pane, presses a button by `key`, and asserts the band's `drawn()` tree.
- The test's `on(...)` hooks are the engine's bottom. `$` calls are answered as `{ value }`, lifecycle events raw (`session.start` → `{ cwd }`), and `ui.render` must return a tree element, e.g. `h(Box, {})` from `$.ui.resolve(e)`.
- Anything the code under test calls needs a bottom answer, or the hook is skipped with "no implementation".
- A test cannot read another plugin's `$.state` (host rule); assert through rendered output instead. The test `$` has no `$.ui.close`; reach it by pressing the plugin's own button.
- An engine event a test raises from its own `$` (e.g. `$.prompt.compose(input)`) runs every plugin's hook; its bottom answers raw (`on('prompt.compose', () => ({ sections: [] }))`). `hooks/session.test.ts` does this.
- The test `$` has no `$.ui.ask`; the plugin's own call runs the `AskUserQuestion` tool, so a test answers it with `on('tool.call', { tool: 'AskUserQuestion' }, ...)` returning `{ result: { answers: { [question]: label } } }`, and throws to simulate a dismissed dialog. `prompt.fill` and `ui.toast` need bottom answers too. `hooks/gentle.test.ts` does this.
- `mock.clock(on)` controls `$.clock.now()` / `every`; advance it instead of sleeping.
- Fixtures use reserved names only (`example.com`, `.test`, `/home/myuser`): a local identity guard blocks commits with real-looking data.
