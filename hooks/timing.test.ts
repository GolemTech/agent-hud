import { test, expect } from 'claude-code/testing'

import {
  accountLabel,
  claudePaths,
  clean,
  versionLabel,
  addTask,
  agentCounts,
  buildRows,
  barCells,
  displayRows,
  mergeRows,
  contextFooter,
  meterColor,
  localClock,
  meters,
  parseOffset,
  untilLabel,
  ctxTokens,
  fmt,
  fmtTokens,
  fromTodoWrite,
  mcpServers,
  orderTodos,
  outputStyleFrom,
  parseShortstat,
  parseTitle,
  prettyModel,
  projectDir,
  shortPath,
  summaryLine,
  updateTask,
} from './register'

test('projectDir matches Claude Code project folder names', () => {
  expect(projectDir('/home/myuser')).toBe('-home-myuser')
  expect(projectDir('/home/myuser/backups-old/home/myuser/project/notebooks')).toBe(
    '-home-myuser-backups-old-home-myuser-project-notebooks',
  )
  expect(projectDir('/home/myuser/.claude/dev-mods')).toBe('-home-myuser--claude-dev-mods')
})

test('parseTitle reads customTitle and rejects anything else', () => {
  expect(parseTitle('{"customTitle":"claude-mods"}')).toBe('claude-mods')
  expect(parseTitle('{"customTitle":"   "}')).toBe(null)
  expect(parseTitle('{}')).toBe(null)
  expect(parseTitle('not json')).toBe(null)
})

const agent = (status: string) => [
  { id: 'A1', type: 'Explore', description: 'map the repo', status },
]

test('elapsed counts from the stamped start and freezes on terminal status', () => {
  // agent.spawn stamped the real dispatch time at t=0.
  const timing = new Map<string, { start: number; end?: number }>([['A1', { start: 0 }]])

  // Running: elapsed tracks the clock, not a first-seen time.
  let rows = buildRows(agent('running'), timing, 3000)
  expect(rows[0]?.elapsedMs).toBe(3000)
  expect(rows[0]?.done).toBe(false)

  // Terminal: end freezes at this tick (4000).
  rows = buildRows(agent('completed'), timing, 4000)
  expect(rows[0]?.elapsedMs).toBe(4000)
  expect(rows[0]?.done).toBe(true)

  // Later ticks must NOT keep incrementing a finished agent.
  rows = buildRows(agent('completed'), timing, 9000)
  expect(rows[0]?.elapsedMs).toBe(4000)
})

test('first-seen fallback stamps start when there was no agent.spawn', () => {
  const timing = new Map<string, { start: number; end?: number }>()

  // Already-running at load: no prior stamp, so start = the first tick time.
  let rows = buildRows(agent('running'), timing, 5000)
  expect(rows[0]?.elapsedMs).toBe(0)

  rows = buildRows(agent('running'), timing, 7000)
  expect(rows[0]?.elapsedMs).toBe(2000)
})

test('meters: context window first, then 5h and 7d with a reset countdown', () => {
  const now = Date.parse('2026-10-09T11:30:00Z')
  const ms = meters(
    {
      context: { tokens: 480_000, percent: 48, window: 1_000_000 },
      rateLimits: [
        { kind: 'seven_day', percentUsed: 3, resetsAt: '2026-10-14T17:30:00Z' },
        { kind: 'five_hour', percentUsed: 16, resetsAt: '2026-10-09T14:10:00Z' },
      ],
    },
    now,
  )
  expect(ms).toEqual([
    { label: 'ctx', percent: 48, note: ' · 1M' },
    { label: '5h', percent: 16, note: ' ↻ 2h40m' },
    { label: '7d', percent: 3, note: ' ↻ 5d6h' },
  ])
})

test('meters drop what is not available yet', () => {
  expect(meters({ context: {} }, 0)).toEqual([])
  // A past or missing reset shows no countdown.
  expect(meters({ rateLimits: [{ kind: 'five_hour', percentUsed: 10 }] }, 0)).toEqual([
    { label: '5h', percent: 10, note: '' },
  ])
})

test('meters show a fresh session (no response yet) at 0% of its window', () => {
  expect(meters({ context: { window: 1_000_000 } }, 0)).toEqual([
    { label: 'ctx', percent: 0, note: ' · 1M' },
  ])
})

test('untilLabel counts down in m, h+m and d+h', () => {
  expect(untilLabel(45 * 60_000)).toBe('45m')
  expect(untilLabel(160 * 60_000)).toBe('2h40m')
  expect(untilLabel((5 * 24 + 6) * 3_600_000)).toBe('5d6h')
})

test('barCells splits a fixed-width track into filled and empty', () => {
  expect(barCells(0)).toEqual([0, 10])
  expect(barCells(48)).toEqual([5, 5])
  expect(barCells(3)).toEqual([1, 9]) // any use shows
  expect(barCells(97)).toEqual([9, 1]) // only a full window fills
  expect(barCells(100)).toEqual([10, 0])
  expect(barCells(130)).toEqual([10, 0])
})

test('meterColor goes green, yellow, red', () => {
  expect(meterColor(16)).toBe('success')
  expect(meterColor(70)).toBe('warning')
  expect(meterColor(92)).toBe('error')
})

test('contextFooter joins tokens and spend', () => {
  expect(contextFooter({ context: { tokens: 261_474 }, cost: { usd: 16.13 } })).toBe(
    '261,474 tokens · $16.13 spent',
  )
  expect(contextFooter({})).toBe('')
  // A fresh session has a window but no reading yet: 0 tokens.
  expect(contextFooter({ context: { window: 1_000_000 }, cost: { usd: 0 } })).toBe(
    '0 tokens · $0.00 spent',
  )
})

test('mcpServers reports clean names and connected-vs-pending status', () => {
  const tools = [
    { name: 'Bash', mcp: false },
    { name: 'mcp__engram__mem_save', mcp: true },
    { name: 'mcp__codegraph__codegraph_explore', mcp: true },
    // plugin prefix dropped; X_X duplicate collapsed; two configs of context7
    // merge; a real tool makes it connected.
    { name: 'mcp__context7__resolve', mcp: true },
    { name: 'mcp__plugin_context7_context7__query', mcp: true },
    // airwallex and Gmail only expose the OAuth handshake -> pending.
    { name: 'mcp__plugin_airwallex-agentos_airwallex-agentos__authenticate', mcp: true },
    { name: 'mcp__plugin_airwallex-agentos_airwallex-agentos__complete_authentication', mcp: true },
    { name: 'mcp__claude_ai_Gmail__authenticate', mcp: true },
  ]
  // Connected servers first (alphabetical), then pending (alphabetical).
  expect(mcpServers(tools)).toEqual([
    { name: 'codegraph', connected: true },
    { name: 'context7', connected: true },
    { name: 'engram', connected: true },
    { name: 'airwallex-agentos', connected: false },
    { name: 'claude.ai Gmail', connected: false },
  ])
})

test('a server with both auth and real tools counts as connected', () => {
  const tools = [
    { name: 'mcp__gmail__authenticate', mcp: true },
    { name: 'mcp__gmail__send_email', mcp: true },
  ]
  expect(mcpServers(tools)).toEqual([{ name: 'gmail', connected: true }])
})

test('agentCounts tallies run / done / err / total', () => {
  const list = [
    { status: 'running' },
    { status: 'pending' },
    { status: 'completed' },
    { status: 'failed' },
    { status: 'killed' },
  ]
  expect(agentCounts(list)).toEqual({ run: 2, done: 1, err: 2, total: 5 })
  expect(agentCounts([])).toEqual({ run: 0, done: 0, err: 0, total: 0 })
})

test('summaryLine digests the collapsed-sidebar band', () => {
  expect(summaryLine(26, 5, 9, 2)).toBe('26% · MCP 5/9 · 2 agents')
  expect(summaryLine(undefined, 0, 0, 0)).toBe('–% · MCP 0/0 · 0 agents')
})

test('fmt renders elapsed as a clock', () => {
  expect(fmt(0)).toBe('00:00')
  expect(fmt(30_000)).toBe('00:30')
  expect(fmt(65_000)).toBe('01:05')
  expect(fmt(3_725_000)).toBe('1:02:05')
})

test('fmtTokens compacts counts', () => {
  expect(fmtTokens(950)).toBe('950')
  expect(fmtTokens(12_200)).toBe('12.2k')
  expect(fmtTokens(12_000)).toBe('12k')
  expect(fmtTokens(1_400_000)).toBe('1.4M')
})

test('ctxTokens sums uncached, cache-read and cache-written input', () => {
  expect(
    ctxTokens({ input_tokens: 200, cache_read_input_tokens: 12_000, cache_creation_input_tokens: 0 }),
  ).toBe(12_200)
  expect(ctxTokens({ input_tokens: 50 })).toBe(50)
})

test('buildRows carries a subagent turn tokens once reported', () => {
  const timing = new Map<string, { start: number; end?: number; tokens?: number }>([
    ['A1', { start: 0 }],
  ])
  const agent = [{ id: 'A1', type: 'Explore', description: 'map', status: 'running' }]
  expect(buildRows(agent, timing, 1000)[0]?.tokens).toBe(undefined)
  timing.get('A1')!.tokens = 12_200
  expect(buildRows(agent, timing, 2000)[0]?.tokens).toBe(12_200)
})

test('todos: TodoWrite replaces, TaskCreate adds, TaskUpdate edits or deletes', () => {
  const written = fromTodoWrite([
    { content: 'a', status: 'completed', activeForm: 'A-ing' },
    { content: 'b', status: 'pending', activeForm: 'B-ing' },
  ])
  expect(written.map(t => t.content)).toEqual(['a', 'b'])

  let list = addTask([], '1', 'migrate')
  list = addTask(list, '2', 'test')
  expect(list.map(t => [t.id, t.status])).toEqual([
    ['1', 'pending'],
    ['2', 'pending'],
  ])
  list = updateTask(list, { taskId: '1', status: 'in_progress' })
  expect(list[0]?.status).toBe('in_progress')
  list = updateTask(list, { taskId: '2', status: 'deleted' })
  expect(list.map(t => t.id)).toEqual(['1'])
})

test('orderTodos: done first, in progress next, pending last, stable', () => {
  const list = [
    { id: 'p1', content: 'p1', status: 'pending' as const },
    { id: 'c1', content: 'c1', status: 'completed' as const },
    { id: 'i1', content: 'i1', status: 'in_progress' as const },
    { id: 'p2', content: 'p2', status: 'pending' as const },
    { id: 'c2', content: 'c2', status: 'completed' as const },
  ]
  expect(orderTodos(list).map(t => t.id)).toEqual(['c1', 'c2', 'i1', 'p1', 'p2'])
})

test('prettyModel turns model ids into readable names', () => {
  expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(prettyModel('claude-opus-4-8')).toBe('Opus 4.8')
  expect(prettyModel('claude-haiku-5-5')).toBe('Haiku 5.5')
  expect(prettyModel('claude-fable-5-1')).toBe('Fable 5.1')
  expect(prettyModel('claude-opus-4-8[1m]')).toBe('Opus 4.8')
  expect(prettyModel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
  expect(prettyModel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
  expect(prettyModel('us.anthropic.claude-opus-4-1-20250805-v1:0')).toBe('Opus 4.1')
  expect(prettyModel('opus')).toBe('Opus')
  expect(prettyModel('gpt-5')).toBe('gpt-5')
})

test('parseOffset reads date +%z', () => {
  expect(parseOffset('-0500\n')).toBe(-300)
  expect(parseOffset('+0530')).toBe(330)
  expect(parseOffset('+0000')).toBe(0)
  expect(parseOffset('EST')).toBe(null)
})

test('localClock shows HH:MM today, weekday + HH:MM on another day', () => {
  const now = Date.parse('2026-10-09T16:40:00Z') // Fri 11:40 at UTC-5
  expect(localClock(Date.parse('2026-10-09T19:10:00Z'), -300, now)).toBe('14:10')
  expect(localClock(Date.parse('2026-10-14T17:30:00Z'), -300, now)).toBe('Wed 12:30')
  // 03:00Z on the 10th is still the 9th at UTC-5.
  expect(localClock(Date.parse('2026-10-10T03:00:00Z'), -300, now)).toBe('22:00')
})

test('meters add the local reset time in parentheses when the offset is known', () => {
  const now = Date.parse('2026-10-09T16:40:00Z')
  const usage = {
    rateLimits: [
      { kind: 'five_hour', percentUsed: 16, resetsAt: '2026-10-09T19:10:00Z' },
      { kind: 'seven_day', percentUsed: 3, resetsAt: '2026-10-14T17:30:00Z' },
    ],
  }
  expect(meters(usage, now, -300).map(m => m.note)).toEqual([
    ' ↻ 2h30m (14:10)',
    ' ↻ 5d0h (Wed 12:30)',
  ])
  expect(meters(usage, now, null).map(m => m.note)).toEqual([' ↻ 2h30m', ' ↻ 5d0h'])
})

const row = (id: string, status: string, done: boolean, elapsedMs = 1000) => ({
  id,
  type: 'Explore',
  description: id,
  status,
  elapsedMs,
  done,
})

test('mergeRows keeps finished subagents after the engine drops them', () => {
  const prev = [row('A', 'completed', true), row('B', 'running', false, 4000)]
  // Engine now lists only C: A stays as is, B (last seen running) is
  // finalized as completed with its elapsed time frozen, C is appended.
  const merged = mergeRows(prev, [row('C', 'running', false)])
  expect(merged.map(r => [r.id, r.status, r.done])).toEqual([
    ['A', 'completed', true],
    ['B', 'completed', true],
    ['C', 'running', false],
  ])
  expect(merged[1]?.elapsedMs).toBe(4000)
})

test('mergeRows takes the fresh row for agents still listed', () => {
  const merged = mergeRows([row('A', 'running', false, 1000)], [row('A', 'completed', true, 2000)])
  expect(merged).toEqual([row('A', 'completed', true, 2000)])
})

test('displayRows: running first, then finished newest first', () => {
  const list = [row('A', 'completed', true), row('B', 'running', false), row('C', 'failed', true)]
  expect(displayRows(list).map(r => r.id)).toEqual(['B', 'C', 'A'])
})

test('versionLabel prefers the release base over a long development version', () => {
  expect(versionLabel({ version: '2.1.296', base: '2.1.296' })).toBe('2.1.296')
  expect(
    versionLabel({ version: '2.1.296-dev.20260920.t101500.sha1a2b3c4', base: '2.1.296-dev' }),
  ).toBe('2.1.296-dev')
  expect(versionLabel({ version: 'local' })).toBe('local')
  expect(versionLabel({ version: '2.1\u001b[31m.296' })).toBe('2.1[31m.296')
})

test('claudePaths follows CLAUDE_CONFIG_DIR, else the home defaults', () => {
  expect(claudePaths('/home/myuser', undefined)).toEqual({
    config: '/home/myuser/.claude.json',
    projects: '/home/myuser/.claude/projects',
    settings: '/home/myuser/.claude/settings.json',
  })
  expect(claudePaths('/home/myuser', '')).toEqual({
    config: '/home/myuser/.claude.json',
    projects: '/home/myuser/.claude/projects',
    settings: '/home/myuser/.claude/settings.json',
  })
  expect(claudePaths('/home/myuser', '/tmp/profile/')).toEqual({
    config: '/tmp/profile/.claude.json',
    projects: '/tmp/profile/projects',
    settings: '/tmp/profile/settings.json',
  })
})

test('claudePaths expands a leading ~ in CLAUDE_CONFIG_DIR with home', () => {
  expect(claudePaths('/home/myuser', '~/profile')).toEqual({
    config: '/home/myuser/profile/.claude.json',
    projects: '/home/myuser/profile/projects',
    settings: '/home/myuser/profile/settings.json',
  })
  expect(claudePaths('/home/myuser', '~')).toEqual({
    config: '/home/myuser/.claude.json',
    projects: '/home/myuser/projects',
    settings: '/home/myuser/settings.json',
  })
  // Only a leading `~/` or a bare `~` is a home reference.
  expect(claudePaths('/home/myuser', '/tmp/~x').config).toBe('/tmp/~x/.claude.json')
})

test('accountLabel shows user@Org, or only the email user without an organization', () => {
  const file = (account: unknown) => JSON.stringify({ projects: {}, oauthAccount: account })
  expect(accountLabel(file({ emailAddress: 'user.one@example.com', organizationName: 'Example Org' }))).toBe(
    'user.one@Example Org',
  )
  // No organization: the domain is never shown.
  expect(accountLabel(file({ emailAddress: 'user.one@example.com' }))).toBe('user.one')
  expect(accountLabel(file({ emailAddress: 'user.one@example.com', organizationName: '  ' }))).toBe('user.one')
  expect(accountLabel(file(undefined))).toBe(null)
  expect(accountLabel('not json')).toBe(null)
})

test('clean strips C0/C1 control characters and keeps other text', () => {
  expect(clean('a\u001b[31mred\u001b[0m')).toBe('a[31mred[0m')
  expect(clean('two\nlines\r')).toBe('twolines')
  expect(clean('bell\u0007 tab\t del\u007f c1\u009b')).toBe('bell tab del c1')
  expect(clean('café · 日本 🤖 ✓')).toBe('café · 日本 🤖 ✓')
})

test('external strings are cleaned where they enter', () => {
  const esc = '\u001b]0;x\u0007'
  expect(parseTitle(JSON.stringify({ customTitle: `my${esc}title` }))).toBe('my]0;xtitle')
  expect(accountLabel(JSON.stringify({ oauthAccount: { emailAddress: 'a\nb@example.com', organizationName: 'Ex\u001bOrg' } }))).toBe(
    'ab@ExOrg',
  )
  const [row] = buildRows([{ id: 'X', type: 'Expl\u001bore', description: 'map\nrepo', status: 'running' }], new Map(), 0)
  expect([row?.type, row?.description]).toEqual(['Explore', 'maprepo'])
  const [w] = fromTodoWrite([{ content: 'do\u001bit', activeForm: 'doing\nit', status: 'pending' }])
  expect([w?.content, w?.activeForm]).toEqual(['doit', 'doingit'])
  const [t] = addTask([], '1', 'new\u0007task', 'adding\u009b')
  expect([t?.content, t?.activeForm]).toEqual(['newtask', 'adding'])
  const [u] = updateTask(addTask([], '1', 'x'), { taskId: '1', subject: 'y\u001bz', activeForm: 'a\nb' })
  expect([u?.content, u?.activeForm]).toEqual(['yz', 'ab'])
  expect(mcpServers([{ name: 'mcp__ev\u001bil__tool', mcp: true }])).toEqual([{ name: 'evil', connected: true }])
})

test('shortPath keeps first and last segments, collapsing the middle to ..', () => {
  const home = '/home/myuser'
  const cwd = '/home/myuser/.claude/dev-mods/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/session-explorer'
  const show = (max: number) => {
    const { parent, leaf } = shortPath(cwd, home, max)
    return parent + leaf
  }
  expect(show(80)).toBe('myuser/.claude/dev-mods/0a1b2c3d…/session-explorer')
  expect(show(45)).toBe('myuser/../dev-mods/0a1b2c3d…/session-explorer')
  expect(show(35)).toBe('myuser/../../../session-explorer')
  expect(show(26)).toBe('myuser/../../../session-..')
  expect(shortPath(cwd, home, 80).leaf).toBe('session-explorer')
})

test('shortPath handles home itself, the root and paths outside home', () => {
  expect(shortPath('/home/myuser', '/home/myuser', 40)).toEqual({ parent: '', leaf: 'myuser' })
  expect(shortPath('/', '/home/myuser', 40)).toEqual({ parent: '', leaf: '/' })
  expect(shortPath('/var/log/nginx', '/home/myuser', 40)).toEqual({ parent: '/var/log/', leaf: 'nginx' })
  expect(shortPath('/var/log/nginx', null, 13)).toEqual({ parent: '/var/../', leaf: 'nginx' })
  expect(shortPath('/var/log/nginx', null, 12)).toEqual({ parent: '/var/../', leaf: 'ng..' })
})

test('parseShortstat reads insertions and deletions, null when clean', () => {
  expect(parseShortstat('')).toBe(null)
  expect(parseShortstat('\n')).toBe(null)
  expect(parseShortstat(' 3 files changed, 42 insertions(+), 7 deletions(-)\n')).toEqual({ added: 42, removed: 7 })
  expect(parseShortstat(' 1 file changed, 3 insertions(+)\n')).toEqual({ added: 3, removed: 0 })
  expect(parseShortstat(' 2 files changed, 5 deletions(-)\n')).toEqual({ added: 0, removed: 5 })
  expect(parseShortstat(' 1 file changed, 1 insertion(+), 1 deletion(-)\n')).toEqual({ added: 1, removed: 1 })
  // A mode-only change counts no lines: nothing to show.
  expect(parseShortstat(' 1 file changed\n')).toBe(null)
  expect(parseShortstat('fatal: bad revision HEAD')).toBe(null)
})

test('outputStyleFrom follows settings precedence: local, project, then user', () => {
  const s = (outputStyle: unknown) => JSON.stringify({ model: 'opus', outputStyle })
  expect(outputStyleFrom(s('Learning'), s('Explanatory'), s('Gentleman'))).toBe('Learning')
  expect(outputStyleFrom(undefined, s('Explanatory'), s('Gentleman'))).toBe('Explanatory')
  expect(outputStyleFrom(null, '{}', s('Gentleman'))).toBe('Gentleman')
  expect(outputStyleFrom(undefined, undefined, undefined)).toBe(null)
})

test('outputStyleFrom keeps only a string outputStyle, cleaned, and hides the default', () => {
  const s = (outputStyle: unknown) => JSON.stringify({ outputStyle })
  // A non-string or unparsable file is skipped, not taken as "no style".
  expect(outputStyleFrom(s(42), 'not json', s('Gentleman'))).toBe('Gentleman')
  expect(outputStyleFrom(s({ name: 'x' }), s(null), s(['a']))).toBe(null)
  expect(outputStyleFrom(s('Gentle\u001b[31mman\n'))).toBe('Gentle[31mman')
  expect(outputStyleFrom(s('  '), s('Learning'))).toBe('Learning')
  expect(outputStyleFrom(s('default'))).toBe(null)
  expect(outputStyleFrom(s('Default'), s('Learning'))).toBe(null)
})
