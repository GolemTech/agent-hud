# Code review rules

Rules for Gentleman Guardian Angel (gga) and any reviewer of this repository:
a Claude Code plugin ("mod") in TypeScript/TSX, hooks module `hooks/register.tsx`,
pure helpers in `hooks/gentle.ts`, `hooks/demo.ts`, `hooks/text.ts`. Fail the
review on any **MUST** rule; report the rest as suggestions.

## Mods API (MUST)

- Call `$` only at the call site (`$.process.run(...)`). Never pass `$`, or a
  method of it, as a value, and never to a function imported from another file:
  engine-calling helpers live in `register.tsx`; other modules stay pure.
- No identifier named `on` other than the `register` parameter (the loader
  refuses the module).
- Every `<Button>` has `onPress`; state changes go through `update($, atom, fn)`.
- Streaming events (`turn.step`) are `async function*` ending in
  `return yield* next(e)`. Observer hooks always forward `next(e)` unchanged
  and keep `.catch((_$, e, next) => next(e))`.
- Time comes from `$.clock.now()`, never `Date.now()`. Colors are theme keys
  (`claude`, `success`, `warning`, `error`, `subtle`), never raw colors.

## Security and privacy (MUST)

- No network calls (`$.http`, `fetch`). Commands run through `$.process.run`
  with a constant argv (no shell, no session data interpolated into a command
  string), an explicit `timeoutMs`, and a checked `exitCode`.
- Never run `gga` to detect state, and never execute or `source` a `.gga`
  file: parse configuration as text.
- Any command that changes state runs only after `$.ui.ask` returns exactly
  the confirm label; a dismissed dialog is a cancel. Never echo command output.
- Strings from outside the plugin (titles, branch names, descriptions, todo
  text, MCP names, file contents) pass through `clean()` before display.
- Identity fields (account, title, session id, branch, path) are masked only in
  `maskView`; demo mode uses fictional data and never touches `$.state`.
- No real names, emails, organizations or home paths anywhere, fixtures
  included: use `example.com`, `.test`, `/home/myuser`, `you@Acme`.
- No secrets, tokens or credentials in code, tests or docs.

## Tests (MUST)

- A behavior change comes with a test in `hooks/*.test.ts(x)` that fails
  without it. Pure helpers are unit-tested directly; wiring uses the
  `claude-code/testing` kit (`mock.clock` + `settle()`/`advance()`, never fixed
  microtask loops or sleeps).
- Every `$` call the code under test makes has a bottom answer in the test.

## Docs and style

- Behavior or data-source changes update `README.md`; anything the plugin
  reads, runs, keeps or shows also updates `SECURITY.md`; architecture or
  gotchas update `CLAUDE.md`.
- Comments explain why, briefly; match the surrounding density. Named
  constants over magic numbers. English for code, comments, UI text and docs.
- Conventional Commits; no AI attribution lines.
