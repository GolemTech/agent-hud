import { clean } from './text'

// Whether a newer Claude Code exists on the person's update channel. Pure:
// `register.tsx` fetches the registry and reads the settings files. The
// running process never changes version, so what the footer shows is the
// version this session runs on until it is restarted.

// One request answers both channels, and it needs no npm on the machine.
export const CLAUDE_UPDATE_URL = 'https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags'

// Checked at session start, then every hour of poller ticks (one a second).
export const CLAUDE_UPDATE_EVERY_TICKS = 3600

// `HttpInit` has no timeout, so the check races the fetch against this.
export const CLAUDE_UPDATE_TIMEOUT_MS = 10_000

// The footer's `[update]` runs this (constant argv, after a confirmation);
// a download and an install can take minutes.
export const CLAUDE_UPDATE_ARGV = ['claude', 'update'] as const
export const CLAUDE_UPDATE_RUN_TIMEOUT_MS = 300_000

export type UpdateChannel = 'latest' | 'stable'

export type DistTags = { latest?: string; stable?: string }

const RELEASE = /^\d+\.\d+\.\d+$/

// The `latest` and `stable` tags of the registry's dist-tags answer, each
// kept only when it is a plain x.y.z release; null when the text is not a
// JSON object (an error page, an empty body) or neither tag is usable, so an
// answer with nothing to compare reads as a failed check.
export const parseDistTags = (text: string): DistTags | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const tags = parsed as Record<string, unknown>
  const out: DistTags = {}
  for (const name of ['latest', 'stable'] as const) {
    const v = tags[name]
    if (typeof v === 'string' && RELEASE.test(v)) out[name] = v
  }
  return out.latest || out.stable ? out : null
}

// Claude Code's `autoUpdatesChannel` setting from settings files given in its
// precedence order (local project, project, user), read as `outputStyleFrom`
// reads `outputStyle`: the first file that sets a known channel wins; a
// missing, unparsable or unknown one is skipped. None means `latest`.
export const channelFrom = (...texts: readonly (string | null | undefined)[]): UpdateChannel => {
  for (const text of texts) {
    if (!text) continue
    try {
      const channel = (JSON.parse(text) as { autoUpdatesChannel?: unknown } | null)?.autoUpdatesChannel
      if (channel === 'latest' || channel === 'stable') return channel
    } catch {
      // not JSON: skip this file
    }
  }
  return 'latest'
}

// The numeric core of `2.1.296`, `v2.1.296 (Claude Code)` or
// `2.1.296-dev.<build>`; undefined when the text starts with anything else.
const core = (raw: string): [number, number, number] | undefined => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?!\d)/.exec(raw.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

// `candidate` (a plain x.y.z release) when it is strictly newer than the
// running version, compared on the running version's x.y.z as numbers; null
// when it is not newer or either side is unknown or unreadable.
// Only the running version's core x.y.z is compared: a prerelease or dev
// build of a release (`2.1.301-dev.<build>`) counts as that release, so it
// is current once the channel's tag is its core, not older than it.
export const newerVersion = (
  running: string | null | undefined,
  candidate: string | null | undefined,
): string | null => {
  if (!running || !candidate || !RELEASE.test(candidate)) return null
  const have = core(running)
  const next = core(candidate)
  if (!have || !next) return null
  for (let i = 0; i < 3; i++) {
    if (next[i]! !== have[i]!) return next[i]! > have[i]! ? candidate : null
  }
  return null
}

// ── `claude update` from the footer ─────────────────────────────────────

export const claudeUpdateQuestion = (running: string, latest: string): string =>
  `Update Claude Code ${running} → ${latest} (runs \`claude update\`)? This session keeps ${running} until you restart it.`

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const VERSION = String.raw`v?(\d+\.\d+\.\d+)`
// `updated … to [version] x.y.z` (not `updates to latest`), else
// `successfully updated … x.y.z`: the success wording is not captured, so
// it is matched loosely and its version taken.
const UPDATED_TO = new RegExp(String.raw`\bupdated\b.*?\bto\s+(?:version\s+)?${VERSION}`, 'i')
const SUCCESS = /successfully updated/i
const ANY_VERSION = /\d+\.\d+\.\d+/g
const UP_TO_DATE = new RegExp(String.raw`is up to date \(${VERSION}\)`, 'i')
const MULTIPLE = /multiple installations/i
const MULTIPLE_HINT = ' — multiple installations found, see claude doctor'
const FAILURE_LINE_MAX = 90

const lines = (output: string): string[] =>
  output
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map(l => clean(l).trim())
    .filter(Boolean)

type Outcome = { updated?: string; upToDate?: string; multiple: boolean }

const readOutcome = (output: string): Outcome => {
  const all = lines(output)
  let updated: string | undefined
  for (const line of all) {
    // the version it updated to, else the last one on a `successfully updated` line
    updated = UPDATED_TO.exec(line)?.[1] ?? (SUCCESS.test(line) ? line.match(ANY_VERSION)?.at(-1) : undefined)
    if (updated) break
  }
  const text = all.join('\n')
  const upToDate = UP_TO_DATE.exec(text)?.[1]
  return { ...(updated ? { updated } : {}), ...(upToDate ? { upToDate } : {}), multiple: MULTIPLE.test(text) }
}

// The version a restart would run when `claude update` left one newer than
// the session's on disk (it updated, or it found that one already there);
// null otherwise, a failure included.
export const claudeUpdateOnDisk = (exitCode: number, output: string, running: string): string | null => {
  if (exitCode !== 0) return null
  const o = readOutcome(output)
  if (o.updated) return o.updated
  return o.upToDate ? newerVersion(running, o.upToDate) : null
}

// The toast after the footer's `claude update` (its stdout and stderr). A
// non-zero exit is a failure whatever it printed; an up to date answer newer
// than the session's version means it is on disk already (another install
// or an earlier update), so a restart uses it; an exit 0 it cannot read
// claims nothing.
export const claudeUpdateToast = (exitCode: number, output: string, running: string): string => {
  if (exitCode !== 0) {
    const last = lines(output).at(-1)
    if (!last) return `failed (exit ${exitCode})`
    return `failed (${last.length > FAILURE_LINE_MAX ? `${last.slice(0, FAILURE_LINE_MAX - 1).trimEnd()}…` : last})`
  }
  const o = readOutcome(output)
  const hint = o.multiple ? MULTIPLE_HINT : ''
  if (o.updated) return `Claude Code updated to ${o.updated} — restart it (/exit, then claude --resume)${hint}`
  if (o.upToDate) {
    if (newerVersion(running, o.upToDate))
      return `Claude Code ${o.upToDate} is already installed — restart to use it (this session runs ${running})`
    return `claude update found nothing newer (${o.upToDate})${hint}`
  }
  return 'claude update finished — restart and check the version'
}
