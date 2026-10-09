# Security

## Supported versions

Only the latest version on `main` is supported. Fixes are not backported.

## Reporting a vulnerability

Report privately through GitHub Security Advisories: open the repository's
**Security** tab and choose **Report a vulnerability**. Do not open a public
issue for a security problem.

## What the plugin reads

- **Files** (read only, through the plugin API's `$.fs.read`):
  - `~/.claude.json`: only `oauthAccount.emailAddress` and
    `oauthAccount.organizationName` are kept; the rest of the file is ignored.
  - `~/.claude/projects/<project>/<session>/custom-title.json`: only
    `customTitle` is kept.
  - `~/.claude/settings.json`, and `.claude/settings.json` and
    `.claude/settings.local.json` in the session's repository root: only the
    `outputStyle` setting is kept, and only until the first request reports
    the style.
  - The `~/.claude` files move under `CLAUDE_CONFIG_DIR` when it is set.
- **Environment variables**: `HOME` and `CLAUDE_CONFIG_DIR`.
- **Commands**: three, each run with a constant argument list and no shell:
  `git branch --show-current` and `git diff --shortstat HEAD` (both in the
  session's repository root; only the added and removed line counts of the
  diff are kept) and `date +%z`.
- **Plugin API**: session id, model, working directory, repository root and
  usage; the tool list (MCP server names are derived from tool names); the
  subagent list; and the `agent.spawn`, `turn.step`, `prompt.compose` (only
  the output style's name), `turn.complete` and `tool.call` (`TodoWrite`,
  `TaskCreate`, `TaskUpdate`) events, observed without changing them.

## What it keeps

- **Module memory**, lost on every plugin reload: subagent timings and token
  counts, model and effort per loop, the cached title, account, branch,
  working-tree change counts, output style name, home folder and UTC offset, and the ids and texts the person cleared.
- **Per-session host state** (`$.state`): `rows` (subagent cards), `todos`,
  `collapsed` (section toggles) and `private` (privacy mode). Claude Code holds
  this state; the plugin writes no files of its own.

The account is reduced to `user@Organization`, or only the email's user part
when there is no organization; the email domain is never kept.

## What it shows

The sidebar and the band above the prompt show the session title or short id,
the account label, model and effort, output style, git branch with added and
removed line counts, a shortened working
directory, context and rate-limit meters, MCP server names, subagent cards
(description, type, model, elapsed time, tokens) and the main loop's todos.

C0 and C1 control characters (escape sequences, newlines, bells) are stripped
from every displayed string that comes from outside the plugin: session title,
account, output style, git branch, subagent description and type, todo text
and MCP server names.

## What it does not do

- No network calls.
- No logging, no toasts, no files written.

## Privacy mode (`/hud-private`)

Masks the account, session title, session id, git branch and working
directory. The output style and the working-tree line counts stay visible. It
does **not** mask MCP server names, subagent descriptions or todo
text, which can contain project or client names, nor Claude Code's own welcome
header and status line, which a plugin cannot draw.

## Demo mode (`/hud-demo`)

Shows a fixed sample session built from fictional data only. It never reads or
writes `$.state` for its data.

## Automated checks

CI (`.github/workflows/ci.yml`) runs on pushes to `main` and on pull requests:

- `claude plugin test .` and `claude plugin validate .`
- gitleaks over the full git history
- semgrep over `hooks/` with `p/typescript`, `p/javascript`, `p/secrets`,
  `p/security-audit` and `p/owasp-top-ten`
