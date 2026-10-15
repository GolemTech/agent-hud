import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { filterServers, isMcpFilter, MCP_AUTH_HINT, mcpBodyRows, mcpEmptyText, mcpHiddenText } from './mcp'

const SERVERS = [
  { name: 'engram', connected: true },
  { name: 'context7', connected: true },
  { name: 'notes', connected: false },
  { name: 'drive', connected: false },
]

test('filterServers keeps every server under all', () => {
  expect(filterServers(SERVERS, 'all')).toEqual({ shown: SERVERS, hidden: 0 })
})

test('filterServers keeps only connected servers under active and counts the rest', () => {
  expect(filterServers(SERVERS, 'active')).toEqual({ shown: SERVERS.slice(0, 2), hidden: 2 })
  expect(filterServers(SERVERS.slice(2), 'active')).toEqual({ shown: [], hidden: 2 })
  expect(filterServers([], 'active')).toEqual({ shown: [], hidden: 0 })
})

test('isMcpFilter accepts only the two modes', () => {
  expect(isMcpFilter('all')).toBe(true)
  expect(isMcpFilter('active')).toBe(true)
  for (const bad of [undefined, null, '', 'ACTIVE', 'none', 1]) expect(isMcpFilter(bad)).toBe(false)
})

test('the empty and hidden lines, and the auth hint', () => {
  expect(MCP_AUTH_HINT).toBe(' · auth · /mcp')
  expect(mcpEmptyText(0)).toBe('none connected')
  expect(mcpEmptyText(2)).toBe('no active servers · 2 hidden')
  expect(mcpHiddenText(1)).toBe('1 hidden')
})

test('mcpBodyRows counts the drawn rows: servers, the hidden line, or the empty line', () => {
  expect(mcpBodyRows(4, 0)).toBe(4)
  expect(mcpBodyRows(2, 2)).toBe(3)
  expect(mcpBodyRows(0, 2)).toBe(1)
  expect(mcpBodyRows(0, 0)).toBe(1)
})

// ── Wiring ───────────────────────────────────────────────────────────────

const HOME = '/home/myuser'
const CWD = `${HOME}/code/example`

// `engram` is connected; `notes` only offers the auth handshake.
const TOOLS = [
  { name: 'mcp__engram__mem_save', mcp: true },
  { name: 'mcp__notes__authenticate', mcp: true },
]

const answerEngine = (on: On, store: Record<string, unknown> = {}, tools = TOOLS) => {
  mock.clock(on)
  mock.env(on, { HOME })
  mock.store(on, store)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () =>
    ({ value: [{ id: 'hud', title: 'hud', isShown: true, isFocused: false, isPlaced: true }] }) as never,
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.id', () => ({ value: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }) as never)
  on('session.root', () => ({ value: CWD }) as never)
  on('session.cwd', () => ({ value: CWD }) as never)
  on('session.repo', () => ({ value: { root: CWD, remote: null } }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.version', () => ({ value: { version: '2.1.296', base: '2.1.296' } }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 55 } } }) as never)
  on('tool.list', () => ({ value: tools }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('fs.read', () => ({ value: '{}' }) as never)
  on('fs.exists', () => ({ value: false }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }) as never)
  on('process.run', () => ({ value: { stdout: 'main\n', stderr: '', exitCode: 0 } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
}

const startSession = ($: Engine) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)

const mountPane = async ($: Engine) => {
  const pane = await $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'hud',
    props: { title: 'Agent HUD', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })
  return { pane, drawn: async () => JSON.stringify(await pane.drawn()) }
}

test('the MCP filter shows every server by default, with the all button selected', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const { drawn } = await mountPane($)
  const tree = await drawn()
  expect(tree).toContain('engram')
  expect(tree).toContain('notes')
  expect(tree).toContain('mcp-filter-active')
  expect(tree).toContain('[● all]')
  expect(tree).toContain('[active]')
})

test('active hides servers needing auth, persists across a new session, and all restores them', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const { pane, drawn } = await mountPane($)

  await pane.press({ key: 'mcp-filter-active' })
  const active = await drawn()
  expect(active).toContain('engram')
  expect(active).not.toContain('notes')
  expect(active).toContain('1 hidden')
  expect(active).toContain('[● active]')

  // A new session loads the choice from the store.
  await startSession($)
  expect(await drawn()).not.toContain('notes')

  await pane.press({ key: 'mcp-filter-all' })
  const all = await drawn()
  expect(all).toContain('notes')
  expect(all).not.toContain('hidden')
})

test('active with no connected server draws the empty line with the hidden count', async ($, on) => {
  answerEngine(on, { mcpFilter: 'active' }, [{ name: 'mcp__notes__authenticate', mcp: true }])
  await startSession($)
  const { drawn } = await mountPane($)
  const tree = await drawn()
  expect(tree).toContain('no active servers · 1 hidden')
  expect(tree).not.toContain('notes')
})

test('an unknown stored filter falls back to all', async ($, on) => {
  answerEngine(on, { mcpFilter: 'bogus' })
  await startSession($)
  const { drawn } = await mountPane($)
  expect(await drawn()).toContain('notes')
})

test('a server waiting on auth names /mcp, where to sign in, on its one truncating row', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const { pane } = await mountPane($)
  type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const textOf = (n: unknown): string =>
    typeof n === 'string' || typeof n === 'number'
      ? String(n)
      : typeof n === 'object' && n !== null
        ? ((n as Node).children ?? []).map(textOf).join('')
        : ''
  const rows: Node[] = []
  const walk = (n: unknown) => {
    if (typeof n !== 'object' || n === null) return
    const node = n as Node
    if (node.type === 'Text' && node.props?.wrap === 'truncate-end' && node.props && 'dimColor' in node.props) rows.push(node)
    else for (const c of node.children ?? []) walk(c)
  }
  walk(await pane.drawn())
  expect(rows.map(textOf)).toEqual(['● engram', '○ notes · auth · /mcp'])
})
