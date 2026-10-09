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
    `outputStyle` setting is kept (read about every 30 seconds; a change in
    it shows a style switch, a switch back to the default included).
  - The `~/.claude` files move under `CLAUDE_CONFIG_DIR` when it is set.
  - For the Gentle AI section, in the session's repository root: `.gga` (only
    `RULES_FILE` is used), `openspec/config.yaml` (only `strict_tdd`), and the
    `pre-commit` and `commit-msg` hook files (only whether gga's block
    marker, or a legacy `gga run` / `ai-code-review run` line, is there); the global gga config `$XDG_CONFIG_HOME/gga/config` or
    `~/.config/gga/config` (only `RULES_FILE`); whether the rules file exists
    (`AGENTS.md` instead of a `RULES_FILE` that is not a plain relative file
    name, and the section says so);
    and the modification time of the gentle-ai brew tap's `.git/FETCH_HEAD`.
    The gga config files are shell files: they are parsed as plain text with
    a pattern and never executed or sourced.
- **Environment variables**: `HOME`, `CLAUDE_CONFIG_DIR` and `XDG_CONFIG_HOME`.
- **Commands**, each run with a constant argument list and no shell. Read-only
  ones, run by the poller:
  - `git branch --show-current` and `git diff --shortstat HEAD` (both in the
    session's repository root; only the added and removed line counts of the
    diff are kept), `date +%z`.
  - Gentle AI section, at session start, about every 5 minutes and on `↻`:
    `gentle-ai --version`; `gentle-ai review mode status --cwd <root> --json`
    (without `--cwd` outside a repository);
    `git rev-parse --git-common-dir` and
    `git config --file <common dir>/config --get core.hooksPath` (in the
    repository root);
    `brew list --versions --formula gentle-ai gga engram`,
    `brew outdated --json=v2 --formula gentle-ai gga engram` and
    `brew --repository gentleman-programming/tap`, all three with
    `HOMEBREW_NO_AUTO_UPDATE=1`, `HOMEBREW_NO_ANALYTICS=1` and
    `HOMEBREW_NO_ENV_HINTS=1`. Only versions, on/off values and the tap path
    are kept; stderr is ignored.
  - Every read-only command has a timeout (5 s; 15 s for brew). One that
    times out is killed and its value stays as last known (poller) or
    unknown (Gentle AI detection).

  gga is never run for detection: every gga command except `run` checks
  GitHub for updates, and `gga config` sources the project's `.gga`.

  Mutating ones, run only from a Gentle AI button and only after the person
  chooses **Run it** in a confirmation dialog (dismissing it is a cancel):
  - `gga install` and `gga init` (in the repository root, with
    `CURL_CMD=false` so gga's update check does not run; `init` gets `n` on
    standard input so it never overwrites an existing `.gga`, and is offered
    only when there is none).
  - `gentle-ai review mode enable|disable --scope clone --cwd <root> --json`
    and `gentle-ai review mode enable|disable --scope global --json`.
  - Each has a 30 s timeout. Nothing runs when the working directory cannot
    be read; a failure shows only "failed (exit N)" or "failed (could not
    run)".
- **Plugin API**: session id, model, working directory, repository root,
  usage and the Claude Code version (`$.session.version()`, shown in the
  footer); the tool list (MCP server names are derived from tool names); the
  subagent list; and the `agent.spawn`, `turn.step`, `prompt.compose` (only
  the output style's name) and `tool.call` (`TodoWrite`,
  `TaskCreate`, `TaskUpdate`) events, observed without changing them.

## What it keeps

- **Module memory**, lost on every plugin reload: subagent timings and token
  counts, model and effort per loop, the cached title, account, branch,
  working-tree change counts, output style name, home folder and UTC offset,
  the Gentle AI section's last detection, and the ids and texts the person
  cleared.
- **Per-session host state** (`$.state`): `rows` (subagent cards), `todos`,
  `collapsed` (section toggles) and `private` (privacy mode). Claude Code holds
  this state; the plugin writes no files of its own.

The account is reduced to `user@Organization`, or only the email's user part
when there is no organization; the email domain is never kept.

## What it shows

The sidebar's fixed header shows the project's folder name (the repository
root's, else the working directory's; `…` in privacy mode). The sidebar and the
band above the prompt show the session title or short id,
the account label, model and effort, output style, git branch with added and
removed line counts, a shortened working
directory, context and rate-limit meters, MCP server names, subagent cards
(description, type, model, elapsed time, tokens), the main loop's todos and
the Gentle AI section (tool versions and updates, gga hook and rules file
name, RDD mode, strict TDD setting).

Toasts are short fixed texts ("gga hook installed", "RDD on for this
project", "failed (exit N)", "demo mode"); command output is never shown.
The `[create rules]` and `[configure]` buttons put a fixed request in the
prompt box (`$.prompt.fill`, replacing the draft); they never send it. The
rules file name in that request comes from `.gga` only when it is a plain
relative file name, otherwise `AGENTS.md` is used.

C0 and C1 control characters (escape sequences, newlines, bells) are stripped
from every displayed string that comes from outside the plugin: session title,
account, output style, git branch, subagent description and type, todo text
and MCP server names.

## What it does not do

- No network calls by the plugin itself. brew runs with
  `HOMEBREW_NO_AUTO_UPDATE=1` and reads only its local tap metadata: in a
  check with no network interface (`unshare --user --net`), the three brew
  commands, `gentle-ai --version` and `gentle-ai review mode status` all
  completed with their normal output. A command the person confirms (`gga`,
  `gentle-ai review mode`) is that tool's own: gga runs with
  `CURL_CMD=false`, which disables its update check.
- No logging and no files written by the plugin. Files change only through
  the confirmed commands above.
- No prompt is sent on the person's behalf.

## Privacy mode (`/hud-private`)

Masks the account, session title, session id, git branch and working
directory. The output style, the working-tree line counts and the Gentle AI
section stay visible. It
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

Every action is pinned to a commit SHA, `actions/checkout` keeps no
credentials, and the workflow token is read-only. Known residual supply-chain
risk, accepted because these jobs hold no secrets and cannot write to the
repository: `pip install semgrep==1.180.0` pins semgrep but resolves its
dependencies without hashes, semgrep fetches the `p/` rulesets from its
registry at run time, and `npm install -g @anthropic-ai/claude-code@2.1.296`
installs outside a lockfile. gitleaks is downloaded with a checked SHA-256.
