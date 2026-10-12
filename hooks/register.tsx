import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, TodoItem, TodoStatus } from '../types'
import { demoSnapshot } from './demo'
import {
  ACTION_TIMEOUT_MS,
  actionSpec,
  BREW_ENV,
  GENTLE_JOIN_DEADLINE_MS,
  gentleGrid,
  ggaHookInstalled,
  hooksDir,
  parseBrewList,
  parseBrewOutdated,
  parseGgaConfig,
  parseRddStatus,
  parseStrictTdd,
  parseVersion,
  BREW_TIMEOUT_MS,
  CMD_TIMEOUT_MS,
  RUN_IT,
  CANCEL,
  rulesFileName,
  rulesFileOverridden,
  rulesPrompt,
  STRICT_TDD_PROMPT,
  TAP,
  TOOLS,
} from './gentle'
import type { GentleAction, GentleButton, GentleInfo, GentleRow, GentleView, RddStatus, StrictTdd } from './gentle'
import {
  BRANCH_ICON,
  buttonText,
  CARD_ROWS,
  centerBand,
  clampOffset,
  flowRows,
  gridFor,
  HEADING_INDENT,
  ITEM_INDENT,
  layoutFor,
  maxScrollOffset,
  PANE_PADDING_X,
  ruleWidth,
  sectionTitle,
  textRows,
  viewportRowsFor,
} from './layout'
import { DEFAULT_MCP_FILTER, filterServers, isMcpFilter, MCP_FILTERS, mcpBodyRows, mcpEmptyText, mcpHiddenText } from './mcp'
import type { McpFilter } from './mcp'
import {
  ALL_HIDDEN_TEXT,
  CHANGE_TEXT,
  checkText,
  CLOSE_TEXT,
  parseHidden,
  SECTION_IDS,
  sectionKey,
  SETTINGS_BUTTON,
  SETTINGS_BUTTON_CELLS,
  SETTINGS_CHANGE,
  SETTINGS_CLOSE,
  SETTINGS_KEY,
  SETTINGS_TITLE,
  settingsLabel,
  settingsRows,
  summaryParts,
  toggleHidden,
  visibleSections,
} from './settings'
import type { SectionId } from './settings'
import { clean } from './text'
import {
  DEFAULT_THEME,
  isThemeName,
  parseThemeArg,
  PICKER_CANCEL,
  PICKER_FOCUS_RETRY_MS,
  pickerOrder,
  pickerRows,
  shownTheme,
  THEME_NAMES,
  themeFromKey,
  themeKey,
  themeList,
  THEMES,
  wrapFocus,
} from './themes'
import type { Palette, Role, ThemeName } from './themes'
import { isSupportedVersion, unsupportedMessage } from './version'

// Re-exported for the unit tests, which import the helpers from here.
export { clean }

const PANE = 'hud'

// ── Todos ────────────────────────────────────────────────────────────────
// No `$` accessor holds the task list, so the pane mirrors it from the
// main loop's own TodoWrite / TaskCreate / TaskUpdate calls.

// TodoWrite always sends the whole list: it replaces ours.
export const fromTodoWrite = (
  todos: readonly { content: string; status: TodoStatus; activeForm?: string }[],
): TodoItem[] =>
  todos.map((t, i) => ({
    id: `w${i}`,
    content: clean(t.content),
    activeForm: t.activeForm === undefined ? undefined : clean(t.activeForm),
    status: t.status,
  }))

export const addTask = (
  list: readonly TodoItem[],
  id: string,
  subject: string,
  activeForm?: string,
): TodoItem[] => [
  ...list.filter(t => t.id !== id),
  { id, content: clean(subject), activeForm: activeForm === undefined ? undefined : clean(activeForm), status: 'pending' },
]

export const updateTask = (
  list: readonly TodoItem[],
  change: {
    taskId: string
    status?: TodoStatus | 'deleted'
    subject?: string
    activeForm?: string
  },
): TodoItem[] => {
  // A const keeps the 'deleted' narrowing inside the map callback below.
  const { status } = change
  if (status === 'deleted') return list.filter(t => t.id !== change.taskId)
  return list.map(t =>
    t.id !== change.taskId
      ? t
      : {
          ...t,
          status: status ?? t.status,
          content: change.subject === undefined ? t.content : clean(change.subject),
          activeForm: change.activeForm === undefined ? t.activeForm : clean(change.activeForm),
        },
  )
}

// Display order: done first, then what is being worked on, pending last.
// Stable within each group, so the list keeps its authored order.
const TODO_RANK: Record<TodoStatus, number> = { completed: 0, in_progress: 1, pending: 2 }
export const orderTodos = (list: readonly TodoItem[]): TodoItem[] =>
  list
    .map((t, i) => ({ t, i }))
    .sort((a, b) => TODO_RANK[a.t.status] - TODO_RANK[b.t.status] || a.i - b.i)
    .map(({ t }) => t)

// ── Models ───────────────────────────────────────────────────────────────
// Model and effort per loop, keyed by agentId ('main' for the session's own
// loop). turn.step reports both on every request; agent.spawn seeds a
// subagent's model before its first request.
const MAIN = 'main'
const loopModel = new Map<string, { model: string; effort?: string | number }>()

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

// claude-opus-5-5 → Opus 5.5; claude-3-5-sonnet-20241022 → Sonnet 3.5;
// strips provider prefixes, dates, version and [1m]-style suffixes. Anything
// unrecognized comes back as given.
export const prettyModel = (raw: string): string => {
  const id = raw
    .replace(/\[.*\]$/, '')
    .replace(/^.*anthropic\./, '')
    .replace(/-v\d+(:\d+)?$/, '')
    .replace(/@?-?\d{8}$/, '')
  const current = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?$/.exec(id)
  if (current?.[1] && current[2]) {
    return `${cap(current[1])} ${current[2]}${current[3] ? `.${current[3]}` : ''}`
  }
  const legacy = /^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)$/.exec(id)
  if (legacy?.[1] && legacy[3]) {
    return `${cap(legacy[3])} ${legacy[1]}${legacy[2] ? `.${legacy[2]}` : ''}`
  }
  if (/^[a-z]+$/.test(id)) return cap(id)
  return raw
}

// Branch is the one session fact with no `$` accessor, so the poller caches it
// from `git` on a slow cadence instead of spawning a process every render.
let gitBranchCache: string | null = null

// Lines added / removed in the working tree against HEAD (staged and
// unstaged), from `git diff --shortstat HEAD` on the branch's cadence; null
// when clean, outside a repository or with no HEAD yet. Untracked files are
// not counted by `git diff`.
let gitChangesCache: Changes | null = null
// The repository root the branch poll last saw; null outside a repository.
let repoRootCache: string | null = null

export type Changes = { added: number; removed: number }

// ` 3 files changed, 42 insertions(+), 7 deletions(-)` → { added: 42, removed: 7 }.
// Either count may be missing (singular or plural); null when neither is there.
export const parseShortstat = (stdout: string): Changes | null => {
  const added = /(\d+) insertions?\(\+\)/.exec(stdout)?.[1]
  const removed = /(\d+) deletions?\(-\)/.exec(stdout)?.[1]
  if (added === undefined && removed === undefined) return null
  return { added: Number(added ?? 0), removed: Number(removed ?? 0) }
}

// The active output style's name (`Gentleman`), null for the default style.
// `prompt.compose` reports the one each request is composed with; until the
// first one, the settings files stand in. `undefined` means not reported yet.
let composedStyle: string | null | undefined
let settingsStyle: string | null = null
// The settings poll's previous answer; `undefined` before the first poll.
let polledSettingsStyle: string | null | undefined

const styleName = (raw: string): string | null => {
  const name = clean(raw).trim()
  return name && name.toLowerCase() !== 'default' ? name : null
}

// The `outputStyle` setting from settings files given in Claude Code's
// precedence order (local project, project, user). The first file that sets
// a string wins; a missing, unparsable or non-string one is skipped. Nothing
// else in the files is kept.
export const outputStyleFrom = (...texts: readonly (string | null | undefined)[]): string | null => {
  for (const text of texts) {
    if (!text) continue
    try {
      const style = (JSON.parse(text) as { outputStyle?: unknown }).outputStyle
      if (typeof style === 'string' && style.trim()) return styleName(style)
    } catch {
      // not JSON: skip this file
    }
  }
  return null
}

// The /rename title has no `$` accessor and no event either; Claude Code keeps
// it in `~/.claude/projects/<project>/<sessionId>/custom-title.json`, so the
// poller reads that file. An internal file: if its place or shape changes,
// the pane falls back to the session id.
let sessionTitle: string | null = null

// The signed-in account as the status line shows it: you@Acme, or only the
// email's user part (you) when there is no organization; the email domain is
// never shown. No `$` accessor carries it, so the poller reads `~/.claude.json`
// and keeps only these two fields; null when there is no OAuth account.
let accountCache: string | null = null

// Where Claude Code keeps its own files. `CLAUDE_CONFIG_DIR` moves both, so a
// session on another profile never shows this machine's default account. A
// leading `~/` (or a bare `~`) in it means `home`, as a shell would expand it.
export const claudePaths = (
  home: string,
  configDir: string | undefined,
): { config: string; projects: string; settings: string } => {
  const expanded = configDir === '~' || configDir?.startsWith('~/') ? `${home}${configDir.slice(1)}` : configDir
  const dir = expanded ? expanded.replace(/\/+$/, '') : null
  return dir
    ? { config: `${dir}/.claude.json`, projects: `${dir}/projects`, settings: `${dir}/settings.json` }
    : { config: `${home}/.claude.json`, projects: `${home}/.claude/projects`, settings: `${home}/.claude/settings.json` }
}

export const accountLabel = (text: string): string | null => {
  try {
    const account = (JSON.parse(text) as {
      oauthAccount?: { emailAddress?: unknown; organizationName?: unknown }
    }).oauthAccount
    const email = typeof account?.emailAddress === 'string' ? clean(account.emailAddress) : null
    if (!email) return null
    const [user = ''] = email.split('@')
    const org = typeof account?.organizationName === 'string' ? clean(account.organizationName).trim() : ''
    return org ? `${user}@${org}` : user || null
  } catch {
    return null
  }
}

// ── Path ─────────────────────────────────────────────────────────────────
let homeCache: string | null = null

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Cut a name to `n` columns with a trailing `..`: session-explorer → session-..
const cutName = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, Math.max(1, n - 2))}..`

// A path that fits `max` columns while keeping its depth visible:
//   myuser/.claude/dev-mods/0a1b2c3d…/session-explorer
//   myuser/../../../session-explorer
//   myuser/../../../session-..
// Home becomes its folder name (myuser), UUID segments their first 8 chars.
// The first and last segments always show; middle segments collapse to `..`
// from the left until it fits, then the last segment is cut. Split as
// parent + leaf so the leaf can stand out.
export const shortPath = (
  path: string,
  home: string | null,
  max: number,
): { parent: string; leaf: string } => {
  let segs: string[]
  if (home && (path === home || path.startsWith(`${home}/`))) {
    const user = home.split('/').filter(Boolean).pop() ?? '~'
    segs = [user, ...path.slice(home.length).split('/').filter(Boolean)]
  } else {
    segs = path.split('/').filter(Boolean)
    if (path.startsWith('/')) segs[0] = `/${segs[0] ?? ''}`
  }
  segs = segs.map(s => (UUID.test(s) ? `${s.slice(0, 8)}…` : s))

  const leaf = segs.at(-1) ?? '/'
  if (segs.length <= 1) return { parent: '', leaf: cutName(leaf, max) }

  const first = segs[0] ?? ''
  const mids = segs.slice(1, -1)
  const parentOf = (m: readonly string[]) => `${[first, ...m].join('/')}/`
  const fits = (parent: string) => parent.length + leaf.length <= max

  if (fits(parentOf(mids))) return { parent: parentOf(mids), leaf }
  const collapsed = [...mids]
  for (let i = 0; i < collapsed.length; i++) {
    collapsed[i] = '..'
    if (fits(parentOf(collapsed))) return { parent: parentOf(collapsed), leaf }
  }
  const parent = parentOf(collapsed)
  if (max - parent.length >= 4) return { parent, leaf: cutName(leaf, max - parent.length) }
  return { parent: '', leaf: cutName(leaf, max) }
}

// The project's name for the sticky header: a path's last segment.
export const projectName = (path: string): string => path.split('/').filter(Boolean).pop() ?? '/'

// Claude Code's project folder name: the root path, non-alphanumerics as `-`.
export const projectDir = (root: string): string => root.replace(/[^a-zA-Z0-9]/g, '-')

export const parseTitle = (text: string): string | null => {
  try {
    const title = (JSON.parse(text) as { customTitle?: unknown }).customTitle
    const shown = typeof title === 'string' ? clean(title).trim() : ''
    return shown || null
  } catch {
    return null
  }
}
const rows = atom({ plugin: 'agent-hud', key: 'rows' } as const, [])
const collapsed = atom({ plugin: 'agent-hud', key: 'collapsed' } as const, {
  session: false,
  context: false,
  mcp: false,
  subagents: false,
  todos: false,
  gentle: false,
})

// The sidebar counts as shown only while its pane is open and drawn.
export const isSidebarShown = (panes: readonly { id: string; isPlaced: boolean }[]): boolean =>
  panes.some(p => p.id === PANE && p.isPlaced)
const todos = atom({ plugin: 'agent-hud', key: 'todos' } as const, [])
// `/hud-private`: in `$.state`, so a plugin reload never unmasks.
const privateMode = atom({ plugin: 'agent-hud', key: 'private' } as const, false)
// The Pane's own scroll offset under the sticky header (`ui.scroll` moves it).
const scrollOffset = atom({ plugin: 'agent-hud', key: 'scroll' } as const, 0)
// `/hud-theme`: the active theme's name, kept in `$.store` under THEME_KEY
// and loaded at session start; both surfaces read it to color their roles.
const themeName = atom({ plugin: 'agent-hud', key: 'theme' } as const, DEFAULT_THEME as string)
const THEME_KEY = 'theme'
// The MCP section's `active` / `all` filter, kept in `$.store` under
// MCP_FILTER_KEY and loaded at session start; `all` until one is chosen.
const mcpFilter = atom({ plugin: 'agent-hud', key: 'mcpFilter' } as const, DEFAULT_MCP_FILTER as McpFilter)
const MCP_FILTER_KEY = 'mcpFilter'
// `/hud-theme` with no name: the picker is drawn above the Pane's sections
// (never with the settings block), and the theme its focus ring rests on
// (`ui.focus`) is drawn until a press or Cancel.
const pickerOpen = atom({ plugin: 'agent-hud', key: 'picker' } as const, false)
const previewName = atom({ plugin: 'agent-hud', key: 'preview' } as const, null as string | null)
// `⋮` in the header: the settings block is open at the top of the Pane. Not
// kept in `$.store`; `session.start` closes it.
const settingsOpen = atom({ plugin: 'agent-hud', key: 'settingsOpen' } as const, false)
// Sections hidden from the Pane and the band, kept in `$.store` under
// HIDDEN_KEY and loaded at session start; none until one is chosen. A view
// choice: hidden sections are still polled.
const hiddenSections = atom({ plugin: 'agent-hud', key: 'hiddenSections' } as const, [] as SectionId[])
const HIDDEN_KEY = 'hiddenSections'
// The last offset the latest sticky render allowed; null while the Pane is
// drawn in the plain flow (inline, or no body height), where the engine scrolls.
let scrollMax: number | null = null

// Module-scoped timing. AgentInfo carries no timestamp, so we stamp each
// agent when we first see it and freeze it once its status is terminal.
// Lost on reload, which is acceptable for a live view.
const seen: Timing = new Map()

const TERMINAL = new Set(['completed', 'failed', 'killed'])

const icon = (status: string): string => {
  switch (status) {
    case 'running':
      return '●'
    case 'completed':
      return '✓'
    case 'failed':
      return '✗'
    case 'killed':
      return '⊘'
    case 'pending':
      return '○'
    default:
      return '…' // waiting | idle
  }
}

// The theme role a subagent's status icon is drawn in (`themes.ts`).
const color = (status: string): Role => {
  switch (status) {
    case 'running':
      return 'accent'
    case 'completed':
      return 'success'
    case 'failed':
      return 'error'
    case 'killed':
      return 'warning'
    default:
      return 'subtle' // pending | waiting | idle
  }
}

// Elapsed as a clock: mm:ss, or h:mm:ss past an hour.
export const fmt = (ms: number): string => {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return h > 0 ? `${h}:${mmss}` : mmss
}

// Compact token count: 950, 12.2k, 1.4M.
export const fmtTokens = (n: number): string => {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

// A turn's context size, as the status line counts it: uncached, cache-read
// and cache-written input together.
export const ctxTokens = (usage: {
  input_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}): number =>
  usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)

type TimingRec = { start: number; end?: number; tokens?: number }
type Timing = Map<string, TimingRec>
type AgentLike = { id: string; type: string; description: string; status: string }

// Pure timing core: stamp `start` the first time an agent is seen, freeze
// `end` once its status is terminal, and derive elapsed from those. Takes
// `timing` and `now` as inputs so it is fully deterministic to test.
export const buildRows = (
  list: readonly AgentLike[],
  timing: Timing,
  now: number,
): AgentRow[] =>
  list.map(a => {
    let rec = timing.get(a.id)
    if (!rec) {
      rec = { start: now }
      timing.set(a.id, rec)
    }
    const done = TERMINAL.has(a.status)
    if (done && rec.end === undefined) rec.end = now
    return {
      id: a.id,
      type: clean(a.type),
      description: clean(a.description),
      status: a.status,
      elapsedMs: (rec.end ?? now) - rec.start,
      done,
      tokens: rec.tokens,
    }
  })

// ── History & clearing ───────────────────────────────────────────────────
// The engine drops a finished subagent from `$.agent.list()` after a few
// seconds; the pane keeps it as history until "clear done". A vanished agent
// last seen unfinished is taken as completed, its elapsed time frozen.
export const mergeRows = (prev: readonly AgentRow[], current: readonly AgentRow[]): AgentRow[] => {
  const byId = new Map(current.map(r => [r.id, r]))
  const known = new Set(prev.map(r => r.id))
  const kept = prev.map(p => byId.get(p.id) ?? (p.done ? p : { ...p, status: 'completed', done: true }))
  return [...kept, ...current.filter(r => !known.has(r.id))]
}

// Display order: running first, then finished, most recent first.
export const displayRows = (list: readonly AgentRow[]): AgentRow[] => [
  ...list.filter(r => !r.done),
  ...list.filter(r => r.done).reverse(),
]

// Ids / contents the person cleared, so they do not come back: a cleared
// subagent may still be listed for a few seconds, and TodoWrite resends the
// whole list, completed items included.
const clearedAgents = new Set<string>()
const clearedTodos = new Set<string>()

const withoutCleared = (list: readonly TodoItem[]): TodoItem[] =>
  list.filter(t => !(t.status === 'completed' && clearedTodos.has(t.content)))

// ── Context meters ───────────────────────────────────────────────────────
// The status line's figures from `$.session.usage()`: the session's context
// window plus the account's rate-limit windows (5h, 7d). Each is optional
// before the first response: a missing rate limit is dropped, a context
// window with no reading yet shows at 0%.

type UsageLike = {
  context?: { tokens?: number; percent?: number; window?: number }
  rateLimits?: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
}

export type Meter = { label: string; percent: number; note: string }

const WINDOW_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }
const WINDOW_ORDER = ['five_hour', 'seven_day', 'spend_limit']

// Time left as 45m, 2h40m or 5d6h.
export const untilLabel = (ms: number): string => {
  const mins = Math.max(0, Math.round(ms / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h${String(mins % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

// The system's UTC offset in minutes, from `date +%z` (-0500 → -300). The
// mod's own environment may not share the person's time zone, so the poller
// asks the host instead of trusting Date's local time.
export const parseOffset = (text: string): number | null => {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(text.trim())
  if (!m?.[1] || !m[2] || !m[3]) return null
  const minutes = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -minutes : minutes
}

let utcOffsetMin: number | null = null

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad2 = (n: number) => String(n).padStart(2, '0')

// Local wall-clock time of `at`: 14:10, or Wed 12:30 when it falls on
// another day than `now`.
export const localClock = (at: number, offsetMin: number, now: number): string => {
  const shift = offsetMin * 60_000
  const d = new Date(at + shift)
  const today = new Date(now + shift)
  const hhmm = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  const sameDay =
    d.getUTCFullYear() === today.getUTCFullYear() &&
    d.getUTCMonth() === today.getUTCMonth() &&
    d.getUTCDate() === today.getUTCDate()
  return sameDay ? hhmm : `${DAYS[d.getUTCDay()]} ${hhmm}`
}

// Resets show as a countdown plus, when the system offset is known, the
// local reset time in parentheses: ↻ 2h40m (14:10).
export const meters = (usage: UsageLike, now: number, offsetMin?: number | null): Meter[] => {
  const out: Meter[] = []
  const ctx = usage.context
  // A fresh session (after /clear, before the first response) has a window
  // but no reading yet: show it at 0%.
  const percent = ctx?.percent ?? (ctx?.window ? 0 : undefined)
  if (percent !== undefined) {
    out.push({ label: 'ctx', percent, note: ctx?.window ? ` · ${fmtTokens(ctx.window)}` : '' })
  }
  const rank = (kind: string) => {
    const i = WINDOW_ORDER.indexOf(kind)
    return i === -1 ? WINDOW_ORDER.length : i
  }
  for (const r of [...(usage.rateLimits ?? [])].sort((a, b) => rank(a.kind) - rank(b.kind))) {
    const reset = r.resetsAt ? Date.parse(r.resetsAt) : Number.NaN
    out.push({
      label: WINDOW_LABEL[r.kind] ?? r.kind,
      percent: r.percentUsed,
      note:
        Number.isFinite(reset) && reset > now
          ? ` ↻ ${untilLabel(reset - now)}${
              offsetMin == null ? '' : ` (${localClock(reset, offsetMin, now)})`
            }`
          : '',
    })
  }
  return out
}

// Filled / empty cells of a fixed-width meter, drawn as a ━ track: thin
// strokes do not bleed into the rows above and below the way █ does, and
// whole cells leave no partial-glyph gap. Any use shows at least one cell,
// and only a full window fills the track.
export const barCells = (percent: number, width = 10): [number, number] => {
  const p = Math.max(0, Math.min(100, percent))
  let filled = Math.round((p / 100) * width)
  if (p > 0) filled = Math.max(1, filled)
  if (p < 100) filled = Math.min(width - 1, filled)
  return [filled, width - filled]
}

// The theme role a meter's bar is drawn in.
export const meterColor = (percent: number): Role =>
  percent < 60 ? 'success' : percent < 85 ? 'warning' : 'error'

// 261,474 tokens · $16.13 spent
export const contextFooter = (usage: UsageLike): string => {
  const parts: string[] = []
  const tokens = usage.context?.tokens ?? (usage.context?.window ? 0 : undefined)
  if (tokens !== undefined) parts.push(`${tokens.toLocaleString('en-US')} tokens`)
  const usd = usage.cost?.usd
  if (usd !== undefined) parts.push(`$${usd.toFixed(2)} spent`)
  return parts.join(' · ')
}

// Cleans a sanitized MCP server id for display: drops a plugin's `plugin_`
// prefix, collapses an exact `name_name` duplicate (a plugin whose server
// repeats its own key), restores the `claude_ai_` vendor prefix as `claude.ai`,
// and turns the remaining sanitizing underscores back into spaces.
const prettyServer = (raw: string): string =>
  raw
    .replace(/^plugin_/, '')
    .replace(/^(.+)_\1$/, '$1')
    .replace(/^claude_ai_/, 'claude.ai ')
    .replace(/_/g, ' ')

export type McpServerInfo = { name: string; connected: boolean }

// A server pending OAuth exposes only these handshake tools; a connected one
// exposes at least one real tool.
const AUTH_TOOLS = new Set(['authenticate', 'complete_authentication'])

// Active MCP servers, derived from the connected tools: MCP tools are named
// `mcp__<server>__<tool>`, so the distinct <server> segment is the server set
// (only genuine MCP tools, `t.mcp`). There is no `$.mcp.list`; this is the
// honest runtime source. `connected` is true when the server exposes any
// non-auth tool; a server that only offers the auth handshake is pending.
// Prettified names are merged so two configs of one server show once.
export const mcpServers = (
  tools: readonly { name: string; mcp: boolean }[],
): McpServerInfo[] => {
  const connectedBy = new Map<string, boolean>()
  for (const t of tools) {
    if (!t.mcp) continue
    const [, server, tool] = /^mcp__(.+?)__(.+)$/.exec(t.name) ?? []
    if (!server || !tool) continue
    const name = prettyServer(clean(server))
    const isReal = !AUTH_TOOLS.has(tool)
    connectedBy.set(name, (connectedBy.get(name) ?? false) || isReal)
  }
  return [...connectedBy.entries()]
    .map(([name, connected]) => ({ name, connected }))
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name))
}

export type AgentCounts = { run: number; done: number; err: number; total: number }

// Status tallies for the Subagents header row.
export const agentCounts = (list: readonly { status: string }[]): AgentCounts => {
  let run = 0
  let done = 0
  let err = 0
  for (const r of list) {
    if (r.status === 'completed') done += 1
    else if (r.status === 'failed' || r.status === 'killed') err += 1
    else run += 1 // running | pending | waiting | idle
  }
  return { run, done, err, total: list.length }
}

// One-line digest shown in the collapsed-sidebar band above the prompt; the
// parts of hidden sections are left out, and '' when all three are.
export const summaryLine = (
  percent: number | undefined,
  connected: number,
  total: number,
  agents: number,
  hidden: readonly SectionId[] = [],
): string => summaryParts(percent, connected, total, agents, hidden).join(' · ')

// ── View ─────────────────────────────────────────────────────────────────
// Everything the Pane and the band display, assembled from the live sources
// or, in demo mode, from the fixed sample session in `demo.ts`. One view keeps
// a single JSX tree for both.

type ModelInfo = { model: string; effort?: string | number }

export type HudView = {
  demo: boolean
  /** Identity fields are masked (`/hud-private`). */
  private: boolean
  title: string | null
  sessionId: string
  account: string | null
  mainModel: ModelInfo
  branch: string | null
  /** Working-tree lines added / removed against HEAD; null when clean. */
  changes: Changes | null
  /** Active output style's name; null for the default style or unknown. */
  outputStyle: string | null
  cwd: string
  home: string | null
  /** The sticky header's project name; the cwd's last segment when absent. */
  project?: string
  contextPercent: number | undefined
  meters: Meter[]
  footer: string
  servers: McpServerInfo[]
  agents: AgentRow[]
  models: ReadonlyMap<string, ModelInfo>
  todos: TodoItem[]
  /** The Gentle AI section; null (or absent) until the first detection finished. */
  gentle?: GentleView | null
}

// The Claude Code version for the footer, read once per session start.
let versionCache: string | null = null
// Set at session start when Claude Code is older than MIN_CLAUDE_CODE_VERSION
// (`version.ts`): both surfaces then draw only this notice. An unknown
// version leaves it null, so the HUD runs normally.
let unsupportedNotice: string | null = null

// ── Gentle AI ────────────────────────────────────────────────────────────
// The section's pure parsers and constants live in `gentle.ts`; everything
// that calls `$` is here, since the hooks loader never follows `$` across an
// import. Detection is several process runs, brew among them, so it runs at
// session start, then every ~300 ticks, and on ↻ or after an action, never on
// every render. gga itself is never run for detection.
let gentleCache: GentleInfo | null = null
let gentleRun: Promise<void> | null = null
// When the detection under way started (`$.clock.now()`).
let gentleRunStartedAt = 0
// Numbers each detection as it starts; only the newest may write the cache.
let gentleGeneration = 0

// A file's text, or null when it is missing or unreadable.
const readOr = async ($: EngineInterface, path: string): Promise<string | null> => {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

// Every probe is guarded on its own: one failing leaves its field unknown.
const detectGentle = async ($: EngineInterface): Promise<GentleInfo> => {
  const versions: Record<string, string> = {}
  let updates: Record<string, string> | null = null
  let updatesAsOf: number | null = null
  let root: string | null = null

  try {
    root = (await $.session.repo())?.root ?? null
  } catch {
    root = null
  }
  try {
    const r = await $.process.run(['brew', 'list', '--versions', '--formula', ...TOOLS], {
      env: BREW_ENV,
      timeoutMs: BREW_TIMEOUT_MS,
    })
    Object.assign(versions, parseBrewList(r.stdout))
  } catch {
    // no brew: versions come from gentle-ai itself below
  }
  try {
    const r = await $.process.run(['gentle-ai', '--version'], { timeoutMs: CMD_TIMEOUT_MS })
    const v = r.exitCode === 0 ? parseVersion(r.stdout) : null
    if (v) versions['gentle-ai'] = v
  } catch {
    // not installed
  }
  try {
    // Exits 1 when something is outdated: the JSON on stdout is what counts.
    const r = await $.process.run(['brew', 'outdated', '--json=v2', '--formula', ...TOOLS], {
      env: BREW_ENV,
      timeoutMs: BREW_TIMEOUT_MS,
    })
    updates = parseBrewOutdated(r.stdout)
  } catch {
    updates = null
  }
  if (updates) {
    try {
      const r = await $.process.run(['brew', '--repository', TAP], { env: BREW_ENV, timeoutMs: BREW_TIMEOUT_MS })
      const tap = clean(r.stdout).trim()
      if (r.exitCode === 0 && tap.startsWith('/')) updatesAsOf = (await $.fs.stat(`${tap}/.git/FETCH_HEAD`)).mtimeMs
    } catch {
      updatesAsOf = null
    }
  }

  const gga: GentleInfo['gga'] = { hook: null, projectConfig: false, rulesFile: 'AGENTS.md', rules: null }
  let rdd: RddStatus | null = null
  let strictTdd: StrictTdd | null = null

  // Global gga config, overridden by the project's `.gga`; both read as text.
  let config: Record<string, string> = {}
  try {
    const xdg = await $.env.get('XDG_CONFIG_HOME')
    const home = await $.env.get('HOME')
    const dir = xdg ? xdg : typeof home === 'string' ? `${home}/.config` : null
    const text = dir ? await readOr($, `${dir}/gga/config`) : null
    if (text) config = parseGgaConfig(text)
  } catch {
    // no global config
  }

  if (root) {
    const project = await readOr($, `${root}/.gga`)
    gga.projectConfig = project !== null
    if (project) config = { ...config, ...parseGgaConfig(project) }
    gga.rulesFile = rulesFileName(config.RULES_FILE)
    gga.rulesOverridden = rulesFileOverridden(config.RULES_FILE)
    try {
      gga.rules = await $.fs.exists(`${root}/${gga.rulesFile}`)
    } catch {
      gga.rules = null
    }
    try {
      // Not `--git-path hooks`: the engine forces core.hooksPath=/dev/null on
      // every git it runs, so ask for the common dir and read the repo's own
      // config file for a core.hooksPath (exit 1 when it sets none).
      const common = await $.process.run(['git', 'rev-parse', '--git-common-dir'], { cwd: root, timeoutMs: CMD_TIMEOUT_MS })
      const commonDir = clean(common.stdout).trim()
      if (common.exitCode === 0 && commonDir) {
        const configFile = `${commonDir.startsWith('/') ? commonDir : `${root}/${commonDir}`}/config`
        const set = await $.process.run(['git', 'config', '--file', configFile, '--get', 'core.hooksPath'], {
          cwd: root,
          timeoutMs: CMD_TIMEOUT_MS,
        })
        const hooks = hooksDir(root, commonDir, set.exitCode === 0 ? clean(set.stdout) : '', homeCache)
        const files = [await readOr($, `${hooks}/pre-commit`), await readOr($, `${hooks}/commit-msg`)]
        gga.hook = files.some(t => t !== null && ggaHookInstalled(t))
      }
    } catch {
      gga.hook = null
    }
    strictTdd = parseStrictTdd((await readOr($, `${root}/openspec/config.yaml`)) ?? '')
  }
  try {
    const argv = root
      ? ['gentle-ai', 'review', 'mode', 'status', '--cwd', root, '--json']
      : ['gentle-ai', 'review', 'mode', 'status', '--json']
    const r = await $.process.run(argv, { timeoutMs: CMD_TIMEOUT_MS })
    rdd = r.exitCode === 0 ? parseRddStatus(r.stdout) : null
  } catch {
    rdd = null
  }

  return {
    tools: TOOLS.map(name => ({
      name,
      version: versions[name] ?? null,
      update: updates?.[name] ?? null,
    })),
    updatesKnown: updates !== null,
    updatesAsOf,
    root,
    gga,
    rdd,
    strictTdd,
  }
}

// Asks first; runs only on the exact "Run it". A dismissed dialog (or a `-p`
// run, where `ask` rejects) is a cancel. Never echoes the command's output.
// Outside a repository (`root` null) it runs in the session's real cwd, read
// now: the drawn cwd may be the privacy mask (`~/…`), never a usable path;
// when it cannot be read, nothing runs.
const runAction = async ($: EngineInterface, action: GentleAction, root: string | null): Promise<boolean> => {
  let cwd: string
  try {
    cwd = root ?? (await $.session.cwd())
  } catch {
    $.ui.toast('failed (could not run)')
    return false
  }
  const spec = actionSpec(action, cwd)
  let answer: string
  try {
    answer = await $.ui.ask(spec.question, { header: 'Gentle AI', options: [RUN_IT, CANCEL] })
  } catch {
    return false
  }
  if (answer !== RUN_IT) return false
  try {
    const r = await $.process.run(spec.argv, {
      cwd,
      timeoutMs: ACTION_TIMEOUT_MS,
      ...(spec.env ? { env: spec.env } : {}),
      ...(spec.stdin === undefined ? {} : { stdin: spec.stdin }),
    })
    $.ui.toast(r.exitCode === 0 ? spec.done : `failed (exit ${r.exitCode})`)
  } catch {
    $.ui.toast('failed (could not run)')
  }
  return true
}

// Puts the text in the prompt box for the person to review and send.
const fillPrompt = async ($: EngineInterface, text: string): Promise<void> => {
  try {
    const r = await $.prompt.fill({ text, mode: 'replace' })
    if (!r.isFilled) $.ui.toast('close the open dialog, then try again')
  } catch {
    $.ui.toast('could not fill the prompt')
  }
}

// A periodic or ↻ refresh joins a detection already under way, unless that
// one started `GENTLE_JOIN_DEADLINE_MS` ago or more (it is stuck). After an
// action, `fresh` starts a new one at once: what an older run read may predate
// the action. Either way an older run's result is dropped when it ends later.
const refreshGentle = async ($: EngineInterface, fresh = false): Promise<void> => {
  let now: number
  try {
    now = await $.clock.now()
  } catch {
    now = gentleRunStartedAt // no clock: join as before
  }
  if (gentleRun && !fresh && now - gentleRunStartedAt < GENTLE_JOIN_DEADLINE_MS) return gentleRun
  const generation = ++gentleGeneration
  gentleRunStartedAt = now
  const run = (async () => {
    try {
      const info = await detectGentle($)
      if (generation === gentleGeneration) gentleCache = info
    } catch {
      // keep the last known detection
    } finally {
      if (generation === gentleGeneration) gentleRun = null
    }
  })()
  gentleRun = run
  return run
}

export const gentleView = (info: GentleInfo, now: number, offsetMin: number | null): GentleView => {
  const { updatesAsOf, ...rest } = info
  return {
    ...rest,
    asOf: updatesAsOf === null || offsetMin === null ? null : localClock(updatesAsOf, offsetMin, now),
  }
}

// The release (`2.1.296`, `2.1.296-dev`) over a development build's long
// version string; the full version when it is not spelled as a release.
export const versionLabel = (v: { version: string; base?: string }): string =>
  clean(v.base ?? v.version)

// When `/hud-demo` switched demo mode on (`$.clock.now()`), or null.
// Module-level: a reload leaves demo mode, which is fine for a recording aid.
let demoStartedAt: number | null = null

const demoView = (elapsedMs: number): HudView => {
  const d = demoSnapshot(elapsedMs)
  return {
    demo: true,
    private: false,
    title: d.session.title,
    sessionId: d.session.id,
    account: d.session.account,
    mainModel: d.session.model,
    branch: d.session.branch,
    changes: d.session.changes,
    outputStyle: d.session.outputStyle,
    cwd: d.session.cwd,
    home: d.session.home,
    project: projectName(d.session.cwd),
    contextPercent: d.contextPercent,
    meters: d.meters,
    footer: d.footer,
    servers: d.servers,
    agents: d.agents,
    models: new Map(d.agents.map(a => [a.id, { model: a.model, effort: a.effort }])),
    todos: d.todos,
    gentle: d.gentle,
  }
}

// Privacy mode for screen sharing: the same live view with every identity
// field replaced by a placeholder. No real path segment survives (`~/…`, no
// home), and the empty session id hides the short id. Everything else stays.
export const maskView = (view: HudView): HudView => ({
  ...view,
  private: true,
  account: 'you@example',
  title: 'private session',
  sessionId: '',
  branch: '••••',
  cwd: '~/…',
  home: null,
  project: '…',
})

// The live view: the real session's sources. `list` is the `rows` atom the
// caller read first (its refresh signal). Masking happens here and only here,
// so the Pane and the band can never show an unmasked identity field.
const liveView = async ($: EngineInterface, list: AgentRow[]): Promise<HudView> => {
  const [usage, tools, now, session, model, cwd, todoList, masked] = await Promise.all([
    $.session.usage(),
    $.tool.list(),
    $.clock.now(),
    $.session.id(),
    $.session.model(),
    $.session.cwd(),
    read($, todos),
    read($, privateMode),
  ])
  const view: HudView = {
    demo: false,
    private: false,
    title: sessionTitle,
    sessionId: session,
    account: accountCache,
    // Until the next request reports it, the effort is unknown.
    mainModel: loopModel.get(MAIN) ?? { model },
    branch: gitBranchCache,
    changes: gitChangesCache,
    outputStyle: composedStyle === undefined ? settingsStyle : composedStyle,
    cwd,
    home: homeCache,
    project: projectName(repoRootCache ?? clean(cwd)),
    contextPercent: usage.context?.percent,
    meters: meters(usage, now, utcOffsetMin),
    footer: contextFooter(usage),
    servers: mcpServers(tools),
    agents: list,
    models: loopModel,
    todos: todoList,
    gentle: gentleCache && gentleView(gentleCache, now, utcOffsetMin),
  }
  return masked ? maskView(view) : view
}

// Demo view while `/hud-demo` is on, the live one otherwise.
const hudView = async ($: EngineInterface, list: AgentRow[]): Promise<HudView> =>
  demoStartedAt === null ? liveView($, list) : demoView((await $.clock.now()) - demoStartedAt)

// The palette both surfaces draw with: the picker's preview, else the saved
// theme. `hasKeys` false (the Pane lost the keys, e.g. to Escape, which
// raises no event a hook sees) drops the preview from the drawing.
const activePalette = async ($: EngineInterface, hasKeys = true) => {
  const [saved, preview] = await Promise.all([read($, themeName), read($, previewName)])
  return shownTheme(saved, hasKeys ? preview : null)
}

// The root Box's fill: the theme's background, or no prop at all, so a theme
// without one (default) draws exactly as before, on the terminal's own.
const fill = (t: Palette): { backgroundColor?: string } => (t.background ? { backgroundColor: t.background } : {})

// The sidebar header's ⋮ Button is its only Button: the element drawn right
// before the picker, so the carousel's ring order starts there.
const PICKER_ORDER = pickerOrder(SETTINGS_KEY)
// The picker element the ring last rested on (`ui.focus`), for the carousel.
// Module-level: a reload forgets it, and the next move is then a plain one.
let pickerLastFocus: string | null = null

// Sets the MCP filter at once and keeps it for later sessions; a failed save
// still applies it to this session.
const setMcpFilter = async ($: EngineInterface, mode: McpFilter): Promise<void> => {
  await update($, mcpFilter, () => mode)
  try {
    await $.store.set(MCP_FILTER_KEY, mode)
  } catch {
    // this session keeps it
  }
}

// Leaves the picker: no preview, the sections back.
const closePicker = async ($: EngineInterface): Promise<void> => {
  pickerLastFocus = null
  await update($, previewName, () => null)
  await update($, pickerOpen, () => false)
}

// Opens the HUD's own Pane asking for the keys: the same id and title, so
// no second pane (a dock tab that would hide the sidebar). No `closeOnEscape`:
// Escape only returns the keys and the HUD stays.
const openForPicker = async ($: EngineInterface): Promise<void> => {
  await $.ui.open({ id: PANE, title: 'Agent HUD', focus: true })
}

// Asks for the keys again once `/hud-theme` returned, unless the picker was
// already answered.
const refocusPicker = async ($: EngineInterface): Promise<void> => {
  try {
    if (await read($, pickerOpen)) await openForPicker($)
  } catch {
    // the person can still take the keys with ctrl+x tab or a click
  }
}

// Opens the picker above the sections: no settings block (the two are never
// drawn together), no preview, the scroll at the top so the block is in
// view, and the HUD's own Pane asked for the keys now and again once the
// command returned. `/hud-theme` and the block's `[change]` both start here.
const startPicker = async ($: EngineInterface): Promise<void> => {
  await update($, settingsOpen, () => false)
  await update($, previewName, () => null)
  await update($, scrollOffset, () => 0)
  pickerLastFocus = null
  await update($, pickerOpen, () => true)
  try {
    await openForPicker($)
  } catch {
    // refused now: the retry below asks again
  }
  $.clock.after(PICKER_FOCUS_RETRY_MS, () => void refocusPicker($))
}

// `⋮`: closes the settings block, or opens it with the scroll at the top
// (drawn above the sections, it is otherwise out of view when scrolled),
// first closing the picker without saving.
const toggleSettings = async ($: EngineInterface): Promise<void> => {
  if (await read($, settingsOpen)) {
    await update($, settingsOpen, () => false)
    return
  }
  if (await read($, pickerOpen)) await closePicker($)
  await update($, scrollOffset, () => 0)
  await update($, settingsOpen, () => true)
}

// A section check: hides or shows one section at once and keeps the choice
// for later sessions; a failed save still applies it to this session. Never
// touches `collapsed`, so a section shown again comes back as it was.
const toggleSection = async ($: EngineInterface, id: SectionId): Promise<void> => {
  const next = await update($, hiddenSections, prev => toggleHidden(parseHidden(prev), id))
  try {
    await $.store.set(HIDDEN_KEY, next)
  } catch {
    // this session keeps it
  }
}

// Ends the picker: saves `name`, or with null keeps the saved theme. The
// Pane stays open.
const finishPicker = async ($: EngineInterface, name: ThemeName | null): Promise<void> => {
  if (name) await saveTheme($, name)
  else await closePicker($)
}

// Applies a theme at once and keeps it for later sessions. False when the
// save failed; the theme still applies to this session.
const saveTheme = async ($: EngineInterface, name: ThemeName): Promise<boolean> => {
  await update($, themeName, () => name)
  await closePicker($)
  try {
    await $.store.set(THEME_KEY, name)
    return true
  } catch {
    return false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    let supported: boolean | undefined
    try {
      const v = await $.session.version()
      versionCache = versionLabel(v)
      supported = isSupportedVersion(v.base ?? v.version)
    } catch {
      versionCache = null // the footer is left out; an unknown version runs
    }
    // Too old a Claude Code: say so, keep `/hud` to show the notice, and start
    // nothing else (no poller, no detection, no other command).
    unsupportedNotice = supported === false ? unsupportedMessage(versionCache ?? '?') : null
    if (unsupportedNotice !== null) {
      try {
        await $.ui.toast(unsupportedNotice)
        await $.command.register({ name: 'hud', description: 'Open the Agent HUD sidebar' })
        void $.ui.open({ id: PANE, title: 'Agent HUD' })
      } catch {
        // the notice is best effort; the session goes on regardless
      }
      return next(e)
    }
    // A new session starts at the top of the sidebar.
    try {
      await update($, scrollOffset, () => 0)
    } catch {
      // keep the last offset; the render clamps it anyway
    }
    // The theme chosen in an earlier session; a missing or unknown one is
    // `default`. A store that cannot be read keeps the current theme.
    try {
      const stored = await $.store.get(THEME_KEY)
      await update($, themeName, () => (isThemeName(stored) ? stored : DEFAULT_THEME))
    } catch {
      // keep the theme this session already has
    }
    // The MCP filter chosen in an earlier session; missing or unknown is `all`.
    try {
      const stored = await $.store.get(MCP_FILTER_KEY)
      await update($, mcpFilter, () => (isMcpFilter(stored) ? stored : DEFAULT_MCP_FILTER))
    } catch {
      // keep the filter this session already has
    }
    // The sections hidden in an earlier session; missing or invalid is none.
    try {
      const stored = await $.store.get(HIDDEN_KEY)
      await update($, hiddenSections, () => parseHidden(stored))
    } catch {
      // keep the sections this session already hides
    }
    // A new session starts with no picker and no preview.
    try {
      await closePicker($)
    } catch {
      // the next press or Cancel clears them
    }
    // ... and with the settings block closed.
    try {
      await update($, settingsOpen, () => false)
    } catch {
      // the next ⋮ or [close] closes it
    }
    await $.command.register({
      name: 'hud-theme',
      description: 'Pick the Agent HUD color theme; without a name, list the themes',
      argumentHint: '[name]',
    })
    await $.command.register({
      name: 'hud',
      description: 'Open the Agent HUD sidebar',
    })
    await $.command.register({
      name: 'hud-demo',
      description: 'Toggle a sample session in Agent HUD for demos and screenshots',
    })
    await $.command.register({
      name: 'hud-private',
      description: 'Toggle privacy mode: live data with account, title, branch and path masked',
    })

    void $.ui.open({ id: PANE, title: 'Agent HUD' })

    let ticks = 0
    const tick = async (): Promise<void> => {
      ticks += 1
      // Poll the /rename title every ~2s (a tiny file read; no rename event).
      if (ticks % 2 === 1) {
        try {
          const home = await $.env.get('HOME')
          const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
          const [id, root] = await Promise.all([$.session.id(), $.session.root()])
          if (typeof home === 'string') {
            homeCache = home
            const { projects } = claudePaths(home, configDir ?? undefined)
            const path = `${projects}/${projectDir(root)}/${id}/custom-title.json`
            sessionTitle = parseTitle(await $.fs.read(path))
          }
        } catch {
          sessionTitle = null // no file yet (never renamed) or unreadable
        }
      }
      // Signed-in account: now, then every ~60s (a /login switch shows up).
      if (ticks % 60 === 1) {
        try {
          const home = await $.env.get('HOME')
          const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
          if (typeof home === 'string') {
            const { config } = claudePaths(home, configDir ?? undefined)
            accountCache = accountLabel(await $.fs.read(config))
          }
        } catch {
          // keep the last known account
        }
      }
      // Output style from the settings files: now, then every ~30s. Each
      // file is optional. It stands in until `prompt.compose` reports a
      // style, and a change in it (the person switched styles) wins over the
      // last composed one: that is how a switch back to the default shows,
      // since a compose with no style cannot be told from a subagent's.
      if (ticks % 30 === 1) {
        try {
          const home = await $.env.get('HOME')
          const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
          const root = await $.session.root()
          const user = typeof home === 'string' ? claudePaths(home, configDir ?? undefined).settings : null
          const style = outputStyleFrom(
            await readOr($, `${root}/.claude/settings.local.json`),
            await readOr($, `${root}/.claude/settings.json`),
            user === null ? null : await readOr($, user),
          )
          if (polledSettingsStyle !== undefined && style !== polledSettingsStyle) composedStyle = undefined
          polledSettingsStyle = style
          settingsStyle = style
        } catch {
          // keep the last known style
        }
      }
      // System UTC offset for reset times: now, then every ~10 min (DST).
      if (ticks % 600 === 1) {
        try {
          const { stdout } = await $.process.run(['date', '+%z'], { timeoutMs: CMD_TIMEOUT_MS })
          utcOffsetMin = parseOffset(stdout) ?? utcOffsetMin
        } catch {
          // keep the last known offset; without one, only the countdown shows
        }
      }
      // Refresh the cached branch every ~5s (git spawns a process). Each
      // source is guarded on its own: one failing never stops the others, and
      // a command that cannot start or times out keeps its last known value.
      if (ticks % 5 === 1) {
        try {
          const repo = await $.session.repo()
          repoRootCache = repo ? clean(repo.root) : null
          if (!repo) {
            gitBranchCache = null
            gitChangesCache = null
          } else {
            try {
              const { stdout } = await $.process.run(['git', 'branch', '--show-current'], {
                cwd: repo.root,
                timeoutMs: CMD_TIMEOUT_MS,
              })
              gitBranchCache = clean(stdout).trim() || null
            } catch {
              // keep the last known branch
            }
            // Guarded on its own: no HEAD yet (an empty repository) exits
            // non-zero, which must not touch the branch.
            try {
              const { stdout, exitCode } = await $.process.run(['git', 'diff', '--shortstat', 'HEAD'], {
                cwd: repo.root,
                timeoutMs: CMD_TIMEOUT_MS,
              })
              gitChangesCache = exitCode === 0 ? parseShortstat(stdout) : null
            } catch {
              // keep the last known counts
            }
          }
        } catch {
          // keep the last known branch
        }
      }
      // Gentle AI detection: now, then every ~5 min. Not awaited: it takes a
      // second or more, and the rows write below must not wait for it.
      if (ticks % 300 === 1) void refreshGentle($)
      try {
        const built = buildRows(await $.agent.list(), seen, await $.clock.now())
        await update($, rows, prev => mergeRows(prev, built).filter(r => !clearedAgents.has(r.id)))
      } catch {
        // keep the last known rows; the next tick tries again
      }
    }

    void tick()
    $.clock.every(1000, () => void tick())

    return next(e)
  })

  // Real start time: agent.spawn fires at dispatch and resolves once the
  // subagent has started, carrying its agentId. We stamp the accurate start
  // here; the poller still freezes `end` when the status turns terminal.
  on('agent.spawn', async ($, e, next) => {
    const start = await $.clock.now()
    const res = await next(e)
    if (!res.deny && res.agentId) {
      const rec = seen.get(res.agentId)
      if (rec) rec.start = start
      else seen.set(res.agentId, { start })
      // Resolved model until its first turn.step adds the effort.
      if (!loopModel.has(res.agentId)) loopModel.set(res.agentId, { model: res.model })
    }
    return res
  }).catch((_$, e, next) => next(e)) // observer: never block a spawn

  // Model + effort of every request, per loop, and a subagent's context size.
  // A pass-through: it notes fields and forwards the stream untouched, reading
  // the request's own usage only from the result, once the stream has ended.
  // That usage is one request's, so it is the context the request read; a
  // turn's usage (turn.complete) sums every request and runs into millions.
  // Bookkeeping is guarded on both sides of the forward: a failure in it is
  // dropped (the line just misses a value) and never changes or fails the
  // request's result, which is always returned.
  on('turn.step', async function* ($, e, next) {
    try {
      loopModel.set(e.agentId ?? MAIN, { model: e.model, effort: e.effort })
    } catch {
      // keep forwarding
    }
    const r = yield* next(e)
    try {
      if (e.agentId && r.usage) {
        const tokens = ctxTokens(r.usage)
        const rec = seen.get(e.agentId)
        if (rec) rec.tokens = tokens
        else seen.set(e.agentId, { start: await $.clock.now(), tokens })
      }
    } catch {
      // the result below stays untouched
    }
    return r
  })

  // Output style of each system prompt the engine renders. A pure observer:
  // it notes one field and forwards the composition untouched. The input
  // names no loop and a subagent's request carries no style, so only a named
  // style updates the line; a style-less compose leaves it (the settings poll
  // catches a switch back to the default).
  on('prompt.compose', (_$, e, next) => {
    if (e.outputStyle) composedStyle = styleName(e.outputStyle.name)
    return next(e)
  }).catch((_$, e, next) => next(e))

  // Todos: mirror the main loop's task tools once each call succeeded.
  // A subagent's own list (e.agentId set) would overwrite the session's.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const res = await next(e)
    if (!e.agentId && !res.deny && !res.isError) {
      await update($, todos, () => withoutCleared(fromTodoWrite(e.todos)))
    }
    return res
  }).catch((_$, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const res = await next(e)
    if (!e.agentId && !res.deny && !res.isError && res.result) {
      const { id } = res.result.task
      await update($, todos, list => addTask(list, id, e.subject, e.activeForm))
    }
    return res
  }).catch((_$, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const res = await next(e)
    if (!e.agentId && !res.deny && !res.isError && res.result?.success) {
      await update($, todos, list => updateTask(list, e))
    }
    return res
  }).catch((_$, e, next) => next(e))

  on('command.run', { command: 'hud' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agent HUD' })
    return { text: 'Agent HUD opened.' }
  })

  // Demo mode: the Pane and the band show the sample session from `demo.ts`
  // instead of live data. Nothing is written to `$.state`; the poller keeps
  // tracking the real session, and its `rows` write each tick redraws the
  // demo frames as they progress.
  on('command.run', { command: 'hud-demo' }, async $ => {
    if (demoStartedAt !== null) {
      demoStartedAt = null
      return { text: 'Demo mode off.' }
    }
    demoStartedAt = await $.clock.now()
    await $.ui.open({ id: PANE, title: 'Agent HUD' })
    return { text: 'Demo mode on: sample data only, no tokens spent. Run /hud-demo again to exit.' }
  })

  // Privacy mode: live data, identity fields masked by `maskView` in
  // `liveView`. Written to `$.state` so a reload keeps it on; writing the atom
  // redraws both surfaces.
  on('command.run', { command: 'hud-private' }, async $ => {
    const enabled = await update($, privateMode, masked => !masked)
    return {
      text: enabled
        ? 'Privacy mode on: account, session title and id, branch and path are masked. Run /hud-private again to exit.'
        : 'Privacy mode off.',
    }
  })

  // Theme: the atom write redraws both surfaces at once; `$.store` keeps the
  // choice for later sessions. A failed save still applies it to this one.
  on('command.run', { command: 'hud-theme' }, async ($, e) => {
    const arg = parseThemeArg(e.args ?? '')
    const current = await read($, themeName)
    const active = isThemeName(current) ? current : DEFAULT_THEME
    if (arg.kind === 'list') {
      // The picker opens inside the HUD's own Pane, above its sections, so
      // the sidebar is seen recoloring. An open answering the person's command
      // is placed at any width, but its `focus` is refused while this command
      // runs: the keys are asked for again once it returned. The text list
      // stays for a session that places no panes.
      try {
        await startPicker($)
      } catch {
        // the list below still answers
      }
      return {
        text:
          `Agent HUD themes:\n${themeList(active)}\n` +
          'Pick one at the top of the Agent HUD sidebar (moving previews it), or run /hud-theme <name>.',
      }
    }
    if (arg.kind === 'unknown') {
      return { text: `Unknown HUD theme "${clean(arg.input)}". Available themes:\n${themeList(active)}` }
    }
    if (!(await saveTheme($, arg.name))) {
      return { text: `HUD theme set to ${arg.name} for this session; it could not be saved for the next one.` }
    }
    return { text: `HUD theme set to ${arg.name}.` }
  })

  // Picker preview: the focus ring resting on a theme Button draws that theme;
  // anywhere else, the saved one. An observer: the move is forwarded untouched,
  // and a failure here never keeps the ring from moving.
  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    let target = e.element
    try {
      const [open, current] = await Promise.all([read($, pickerOpen), read($, previewName)])
      const ours = e.plugin === undefined || e.plugin === 'agent-hud'
      if (open && ours) {
        // Carousel: a person's step past either end of the themes lands on
        // the other end. Inferred from the previous element (focus events
        // carry no direction); a plugin's own move is never redirected.
        if (e.origin.kind === 'person') target = wrapFocus(pickerLastFocus, e.element, PICKER_ORDER) ?? e.element
        pickerLastFocus = target ?? null
      }
      const name = open && ours ? themeFromKey(target) : null
      if (name !== current) await update($, previewName, () => name)
    } catch {
      target = e.element // any failure: the move stands as it is
    }
    return target === e.element ? next(e) : next({ ...e, element: target })
  }).catch((_$, e, next) => next(e))

  // Hidden-sidebar band: shown above the prompt whenever the pane is not on
  // screen (closed by its ✕ or ctrl+x x, or open but unplaced on a narrow terminal),
  // with a button that reopens it. It asks the engine itself through
  // `$.ui.panes()` rather than tracking opens and closes: a plugin's own
  // `$.ui.close` is not seen by its own `ui.close` hook, and a state write
  // from a closing pane's button can be lost as the pane unmounts.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Read first: the poller rewrites `rows` every second, which redraws this
    // band, so a close or reopen shows up within a second.
    const list = await read($, rows)
    if (isSidebarShown(await $.ui.panes())) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const t = await activePalette($)
    if (unsupportedNotice !== null) {
      return (
        <Text wrap="truncate-end" color={t.warning}>
          {unsupportedNotice}
        </Text>
      )
    }
    const view = await hudView($, list)
    const connected = view.servers.filter(s => s.connected).length
    // Hidden sections leave their part out; with none left, no summary Text
    // (an empty one would still take a gap).
    const summary = summaryLine(
      view.contextPercent,
      connected,
      view.servers.length,
      view.agents.length,
      parseHidden(await read($, hiddenSections)),
    )

    return (
      <Box flexWrap="wrap" gap={1} {...fill(t)}>
        <Box flexShrink={0}>
          <Button
            key="expand"
            onPress={() => void $.ui.open({ id: PANE, title: 'Agent HUD' })}
          >
            <Text bold color={t.accent}>
              ▸ Agent HUD
            </Text>
          </Button>
        </Box>
        {summary !== '' && (
          <Text wrap="truncate-end" color={t.subtle}>
            {summary}
          </Text>
        )}
      </Box>
    )
  })

  // The Pane's own scroll: in the sticky layout the tree is exactly the body's
  // height, so the engine has nothing to move; its wheel and scroll-key moves
  // (raised at its edges too) shift the content box by `e.by` instead. An
  // observer: the engine's move is forwarded untouched.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const max = scrollMax
    if (max !== null) {
      const by = e.by
      await update($, scrollOffset, prev => clampOffset(Math.min(prev, max) + by, max))
    }
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // Every color below is a role of the active theme (`themes.ts`).
    // The Pane holds the keys: the picker's preview shows only then.
    const hasKeys = e.props.isFocused
    const t = await activePalette($, hasKeys)
    // Too old a Claude Code: only the notice, plain text and no buttons.
    if (unsupportedNotice !== null) {
      return (
        <Box flexDirection="column" paddingX={PANE_PADDING_X} {...fill(t)}>
          <Text wrap="wrap" color={t.warning}>
            {unsupportedNotice}
          </Text>
        </Box>
      )
    }
    const c = await read($, collapsed)
    const view = await hudView($, await read($, rows))
    const { servers, footer, agents: list } = view
    // MCP filter: `active` hides servers waiting on auth (`mcp.ts`).
    const mcpMode = await read($, mcpFilter)
    const mcp = filterServers(servers, isMcpFilter(mcpMode) ? mcpMode : DEFAULT_MCP_FILTER)
    const mcpButtons = MCP_FILTERS.map(mode => ({ mode, text: buttonText(mode, mode === mcpMode) }))
    const ms = view.meters
    const counts = agentCounts(list)
    const todoList = orderTodos(view.todos)
    const todoDone = todoList.filter(t => t.status === 'completed').length
    // Sized from the Pane's own body (props change on every resize, which
    // re-runs this hook); the surface's rows only when the body's are unknown.
    const L = layoutFor(e.props.bodyColumns, e.props.scroll?.bodyRows ?? e.viewport?.rows)
    const W = L.columns

    // 🤖 Opus 5.5 · medium — the same line for the session and each subagent.
    const modelLine = (m: ModelInfo | undefined, indent = '') =>
      m && (
        <Text wrap="truncate-end">
          {indent}🤖 <Text bold color={t.warning}>{prettyModel(m.model)}</Text>
          {m.effort !== undefined && <Text color={t.subtle}> · {String(m.effort)}</Text>}
        </Text>
      )

    // Responsive rule: in a row of a label and what follows it, the label
    // keeps its width (flexShrink 0) and the row wraps (flexWrap wrap), so the
    // rest goes below it instead of the label being squeezed letter by letter.
    const headerText = (id: SectionId, label: string) => `${c[id] ? '▸' : '▾'} ${label}`
    // Each section header is a Button that collapses just that module.
    // `update` from a handler is the documented pattern; it redraws the pane.
    // The title is an inverse band so sections stand apart at a glance.
    const header = (id: SectionId, label: string) => (
      <Box flexShrink={0}>
        <Button
          key={`toggle-${id}`}
          plain
          onPress={() => void update($, collapsed, prev => ({ ...prev, [id]: !prev[id] }))}
        >
          <Text bold inverse color={t.accent}>
            {sectionTitle(headerText(id, label))}
          </Text>
        </Button>
      </Box>
    )
    const headerWidth = (id: SectionId, label: string) => sectionTitle(headerText(id, label)).length
    const CLEAR_DONE = '✕ clear done'
    const REFRESH = '↻'
    // The `───` that closes a header row, sized to what its items leave.
    const rule = (...itemWidths: number[]) => {
      const w = ruleWidth(L.columns, itemWidths)
      return w > 0 ? (
        <Box flexShrink={0}>
          <Text color={t.subtle}>{'─'.repeat(w)}</Text>
        </Box>
      ) : null
    }

    // A small text button of the Gentle AI section. In demo mode no button
    // acts: it only says so.
    // `selected` marks the value a setting has now (`[● on]`), so a row of
    // choices reads as its current state.
    // `plain`: the label already reads `[on]`, and a non-plain Button would
    // wrap it in its own `[ … ]` chrome, which the row widths do not count.
    const action = (key: string, label: string, act: () => Promise<unknown>, selected = false) => (
      <Button
        key={key}
        plain
        onPress={() => {
          if (view.demo) return $.ui.toast('demo mode')
          void act()
        }}
      >
        {selected ? (
          <Text bold color={t.success}>
            {buttonText(label, true)}
          </Text>
        ) : (
          <Text color={t.accent}>{buttonText(label)}</Text>
        )}
      </Button>
    )
    // Command buttons confirm first (`runAction`), then detection runs again.
    const command = (key: GentleAction, label: string, root: string | null, selected = false) =>
      action(
        key,
        label,
        async () => {
          if (await runAction($, key, root)) await refreshGentle($, true)
        },
        selected,
      )

    // The Gentle AI section is one grid (`gentleGrid`): headings at
    // HEADING_INDENT with their summary in the detail column, items at
    // ITEM_INDENT as label · value · detail and buttons. The label and value
    // columns are padded to the widest in the section, so every row lines up;
    // details and buttons wrap below when the row is narrow.
    const gentleButton = (b: GentleButton, g: GentleView) =>
      b.key === 'gga-rules'
        ? action(b.key, b.label, () => fillPrompt($, rulesPrompt(g.gga.rulesFile)))
        : b.key === 'tdd-configure'
          ? action(b.key, b.label, () => fillPrompt($, STRICT_TDD_PROMPT))
          : command(b.key, b.label, g.root, b.selected)
    // The rows and their column widths, built once for both the tree and its
    // row count (`gentleRows`), so the two cannot drift apart.
    const gentleLayout = (g: GentleView) => {
      const rows = gentleGrid(g)
      const items = rows.filter((r): r is Extract<GentleRow, { kind: 'item' }> => r.kind === 'item')
      return {
        rows,
        grid: gridFor(
          items.map(r => r.label),
          items.map(r => r.value.text),
          W,
        ),
      }
    }

    const gentleSection = (g: GentleView | null) => {
      if (!g) return <Text color={t.subtle}>checking…</Text>
      if (!g.tools.find(t => t.name === 'gentle-ai')?.version)
        return <Text color={t.subtle}>gentle-ai not installed</Text>
      const { rows, grid } = gentleLayout(g)
      return (
        <Box flexDirection="column">
          {rows.map(r =>
            r.kind === 'heading' ? (
              <Box flexWrap="wrap" gap={1}>
                <Box flexShrink={0}>
                  <Text bold color={t.subtle}>
                    {`${' '.repeat(HEADING_INDENT)}${r.label}`.padEnd(grid.head)}
                  </Text>
                </Box>
                {r.summary && (
                  <Text wrap="truncate-end" color={r.summary.tone && t[r.summary.tone]}>
                    {r.summary.text}
                  </Text>
                )}
              </Box>
            ) : (
              <Box flexWrap="wrap" gap={1}>
                <Box flexShrink={0}>
                  <Text color={t.subtle}>{`${' '.repeat(ITEM_INDENT)}${r.label}`.padEnd(grid.label)}</Text>
                </Box>
                <Box flexShrink={0}>
                  <Text color={r.value.tone && t[r.value.tone]}>{r.value.text.padEnd(grid.value)}</Text>
                </Box>
                {r.detail && (
                  <Text wrap="truncate-end" color={r.detail.tone && t[r.detail.tone]}>
                    {r.detail.text}
                  </Text>
                )}
                {r.buttons.map(b => gentleButton(b, g))}
              </Box>
            ),
          )}
        </Box>
      )
    }

    // Rows the Gentle AI section draws at this width, from the same grid.
    const gentleRows = (g: GentleView | null): number => {
      if (!g || !g.tools.find(t => t.name === 'gentle-ai')?.version) return 1
      const { rows, grid } = gentleLayout(g)
      return rows.reduce(
        (n, r) =>
          n +
          (r.kind === 'heading'
            ? flowRows([grid.head, ...(r.summary ? [r.summary.text.length] : [])], W)
            : flowRows(
                [
                  grid.label,
                  grid.value,
                  ...(r.detail ? [r.detail.text.length] : []),
                  ...r.buttons.map(b => buttonText(b.label, b.selected).length),
                ],
                W,
              )),
        0,
      )
    }

    const branch = view.branch
    const changeText = view.changes
      ? `${view.changes.added > 0 ? ` +${view.changes.added}` : ''}${view.changes.removed > 0 ? ` -${view.changes.removed}` : ''}`
      : ''
    const meterNote = (m: Meter) => (m.note ? m.note.length : 0)
    const meterHead = 4 + L.barWidth + 5 // label, bar, percent
    const todosHeader = todoList.length > 0 ? `Todo ${todoDone}/${todoList.length}` : 'Todo'
    const CLEAR = '✕ clear done'.length

    // Rows a section draws without its margin row: its header, and its body
    // unless collapsed.
    const rowsOf = (id: SectionId, headerRows: number, bodyRows: number) => headerRows + (c[id] ? 0 : bodyRows)
    // Hidden sections (the settings button, `⋮`): not drawn, not counted.
    const hidden = parseHidden(await read($, hiddenSections))
    const visible = visibleSections(hidden)
    // Only the first drawn section has no blank row above it.
    const margin = (id: SectionId): { marginTop?: number } => (id === visible[0] ? {} : { marginTop: 1 })
    const cardList = displayRows(list)
    const picking = await read($, pickerOpen)
    // `⋮` settings block: never drawn with the picker.
    const settingsShown = !picking && (await read($, settingsOpen))
    const savedTheme = await read($, themeName)
    const shownName: ThemeName = isThemeName(savedTheme) ? savedTheme : DEFAULT_THEME

    // Sticky header: the project's name in a full-width inverse band that
    // ends in ⋮, the settings button (the glyph padded by three spaces each
    // side, a fixed 7-cell click target), drawn
    // inverse too with no gap so both read as one bar. Closing the sidebar is the engine's own close mark on
    // the frame (or ctrl+x x); the band above the prompt then reopens it.
    // The name's Box takes the line less the button (SETTINGS_BUTTON_CELLS), so
    // the row never wraps and a long name truncates. A blank row below keeps
    // the band apart from the first section.
    // Privacy mode prefixes 🔒 to the name, so it is seen whatever is hidden.
    const bandWidth = Math.max(1, W - SETTINGS_BUTTON_CELLS)
    const headerRow = (
      <Box flexDirection="column" flexShrink={0} marginBottom={1}>
        <Box flexWrap="wrap">
          <Box width={bandWidth} flexShrink={0}>
            <Text bold inverse color={t.accent} wrap="truncate-end">
              {centerBand(`${view.private ? '🔒 ' : ''}📂 ${view.project ?? projectName(view.cwd)}`, bandWidth)}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Button key={SETTINGS_KEY} plain onPress={() => void toggleSettings($)}>
              <Text bold inverse color={t.accent}>
                {SETTINGS_BUTTON}
              </Text>
            </Button>
          </Box>
        </Box>
      </Box>
    )

    // Sticky footer: the Claude Code version the session runs on.
    const footerRow = versionCache ? (
      <Box flexDirection="column" flexShrink={0} marginTop={1}>
        <Text wrap="truncate-end">
          <Text color={t.success}>● </Text>
          <Text color={t.subtle}>Claude</Text>
          <Text bold>Code</Text>
          <Text color={t.subtle}>{` ${versionCache}`}</Text>
        </Text>
      </Box>
    ) : null

    // `/hud-theme` picker: a block above the sections, which stay drawn below
    // it so they are seen recoloring. One row per theme in its own accent, the
    // saved one marked and focused first; `ui.focus` previews the theme the
    // ring rests on, a press saves it, Cancel only closes the block.
    const picker = (
      <Box flexDirection="column" flexShrink={0} marginBottom={1}>
        <Text wrap="truncate-end" color={t.subtle}>
          ↑/↓ preview · Enter apply · c cancel · Esc revert
        </Text>
        {!hasKeys && (
          <Text wrap="truncate-end" color={t.warning}>
            Keys elsewhere: ctrl+x tab or a click focuses the HUD
          </Text>
        )}
        {THEME_NAMES.map(name => (
          <Box flexShrink={0}>
            <Button
              key={themeKey(name)}
              plain
              autoFocus={name === savedTheme || undefined}
              onPress={() => void finishPicker($, name)}
            >
              <Text wrap="truncate-end" color={THEMES[name].accent}>
                {`${name === savedTheme ? '●' : ' '} ${name}`}
              </Text>
            </Button>
          </Box>
        ))}
        <Box flexShrink={0}>
          <Button key={PICKER_CANCEL} plain hotkey="c" onPress={() => void finishPicker($, null)}>
            <Text color={t.subtle}>{'  Cancel'}</Text>
          </Button>
        </Box>
      </Box>
    )

    // `⋮` settings block: above the sections, which stay drawn below it; never
    // with the picker (`settingsShown`). Its rows are counted by
    // `settingsRows`: keep the two in step.
    const settingsBlock = (
      <Box flexDirection="column" flexShrink={0} marginBottom={1}>
        <Text bold color={t.accent}>
          {SETTINGS_TITLE}
        </Text>
        <Box flexWrap="wrap" gap={1}>
          <Box flexShrink={0}>
            <Text color={t.subtle}>{settingsLabel('Theme')}</Text>
          </Box>
          <Box flexShrink={0}>
            <Text>{shownName}</Text>
          </Box>
          <Box flexShrink={0}>
            <Button key={SETTINGS_CHANGE} plain onPress={() => void startPicker($)}>
              <Text color={t.accent}>{CHANGE_TEXT}</Text>
            </Button>
          </Box>
        </Box>
        <Box flexWrap="wrap" gap={1}>
          <Box flexShrink={0}>
            <Text color={t.subtle}>{settingsLabel('Sections')}</Text>
          </Box>
          {/* onPress returns toggleSection's promise (no `void`), so a press
              that awaits it sees a failure toggleSection did not catch. */}
          {SECTION_IDS.map(id => {
            const shown = !hidden.includes(id)
            return (
              <Box flexShrink={0}>
                <Button key={sectionKey(id)} plain onPress={() => toggleSection($, id)}>
                  <Text bold={shown} color={shown ? t.success : t.accent}>
                    {checkText(id, shown)}
                  </Text>
                </Button>
              </Box>
            )
          })}
        </Box>
        <Box flexShrink={0}>
          <Button key={SETTINGS_CLOSE} plain onPress={() => void update($, settingsOpen, () => false)}>
            <Text color={t.accent}>{CLOSE_TEXT}</Text>
          </Button>
        </Box>
      </Box>
    )

    // One item per section: every row it draws (subagent cards included) and
    // its tree, so the count and the tree read the same items and cannot
    // drift (as `gentleGrid` feeds both the Gentle AI tree and `gentleRows`).
    // A missing section, or one missing `rows` or `node`, is a compile error.
    const cardRows = cardList.reduce((n, r) => n + (view.models.get(r.id) ? CARD_ROWS : CARD_ROWS - 1), 0)
    const sectionItems = {
      session: {
        rows: rowsOf(
          'session',
          flowRows([headerText('session', 'Session').length], W),
          1 + // title · id
            (view.account ? 1 : 0) +
            1 + // model
            (view.outputStyle ? 1 : 0) +
            (branch ? flowRows([2 + branch.length, ...(changeText ? [changeText.length] : [])], W, 0) : 0) +
            1, // path
        ),
        node: (
          <Box {...margin('session')} flexDirection="column">
            <Box gap={1} flexWrap="wrap">
              {header('session', 'Session')}
              {rule(headerWidth('session', 'Session'))}
            </Box>
            {!c.session && (
              <Text wrap="truncate-end">
                {view.title && <Text bold>{view.title}</Text>}
                <Text color={t.subtle}>
                  {view.title && view.sessionId && ' · '}
                  {view.sessionId.slice(0, 8)}
                </Text>
              </Text>
            )}
            {!c.session && view.account && (
              <Text wrap="truncate-end">
                👤 <Text bold>{view.account}</Text>
              </Text>
            )}
            {!c.session && modelLine(view.mainModel)}
            {!c.session && view.outputStyle && (
              <Text wrap="truncate-end">
                🎭 <Text color={t.accent}>{view.outputStyle}</Text>
              </Text>
            )}
            {!c.session && branch && (
              <Box flexWrap="wrap">
                <Box>
                  <Text wrap="truncate-end">
                    <Text bold color={t.accent}>
                      {BRANCH_ICON}
                    </Text>{' '}
                    <Text bold>{branch}</Text>
                  </Text>
                </Box>
                {changeText ? (
                  <Box flexShrink={0}>
                    <Text>
                      {view.changes && view.changes.added > 0 && <Text color={t.success}>{` +${view.changes.added}`}</Text>}
                      {view.changes && view.changes.removed > 0 && <Text color={t.error}>{` -${view.changes.removed}`}</Text>}
                    </Text>
                  </Box>
                ) : null}
              </Box>
            )}
            {!c.session &&
              (() => {
                // The drawable width less the 📁 glyph (two cells + space).
                const { parent, leaf } = shortPath(view.cwd, view.home, W - 3)
                return (
                  <Text wrap="truncate-start">
                    📁 <Text color={t.subtle}>{parent}</Text>
                    <Text bold>{leaf}</Text>
                  </Text>
                )
              })()}
          </Box>
        ),
      },
      context: {
        rows: rowsOf(
          'context',
          1,
          ms.length === 0 && !footer
            ? 1
            : ms.reduce((n, m) => n + flowRows([meterHead, ...(m.note ? [meterNote(m)] : [])], W, 0), 0) +
                (footer ? textRows(footer.length, W) : 0),
        ),
        node: (
          <Box {...margin('context')} flexDirection="column">
            <Box gap={1} flexWrap="wrap">
              {header('context', 'Context')}
              {rule(headerWidth('context', 'Context'))}
            </Box>
            {!c.context && ms.length === 0 && !footer && <Text color={t.subtle}>no usage yet</Text>}
            {!c.context &&
              ms.map(m => {
                const [filled, empty] = barCells(m.percent, L.barWidth)
                return (
                  <Box flexWrap="wrap">
                    <Box flexShrink={0}>
                      <Text>
                        <Text color={t.subtle}>{m.label.padEnd(4)}</Text>
                        <Text color={t[meterColor(m.percent)]}>{'━'.repeat(filled)}</Text>
                        <Text color={t.subtle} dimColor>
                          {'━'.repeat(empty)}
                        </Text>
                        {` ${Math.round(m.percent)}%`.padStart(5)}
                      </Text>
                    </Box>
                    {m.note ? (
                      <Box>
                        <Text wrap="truncate-end" color={t.subtle}>
                          {m.note}
                        </Text>
                      </Box>
                    ) : null}
                  </Box>
                )
              })}
            {!c.context && footer ? <Text color={t.subtle}>{footer}</Text> : null}
          </Box>
        ),
      },
      mcp: {
        rows: rowsOf(
          'mcp',
          flowRows([headerText('mcp', 'MCP').length, ...(c.mcp ? [] : mcpButtons.map(b => b.text.length))], W),
          mcpBodyRows(mcp.shown.length, mcp.hidden),
        ),
        node: (
          <Box {...margin('mcp')} flexDirection="column">
            <Box gap={1} flexWrap="wrap">
              {header('mcp', 'MCP')}
              {!c.mcp &&
                mcpButtons.map(b => (
                  <Box flexShrink={0}>
                    <Button key={`mcp-filter-${b.mode}`} plain onPress={() => void setMcpFilter($, b.mode)}>
                      <Text bold={b.mode === mcpMode} color={b.mode === mcpMode ? t.success : t.accent}>
                        {b.text}
                      </Text>
                    </Button>
                  </Box>
                ))}
              {c.mcp
                ? rule(headerWidth('mcp', 'MCP'))
                : rule(headerWidth('mcp', 'MCP'), ...mcpButtons.map(b => b.text.length))}
            </Box>
            {!c.mcp && mcp.shown.length === 0 && <Text color={t.subtle}>{mcpEmptyText(mcp.hidden)}</Text>}
            {!c.mcp &&
              mcp.shown.map(s => (
                <Text wrap="truncate-end" dimColor={!s.connected}>
                  <Text color={t[s.connected ? 'success' : 'subtle']}>{s.connected ? '●' : '○'}</Text>{' '}
                  {s.name}
                  {!s.connected && <Text color={t.subtle}> · auth</Text>}
                </Text>
              ))}
            {!c.mcp && mcp.shown.length > 0 && mcp.hidden > 0 && (
              <Text color={t.subtle}>{mcpHiddenText(mcp.hidden)}</Text>
            )}
          </Box>
        ),
      },
      subagents: {
        // The tally, then every card (the content scrolls).
        rows: rowsOf(
          'subagents',
          flowRows([headerText('subagents', 'Subagents').length, ...(counts.done + counts.err > 0 ? [CLEAR] : [])], W),
          1 + cardRows,
        ),
        node: (
          <Box {...margin('subagents')} flexDirection="column">
            <Box gap={1} flexWrap="wrap">
              {header('subagents', 'Subagents')}
              {!c.subagents && counts.done + counts.err > 0 && (
                <Button
                  key="clear-subagents"
                  plain
                  onPress={() => {
                    if (view.demo) return // sample data: nothing real to clear
                    for (const r of list) if (r.done) clearedAgents.add(r.id)
                    void update($, rows, prev => prev.filter(r => !r.done))
                  }}
                >
                  <Text color={t.subtle}>{CLEAR_DONE}</Text>
                </Button>
              )}
              {!c.subagents && counts.done + counts.err > 0
                ? rule(headerWidth('subagents', 'Subagents'), CLEAR_DONE.length)
                : rule(headerWidth('subagents', 'Subagents'))}
            </Box>
            {!c.subagents && L.compact && (
              <Text wrap="truncate-end">
                <Text color={t.accent}>●{counts.run}</Text> <Text color={t.success}>✓{counts.done}</Text>{' '}
                <Text color={t.error}>✕{counts.err}</Text>
              </Text>
            )}
            {!c.subagents && !L.compact && (
              <Text wrap="truncate-end">
                <Text color={t.accent}>● {counts.run} running</Text>
                <Text color={t.subtle}> · </Text>
                <Text color={t.success}>✓ {counts.done} done</Text>
                <Text color={t.subtle}> · </Text>
                <Text color={t.error}>✕ {counts.err} error</Text>
              </Text>
            )}
            {!c.subagents &&
              cardList.map(r => (
                <Box flexDirection="column">
                  <Text wrap="truncate-end">
                    <Text color={t[color(r.status)]}>{icon(r.status)}</Text> <Text bold>{r.description}</Text>
                  </Text>
                  <Text wrap="truncate-end" color={t.subtle}>
                    {'  '}(@{r.type} subagent)
                  </Text>
                  {modelLine(view.models.get(r.id), '  ')}
                  <Text wrap="truncate-end" color={t.subtle}>
                    {'  '}◷ {fmt(r.elapsedMs)}
                    {r.tokens !== undefined && `  ≋ ${fmtTokens(r.tokens)} tok`}
                  </Text>
                </Box>
              ))}
          </Box>
        ),
      },
      todos: {
        rows: rowsOf(
          'todos',
          flowRows([headerText('todos', todosHeader).length, ...(todoDone > 0 ? [CLEAR] : [])], W),
          todoList.length === 0 ? 1 : todoList.reduce((n, t) => n + textRows(4 + t.content.length, W), 0),
        ),
        node: (
          <Box {...margin('todos')} flexDirection="column">
            <Box gap={1} flexWrap="wrap">
              {header('todos', todosHeader)}
              {!c.todos && todoDone > 0 && (
                <Button
                  key="clear-todos"
                  plain
                  onPress={() => {
                    if (view.demo) return // sample data: nothing real to clear
                    for (const t of todoList) if (t.status === 'completed') clearedTodos.add(t.content)
                    void update($, todos, prev => prev.filter(t => t.status !== 'completed'))
                  }}
                >
                  <Text color={t.subtle}>{CLEAR_DONE}</Text>
                </Button>
              )}
              {!c.todos && todoDone > 0
                ? rule(headerWidth('todos', todosHeader), CLEAR_DONE.length)
                : rule(headerWidth('todos', todosHeader))}
            </Box>
            {!c.todos && todoList.length === 0 && <Text color={t.subtle}>no todos</Text>}
            {!c.todos &&
              todoList.map(todo =>
                todo.status === 'completed' ? (
                  <Text wrap="wrap" color={t.subtle}>
                    [✓] {todo.content}
                  </Text>
                ) : todo.status === 'in_progress' ? (
                  <Text wrap="wrap" bold color={t.success}>
                    [ ] {todo.content}
                  </Text>
                ) : (
                  <Text wrap="wrap">[ ] {todo.content}</Text>
                ),
              )}
          </Box>
        ),
      },
      gentle: {
        rows: rowsOf('gentle', flowRows([headerText('gentle', 'Gentle AI').length, 1], W), gentleRows(view.gentle ?? null)),
        node: (
          <Box {...margin('gentle')} flexDirection="column">
            <Box gap={1} flexWrap="wrap">
              {header('gentle', 'Gentle AI')}
              {!c.gentle && (
                <Button
                  key="gentle-refresh"
                  plain
                  onPress={() => {
                    if (view.demo) return $.ui.toast('demo mode')
                    void refreshGentle($)
                  }}
                >
                  <Text color={t.subtle}>{REFRESH}</Text>
                </Button>
              )}
              {!c.gentle
                ? rule(headerWidth('gentle', 'Gentle AI'), REFRESH.length)
                : rule(headerWidth('gentle', 'Gentle AI'))}
            </Box>
            {!c.gentle && gentleSection(view.gentle ?? null)}
          </Box>
        ),
      },
    } satisfies Record<SectionId, { rows: number; node: JSX.Element }>
    const shownSections = visible.map(id => ({ id, ...sectionItems[id] }))

    // Rows the scrolled content takes at this width: the block on top, then
    // each drawn section plus the margin row above all but the first, or the
    // all-hidden line when every section is hidden. Ink wraps words, so a
    // long text can take a row more than estimated; the bottom margin of the
    // scroll absorbs one.
    const contentRows =
      (picking ? pickerRows(hasKeys) : settingsShown ? settingsRows(W, shownName) : 0) +
      shownSections.reduce((n, s, i) => n + (i > 0 ? 1 : 0) + s.rows, 0) +
      (shownSections.length === 0 ? textRows(ALL_HIDDEN_TEXT.length, W) : 0)

    const sections = [
      ...(picking ? [picker] : settingsShown ? [settingsBlock] : []),
      ...shownSections.map(s => s.node),
      ...(shownSections.length === 0
        ? [
            <Text wrap="wrap" color={t.subtle}>
              {ALL_HIDDEN_TEXT}
            </Text>,
          ]
        : []),
    ]

    // Inline frames fit the tree, and without the body's height there is no
    // window to fill: the plain flow, scrolled by the engine.
    const bodyRows = e.props.scroll?.bodyRows
    if (e.props.placement === 'inline' || typeof bodyRows !== 'number') {
      scrollMax = null
      return (
        <Box flexDirection="column" paddingX={PANE_PADDING_X} {...fill(t)}>
          {headerRow}
          <Box flexDirection="column">{sections}</Box>
          {footerRow}
        </Box>
      )
    }

    // Sticky layout: exactly the body's height, so the engine has nothing to
    // scroll; the sections move inside the clipped viewport by our offset,
    // clamped here too, so a shrunk content (a collapsed section, a taller
    // pane) never leaves the window past its end.
    const viewportRows = viewportRowsFor(bodyRows, footerRow !== null)
    const max = maxScrollOffset(contentRows, viewportRows)
    scrollMax = max
    const offset = clampOffset(await read($, scrollOffset), max)
    return (
      <Box flexDirection="column" paddingX={PANE_PADDING_X} height={bodyRows} {...fill(t)}>
        {headerRow}
        <Box flexDirection="column" flexShrink={0} height={viewportRows} overflow="hidden">
          <Box flexDirection="column" flexShrink={0} marginTop={0 - offset}>
            {sections}
          </Box>
        </Box>
        {footerRow}
      </Box>
    )
  })
}
