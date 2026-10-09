import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentRow, TodoItem, TodoStatus } from '../types'

const PANE = 'hud'
type SectionId = 'session' | 'context' | 'mcp' | 'subagents' | 'todos'

// ── Todos ────────────────────────────────────────────────────────────────
// No `$` accessor holds the task list, so the pane mirrors it from the
// main loop's own TodoWrite / TaskCreate / TaskUpdate calls.

// TodoWrite always sends the whole list: it replaces ours.
export const fromTodoWrite = (
  todos: readonly { content: string; status: TodoStatus; activeForm?: string }[],
): TodoItem[] =>
  todos.map((t, i) => ({ id: `w${i}`, content: t.content, activeForm: t.activeForm, status: t.status }))

export const addTask = (
  list: readonly TodoItem[],
  id: string,
  subject: string,
  activeForm?: string,
): TodoItem[] => [...list.filter(t => t.id !== id), { id, content: subject, activeForm, status: 'pending' }]

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
          content: change.subject ?? t.content,
          activeForm: change.activeForm ?? t.activeForm,
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

// The /rename title has no `$` accessor and no event either; Claude Code keeps
// it in `~/.claude/projects/<project>/<sessionId>/custom-title.json`, so the
// poller reads that file. An internal file: if its place or shape changes,
// the pane falls back to the session id.
let sessionTitle: string | null = null

// The signed-in account as the status line shows it: you@Acme.
// No `$` accessor carries it, so the poller reads `~/.claude.json` and keeps
// only these two fields; null when there is no OAuth account.
let accountCache: string | null = null

export const accountLabel = (text: string): string | null => {
  try {
    const account = (JSON.parse(text) as {
      oauthAccount?: { emailAddress?: unknown; organizationName?: unknown }
    }).oauthAccount
    const email = typeof account?.emailAddress === 'string' ? account.emailAddress : null
    if (!email) return null
    const [user] = email.split('@')
    const org = typeof account?.organizationName === 'string' ? account.organizationName.trim() : ''
    return org ? `${user}@${org}` : email
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

// Claude Code's project folder name: the root path, non-alphanumerics as `-`.
export const projectDir = (root: string): string => root.replace(/[^a-zA-Z0-9]/g, '-')

export const parseTitle = (text: string): string | null => {
  try {
    const title = (JSON.parse(text) as { customTitle?: unknown }).customTitle
    return typeof title === 'string' && title.trim() ? title.trim() : null
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
})

// The sidebar counts as shown only while its pane is open and drawn.
export const isSidebarShown = (panes: readonly { id: string; isPlaced: boolean }[]): boolean =>
  panes.some(p => p.id === PANE && p.isPlaced)
const todos = atom({ plugin: 'agent-hud', key: 'todos' } as const, [])

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

// Theme keys adapt to light/dark automatically, so the pane stays legible on
// either terminal theme.
const color = (status: string): string => {
  switch (status) {
    case 'running':
      return 'claude'
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
      type: a.type,
      description: a.description,
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
// before the first response, so a missing one is simply dropped.

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
  if (ctx?.percent !== undefined) {
    out.push({ label: 'ctx', percent: ctx.percent, note: ctx.window ? ` · ${fmtTokens(ctx.window)}` : '' })
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

export const meterColor = (percent: number): string =>
  percent < 60 ? 'success' : percent < 85 ? 'warning' : 'error'

// 261,474 tokens · $16.13 spent
export const contextFooter = (usage: UsageLike): string => {
  const parts: string[] = []
  const tokens = usage.context?.tokens
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
    const name = prettyServer(server)
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

// One-line digest shown in the collapsed-sidebar band above the prompt.
export const summaryLine = (
  percent: number | undefined,
  connected: number,
  total: number,
  agents: number,
): string =>
  `${percent === undefined ? '–' : Math.round(percent)}% · MCP ${connected}/${total} · ${agents} agents`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hud',
      description: 'Open the Agent HUD sidebar',
    })

    void $.ui.open({ id: PANE, title: 'Agent HUD' })

    let ticks = 0
    const tick = async (): Promise<void> => {
      ticks += 1
      // Poll the /rename title every ~2s (a tiny file read; no rename event).
      if (ticks % 2 === 1) {
        try {
          const home = await $.env.get('HOME')
          const [id, root] = await Promise.all([$.session.id(), $.session.root()])
          if (typeof home === 'string') {
            homeCache = home
            const path = `${home}/.claude/projects/${projectDir(root)}/${id}/custom-title.json`
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
          if (typeof home === 'string') accountCache = accountLabel(await $.fs.read(`${home}/.claude.json`))
        } catch {
          // keep the last known account
        }
      }
      // System UTC offset for reset times: now, then every ~10 min (DST).
      if (ticks % 600 === 1) {
        try {
          const { stdout } = await $.process.run(['date', '+%z'])
          utcOffsetMin = parseOffset(stdout) ?? utcOffsetMin
        } catch {
          // keep the last known offset; without one, only the countdown shows
        }
      }
      // Refresh the cached branch every ~5s (git spawns a process).
      if (ticks % 5 === 1) {
        const repo = await $.session.repo()
        if (!repo) {
          gitBranchCache = null
        } else {
          try {
            const { stdout } = await $.process.run(['git', 'branch', '--show-current'], {
              cwd: repo.root,
            })
            gitBranchCache = stdout.trim() || null
          } catch {
            gitBranchCache = null
          }
        }
      }
      const built = buildRows(await $.agent.list(), seen, await $.clock.now())
      await update($, rows, prev => mergeRows(prev, built).filter(r => !clearedAgents.has(r.id)))
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

  // Model + effort of every request, per loop. A pure pass-through: it notes
  // two fields synchronously and forwards the stream untouched.
  on('turn.step', async function* (_$, e, next) {
    loopModel.set(e.agentId ?? MAIN, { model: e.model, effort: e.effort })
    return yield* next(e)
  })

  // Per-subagent tokens: AgentInfo has none, but each finished turn of a
  // subagent's loop reports its usage with its agentId.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId && e.usage) {
      const tokens = ctxTokens(e.usage)
      const rec = seen.get(e.agentId)
      if (rec) rec.tokens = tokens
      else seen.set(e.agentId, { start: await $.clock.now(), tokens })
    }
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

  // Hidden-sidebar band: shown above the prompt whenever the pane is not on
  // screen (closed by → or its ✕, or open but unplaced on a narrow terminal),
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
    const usage = await $.session.usage()
    const servers = mcpServers(await $.tool.list())
    const connected = servers.filter(s => s.connected).length

    return (
      <Box>
        <Button
          key="expand"
          onPress={() => void $.ui.open({ id: PANE, title: 'Agent HUD' })}
        >
          <Text bold color="claude">
            ▸ Agent HUD
          </Text>
        </Button>
        <Text color="subtle">
          {' '}
          {summaryLine(usage.context?.percent, connected, servers.length, list.length)}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, rows)
    const c = await read($, collapsed)
    const servers = mcpServers(await $.tool.list())
    const usage = await $.session.usage()
    const ms = meters(usage, await $.clock.now(), utcOffsetMin)
    const footer = contextFooter(usage)
    const [session, model, cwd] = await Promise.all([
      $.session.id(),
      $.session.model(),
      $.session.cwd(),
    ])
    const counts = agentCounts(list)
    const todoList = orderTodos(await read($, todos))
    const todoDone = todoList.filter(t => t.status === 'completed').length
    // Each subagent card takes four rows; show as many as fit, at least one.
    const used = ms.length + 1 + servers.length + todoList.length + 20
    const cards = Math.max(1, Math.floor(((e.viewport?.rows ?? 24) - used) / 4))

    // 🤖 Opus 5.5 · medium — the same line for the session and each subagent.
    const modelLine = (m: { model: string; effort?: string | number } | undefined, indent = '') =>
      m && (
        <Text wrap="truncate-end">
          {indent}🤖 <Text bold color="warning">{prettyModel(m.model)}</Text>
          {m.effort !== undefined && <Text color="subtle"> · {String(m.effort)}</Text>}
        </Text>
      )

    // Each section header is a Button that collapses just that module.
    // `update` from a handler is the documented pattern; it redraws the pane.
    const header = (id: SectionId, label: string) => (
      <Button
        key={`toggle-${id}`}
        onPress={() => void update($, collapsed, prev => ({ ...prev, [id]: !prev[id] }))}
      >
        <Text bold color="claude">
          {c[id] ? '▸' : '▾'} {label}
        </Text>
      </Button>
    )

    return (
      <Box flexDirection="column" paddingX={1}>
        {/* Top row: → hides the sidebar, right under the pane's ✕ (the frame
            row itself is the engine's). The dock cannot be forced narrower
            (a width the person set wins over `columns`), so hiding goes to
            the band above the prompt, which reopens it. */}
        <Box justifyContent="flex-end">
          <Button
            key="hide-sidebar"
            plain
            onPress={() => void $.ui.close({ id: PANE })}
          >
            <Text color="subtle">→</Text>
          </Button>
        </Box>

        <Box flexDirection="column">
          {header('session', 'Session')}
          {!c.session && (
            <Text wrap="truncate-end">
              {sessionTitle && <Text bold>{sessionTitle}</Text>}
              <Text color="subtle">
                {sessionTitle && ' · '}
                {session.slice(0, 8)}
              </Text>
            </Text>
          )}
          {!c.session && accountCache && (
            <Text wrap="truncate-end">
              👤 <Text bold>{accountCache}</Text>
            </Text>
          )}
          {/* Until the next request reports it, the effort is unknown. */}
          {!c.session && modelLine(loopModel.get(MAIN) ?? { model })}
          {!c.session && gitBranchCache && <Text color="subtle">⎇ {gitBranchCache}</Text>}
          {!c.session &&
            (() => {
              // Body width less the padding and the 📁 glyph (two cells + space).
              const { parent, leaf } = shortPath(cwd, homeCache, (e.props.bodyColumns ?? 40) - 5)
              return (
                <Text wrap="truncate-start">
                  📁 <Text color="subtle">{parent}</Text>
                  <Text bold>{leaf}</Text>
                </Text>
              )
            })()}
        </Box>

        <Box marginTop={1} flexDirection="column">
          {header('context', 'Context')}
          {!c.context && ms.length === 0 && !footer && <Text color="subtle">no usage yet</Text>}
          {!c.context &&
            ms.map(m => {
              const [filled, empty] = barCells(m.percent)
              return (
                <Text wrap="truncate-end">
                  <Text color="subtle">{m.label.padEnd(4)}</Text>
                  <Text color={meterColor(m.percent)}>{'━'.repeat(filled)}</Text>
                  <Text color="subtle" dimColor>
                    {'━'.repeat(empty)}
                  </Text>
                  {` ${Math.round(m.percent)}%`.padStart(5)}
                  <Text color="subtle">{m.note}</Text>
                </Text>
              )
            })}
          {!c.context && footer && <Text color="subtle">{footer}</Text>}
        </Box>

        <Box marginTop={1} flexDirection="column">
          {header('mcp', 'MCP')}
          {!c.mcp && servers.length === 0 && <Text color="subtle">none connected</Text>}
          {!c.mcp &&
            servers.map(s => (
              <Text wrap="truncate-end" dimColor={!s.connected}>
                <Text color={s.connected ? 'success' : 'subtle'}>{s.connected ? '●' : '○'}</Text>{' '}
                {s.name}
                {!s.connected && <Text color="subtle"> · auth</Text>}
              </Text>
            ))}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Box gap={1}>
            {header('subagents', 'Subagents')}
            {!c.subagents && counts.done + counts.err > 0 && (
              <Button
                key="clear-subagents"
                onPress={() => {
                  for (const r of list) if (r.done) clearedAgents.add(r.id)
                  void update($, rows, prev => prev.filter(r => !r.done))
                }}
              >
                <Text color="subtle">✕ clear done</Text>
              </Button>
            )}
          </Box>
          {!c.subagents && (
            <Text wrap="truncate-end">
              <Text color="claude">● {counts.run} running</Text>
              <Text color="subtle"> · </Text>
              <Text color="success">✓ {counts.done} done</Text>
              <Text color="subtle"> · </Text>
              <Text color="error">✕ {counts.err} error</Text>
            </Text>
          )}
          {!c.subagents &&
            displayRows(list)
              .slice(0, cards)
              .map(r => (
              <Box flexDirection="column">
                <Text wrap="truncate-end">
                  <Text color={color(r.status)}>{icon(r.status)}</Text> <Text bold>{r.description}</Text>
                </Text>
                <Text wrap="truncate-end" color="subtle">
                  {'  '}(@{r.type} subagent)
                </Text>
                {modelLine(loopModel.get(r.id), '  ')}
                <Text color="subtle">
                  {'  '}◷ {fmt(r.elapsedMs)}
                  {r.tokens !== undefined && `  ≋ ${fmtTokens(r.tokens)} tok`}
                </Text>
              </Box>
            ))}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Box gap={1}>
            {header('todos', todoList.length > 0 ? `Todo ${todoDone}/${todoList.length}` : 'Todo')}
            {!c.todos && todoDone > 0 && (
              <Button
                key="clear-todos"
                onPress={() => {
                  for (const t of todoList) if (t.status === 'completed') clearedTodos.add(t.content)
                  void update($, todos, prev => prev.filter(t => t.status !== 'completed'))
                }}
              >
                <Text color="subtle">✕ clear done</Text>
              </Button>
            )}
          </Box>
          {!c.todos && todoList.length === 0 && <Text color="subtle">no todos</Text>}
          {!c.todos &&
            todoList.map(t =>
              t.status === 'completed' ? (
                <Text wrap="wrap" color="subtle">
                  [✓] {t.content}
                </Text>
              ) : t.status === 'in_progress' ? (
                <Text wrap="wrap" bold color="success">
                  [ ] {t.content}
                </Text>
              ) : (
                <Text wrap="wrap">[ ] {t.content}</Text>
              ),
            )}
        </Box>
      </Box>
    )
  })
}
