import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { FOOTER_ROWS, HEADER_ROWS } from './layout'
import { projectName } from './register'
import { SETTINGS_BUTTON, SETTINGS_KEY, sectionKey } from './settings'
import type { SectionId } from './settings'
import { SUBAGENT_WINDOW, TODO_WINDOW } from './windows'

// The sticky header and footer: the Pane is drawn at exactly its body's
// height, the sections scroll inside a clipped viewport by the plugin's own
// offset (moved by `ui.scroll`), and the header and footer stay put.

const HOME = '/home/myuser'
const REPO = `${HOME}/code/mono-repo`
const CWD = `${REPO}/pkg/web`
let repoRoot: string | null = REPO
// The subagents `$.agent.list()` answers; none unless a test sets some.
let liveAgents: { id: string; type: string; description: string; status: string }[] = []

const answerEngine = (on: On) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME })
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () =>
    ({ value: [{ id: 'hud', title: 'hud', isShown: true, isFocused: false, isPlaced: true }] }) as never,
  )
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.id', () => ({ value: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }) as never)
  on('session.root', () => ({ value: CWD }) as never)
  on('session.cwd', () => ({ value: CWD }) as never)
  on('session.repo', () => ({ value: repoRoot ? { root: repoRoot, remote: null } : null }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.version', () => ({ value: { version: '2.1.296', base: '2.1.296' } }) as never)
  on('session.usage', () => ({ value: { startedAt: 0 } }) as never)
  on('tool.list', () => ({ value: [] }) as never)
  on('agent.list', () => ({ value: liveAgents }) as never)
  on('fs.read', () => {
    throw new Error('no such file')
  })
  on('fs.exists', () => ({ value: false }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }) as never)
  on('process.run', () => ({ value: { stdout: '+0000\n', stderr: '', exitCode: 0 } }) as never)
  // The engine's own move, beneath the plugin's observer: the window moved.
  on('ui.scroll', () => ({}) as never)
  return clock
}

const paneProps = (bodyRows: number, placement = 'dock') =>
  ({ title: 'Agent HUD', isFocused: false, bodyColumns: 60, placement, scroll: { offset: 0, bodyRows } }) as never

const start = async ($: Engine, on: On, demo: boolean) => {
  const clock = answerEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  if (demo) {
    await $.command.run({ command: 'hud-demo', args: '' } as never)
    await clock.advance(6000)
  }
  return clock
}

const mount = ($: Engine, bodyRows: number, placement = 'dock') =>
  $.ui.mount({ plugin: 'agent-hud', surface: 'terminal', component: 'Pane', requestId: 'hud', props: paneProps(bodyRows, placement) })

// A person's wheel or scroll key over the Pane, as the engine raises it.
const scroll = ($: Engine, by: number, bodyRows: number) =>
  $.ui.scroll({ component: 'Pane', requestId: 'hud', offset: 0, by, bodyRows, contentRows: bodyRows, origin: { kind: 'person' } } as never)

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null
const textOf = (n: unknown): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n) : isNode(n) ? (n.children ?? []).map(textOf).join('') : ''
const elements = (n: Node): Node[] => (n.children ?? []).filter(isNode)
const all = (n: unknown, type: string, out: Node[] = []): Node[] => {
  if (!isNode(n)) return out
  if (n.type === type) out.push(n)
  for (const c of n.children ?? []) all(c, type, out)
  return out
}

// The drawn root and its three parts: header, clipped viewport, footer.
const parts = async (pane: { drawn: () => Promise<unknown> }) => {
  const root = (await pane.drawn()) as Node
  const [header, viewport, footer] = elements(root)
  const content = elements(viewport as Node)[0]
  return { root, header: header as Node, viewport: viewport as Node, content: content as Node, footer: footer as Node }
}

const leaveDemo = ($: Engine) => $.command.run({ command: 'hud-demo', args: '' } as never)

test('projectName: the last path segment', () => {
  expect(projectName('/home/myuser/code/mono-repo')).toBe('mono-repo')
  expect(projectName('/home/myuser/code/mono-repo/')).toBe('mono-repo')
  expect(projectName('/')).toBe('/')
  expect(projectName('~/…')).toBe('…')
})

test('the Pane is drawn at its body height: header, clipped viewport, footer', async ($, on) => {
  await start($, on, true)
  try {
    const p = await parts(await mount($, 24))
    expect(p.root.props?.height).toBe(24)
    expect(elements(p.root).length).toBe(3)
    expect(p.viewport.props?.overflow).toBe('hidden')
    expect(p.viewport.props?.height).toBe(24 - HEADER_ROWS - FOOTER_ROWS)
    expect(p.content.props?.marginTop).toBe(0)
    // The header names the project and holds one Button: the settings button (the
    // engine's own close mark on the frame closes the sidebar).
    expect(textOf(p.header)).toContain('api')
    const buttons = all(p.header, 'Button')
    expect(buttons.length).toBe(1)
    expect(JSON.stringify(buttons[0])).toContain(`"key":"${SETTINGS_KEY}"`)
    expect(JSON.stringify(p.header)).not.toContain('hide-sidebar')
    // The name is a centered band: inverse, padded evenly on both sides.
    const band = all(p.header, 'Text').find(t => t.props?.inverse === true)
    expect(band).toBeDefined()
    const label = textOf(band)
    expect(label.trim()).toBe('📂 api')
    const left = label.length - label.trimStart().length
    const right = label.length - label.trimEnd().length
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1)
    expect(left).toBeGreaterThan(1)
    // The settings button sits inside the band: drawn inverse with no gap,
    // and a blank row separates the band from Session.
    const settings = buttons[0]
    expect(textOf(settings)).toBe(SETTINGS_BUTTON)
    expect(all(settings, 'Text').some(t => t.props?.inverse === true)).toBe(true)
    expect(p.header.props?.marginBottom).toBe(1)
    expect(HEADER_ROWS).toBe(2)
    expect(textOf(p.viewport)).not.toContain('📂')
    // The footer is last and holds the version.
    expect(textOf(p.footer)).toContain('2.1.296')
    expect(textOf(p.viewport)).not.toContain('2.1.296')
  } finally {
    await leaveDemo($)
  }
})

test('a scroll moves the content behind the sticky header and footer, clamped to the end', async ($, on) => {
  await start($, on, true)
  try {
    const pane = await mount($, 24)
    await scroll($, 3, 24)
    expect((await parts(pane)).content.props?.marginTop).toBe(-3)

    // Far past the end: the last offset leaves the bottom margin.
    await scroll($, 10_000, 24)
    const end = Number((await parts(pane)).content.props?.marginTop)
    expect(end).toBeLessThan(-3)
    await scroll($, 5, 24)
    expect((await parts(pane)).content.props?.marginTop).toBe(end)

    // Back past the top: offset 0.
    await scroll($, -10_000, 24)
    const top = await parts(pane)
    expect(top.content.props?.marginTop).toBe(0)
    expect(textOf(top.footer)).toContain('2.1.296')
    expect(textOf(top.header)).toContain('api')
  } finally {
    await leaveDemo($)
  }
})

test('a taller pane shrinks the end offset; a collapsed section clamps it', async ($, on) => {
  await start($, on, true)
  try {
    const pane = await mount($, 24)
    await scroll($, 10_000, 24)
    const short = Number((await parts(pane)).content.props?.marginTop)
    await pane.redraw(paneProps(40))
    const tall = Number((await parts(pane)).content.props?.marginTop)
    expect(tall).toBeGreaterThan(short)
    // Collapse every section: the content fits, so it is drawn from the top.
    for (const id of ['session', 'context', 'mcp', 'subagents', 'todos', 'gentle'])
      await pane.press({ key: `toggle-${id}` } as never)
    expect((await parts(pane)).content.props?.marginTop).toBe(0)
    for (const id of ['session', 'context', 'mcp', 'subagents', 'todos', 'gentle'])
      await pane.press({ key: `toggle-${id}` } as never)
  } finally {
    await leaveDemo($)
  }
})

test('content that fits never scrolls', async ($, on) => {
  await start($, on, false)
  const pane = await mount($, 200)
  await scroll($, 5, 200)
  expect((await parts(pane)).content.props?.marginTop).toBe(0)
})

test('the header names the repository root', async ($, on) => {
  await start($, on, false)
  expect(textOf((await parts(await mount($, 40))).header)).toContain('mono-repo')
})

test('outside a repository, the header names the working directory', async ($, on) => {
  repoRoot = null
  try {
    await start($, on, false)
    const header = textOf((await parts(await mount($, 40))).header)
    expect(header).toContain('web')
    expect(header).not.toContain('mono-repo')
  } finally {
    repoRoot = REPO
  }
})

test('privacy mode masks the project name in the header', async ($, on) => {
  await start($, on, false)
  const pane = await mount($, 40)
  await $.command.run({ command: 'hud-private', args: '' } as never)
  try {
    const header = textOf((await parts(pane)).header)
    expect(header).toContain('…')
    expect(header).toContain('🔒 📂 …')
    expect(header).not.toContain('mono-repo')
  } finally {
    await $.command.run({ command: 'hud-private', args: '' } as never)
  }
})

test('an inline Pane keeps the plain flow: no fixed height, no viewport', async ($, on) => {
  await start($, on, false)
  const root = (await (await mount($, 24, 'inline')).drawn()) as Node
  expect(root.props?.height).toBe(undefined)
  expect(all(root, 'Box').some(b => b.props?.overflow === 'hidden')).toBe(false)
  expect(textOf(root)).toContain('mono-repo')
  expect(textOf(root)).toContain('2.1.296')
})

// ── List windows ─────────────────────────────────────────────────────────
// Long Subagents and Todo lists draw in fixed windows of their own: a wheel
// tick over a list's rows scrolls the list, any other tick the Pane.


const answerLists = (on: On) => {
  const clock = answerEngine(on)
  mock.store(on, {})
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: {} }) as never)
  return clock
}

type Status = 'pending' | 'in_progress' | 'completed'
// `n` todos, `active` in progress, those before it done, the rest pending.
const todoList = (n: number, active: number, text = (i: number) => `task ${i}`) =>
  Array.from({ length: n }, (_, i) => ({
    content: text(i),
    activeForm: text(i),
    status: (i < active ? 'completed' : i === active ? 'in_progress' : 'pending') as Status,
  }))
const writeTodos = ($: Engine, list: ReturnType<typeof todoList>) =>
  $.tool.call({ tool: 'TodoWrite', todos: list } as never)

const listProps = (bodyColumns: number, bodyRows: number) =>
  ({ title: 'Agent HUD', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows } }) as never

// Only `keep` drawn: every other section hidden through the settings block.
const showOnly = async (pane: { press: (t: { key: string }) => Promise<unknown> }, keep: string) => {
  await pane.press({ key: SETTINGS_KEY })
  for (const id of ['session', 'context', 'mcp', 'subagents', 'todos', 'gentle'])
    if (id !== keep) await pane.press({ key: sectionKey(id as SectionId) })
  await pane.press({ key: 'settings-close' })
}

// A wheel tick over a body row, as the engine raises it.
const wheelAt = ($: Engine, by: number, row: number, bodyRows: number) =>
  $.ui.scroll({
    component: 'Pane',
    requestId: 'hud',
    offset: 0,
    by,
    bodyRows,
    contentRows: bodyRows,
    origin: { kind: 'person' },
    pointer: { column: 3, row },
  } as never)

// The window of a list: the clipped Box holding its items, and the
// indicator lines right before and after it.
const listWindow = (tree: unknown, height: number) => {
  // The last match: the Pane's own viewport (first in draw order) can share the height.
  const box = all(tree, 'Box').filter(b => b.props?.overflow === 'hidden' && b.props?.height === height).at(-1)
  if (!box) return null
  const parent = all(tree, 'Box').find(b => elements(b).includes(box)) as Node
  const kids = elements(parent)
  const i = kids.indexOf(box)
  return { box, items: elements(box).map(textOf), up: textOf(kids[i - 1]), down: textOf(kids[i + 1]) }
}

const startLists = async ($: Engine, on: On, bodyColumns: number, bodyRows: number, keep: string) => {
  const clock = answerLists(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  const pane = await $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'hud',
    props: listProps(bodyColumns, bodyRows),
  })
  await showOnly(pane, keep)
  return { clock, pane }
}

test('a short todo list draws as before: no window, no indicators', async ($, on) => {
  const { pane } = await startLists($, on, 60, 40, 'todos')
  await writeTodos($, todoList(3, 1))
  const tree = await pane.drawn()
  expect(listWindow(tree, TODO_WINDOW)).toBe(null)
  expect(textOf(tree)).not.toContain('more')
  const section = all(tree, 'Box')
    .filter(b => JSON.stringify(b).includes('toggle-todos') && b.props?.flexDirection === 'column')
    .at(-1) as Node
  // The header row, then one Text per todo, as it always drew.
  expect(elements(section).slice(1).map(n => n.type)).toEqual(['Text', 'Text', 'Text'])
})

test('a long todo list draws in a window of TODO_WINDOW rows with the hidden items named', async ($, on) => {
  const { pane } = await startLists($, on, 60, 40, 'todos')
  await writeTodos($, todoList(20, -1))
  const w = listWindow(await pane.drawn(), TODO_WINDOW)
  expect(w?.items).toEqual(Array.from({ length: TODO_WINDOW }, (_, i) => `[ ] task ${i}`))
  expect(w?.up.trim()).toBe('')
  expect(w?.down).toBe(`↓ ${20 - TODO_WINDOW} more`)
})

test('the wheel over the todo list moves the list, not the Pane; elsewhere it moves the Pane', async ($, on) => {
  // 10 body rows: a 6-row viewport under the header, the list's 8 rows overflow it.
  const { pane } = await startLists($, on, 60, 10, 'todos')
  await writeTodos($, todoList(20, -1))
  await pane.drawn() // the engine draws before the person can wheel over it
  const listTop = HEADER_ROWS + 1 // under the Todo header
  await wheelAt($, 2, listTop + 4, 10)
  let p = await parts(pane)
  expect(listWindow(p.root, TODO_WINDOW)?.up).toBe('↑ 2 more')
  expect(p.content.props?.marginTop).toBe(0)
  // Over the section header: the Pane moves, the list stays.
  await wheelAt($, 1, HEADER_ROWS, 10)
  p = await parts(pane)
  expect(p.content.props?.marginTop).toBe(-1)
  expect(listWindow(p.root, TODO_WINDOW)?.up).toBe('↑ 2 more')
  // The list moved up a row with the Pane: its top indicator is now on the
  // header's old row, and a tick there moves the list again.
  await wheelAt($, 1, HEADER_ROWS, 10)
  p = await parts(pane)
  expect(p.content.props?.marginTop).toBe(-1)
  expect(listWindow(p.root, TODO_WINDOW)?.up).toBe('↑ 3 more')
  // A scroll key (no pointer) moves the Pane.
  await scroll($, 1, 10)
  expect((await parts(pane)).content.props?.marginTop).toBe(-2)
})

test('the todo window follows the item in progress', async ($, on) => {
  const { pane } = await startLists($, on, 60, 40, 'todos')
  await writeTodos($, todoList(20, 12))
  let w = listWindow(await pane.drawn(), TODO_WINDOW)
  expect(w?.items.at(-1)).toBe('[ ] task 12')
  expect(w?.up).toBe(`↑ ${12 - TODO_WINDOW + 1} more`)
  await writeTodos($, todoList(20, 13))
  w = listWindow(await pane.drawn(), TODO_WINDOW)
  expect(w?.items.at(-1)).toBe('[ ] task 13')
  expect(w?.up).toBe(`↑ ${13 - TODO_WINDOW + 1} more`)
})

test('a wheel move stops the follow until another item is in progress', async ($, on) => {
  const { pane } = await startLists($, on, 60, 40, 'todos')
  const following = 13 - TODO_WINDOW + 1 // the least move that shows task 13
  await writeTodos($, todoList(20, 13))
  expect(listWindow(await pane.drawn(), TODO_WINDOW)?.up).toBe(`↑ ${following} more`)
  await wheelAt($, -3, HEADER_ROWS + 3, 40)
  expect(listWindow(await pane.drawn(), TODO_WINDOW)?.up).toBe(`↑ ${following - 3} more`)
  // The same item in progress: the window stays where the wheel left it.
  await writeTodos($, todoList(20, 13))
  expect(listWindow(await pane.drawn(), TODO_WINDOW)?.up).toBe(`↑ ${following - 3} more`)
  // The next one: the follow is back, with the least move.
  await writeTodos($, todoList(20, 14))
  const w = listWindow(await pane.drawn(), TODO_WINDOW)
  expect(w?.items.at(-1)).toBe('[ ] task 14')
  expect(w?.up).toBe(`↑ ${following + 1} more`)
})

test('a long subagent list draws in a window of SUBAGENT_WINDOW rows, whole cards only', async ($, on) => {
  liveAgents = Array.from({ length: 5 }, (_, i) => ({ id: `win-a${i}`, type: 'Explore', description: `job ${i}`, status: 'running' }))
  try {
    const { pane, clock } = await startLists($, on, 60, 40, 'subagents')
    await clock.advance(1000)
    const w = listWindow(await pane.drawn(), SUBAGENT_WINDOW)
    // Cards with no model are 3 rows: four fit in 12.
    expect(w?.items.map(s => s.slice(0, 7))).toEqual(['● job 0', '● job 1', '● job 2', '● job 3'])
    expect(w?.down).toBe('↓ 1 more')
    await wheelAt($, 1, HEADER_ROWS + 2 + 3, 40) // header, tally, then the list
    expect(listWindow(await pane.drawn(), SUBAGENT_WINDOW)?.up).toBe('↑ 1 more')
  } finally {
    liveAgents = []
  }
})

// The section's rows as counted: collapsing it drops its body, so the end
// offset falls by exactly the rows the body draws.
for (const [cols, rows] of [
  [60, 10],
  [20, 10],
  [100, 8],
] as const) {
  test(`at ${cols}x${rows}, the windowed todo list is counted as drawn`, async ($, on) => {
    const { pane } = await startLists($, on, cols, rows, 'todos')
    await writeTodos($, todoList(20, -1, i => `a todo long enough to wrap ${i}`))
    const tree = await pane.drawn()
    const w = listWindow(tree, TODO_WINDOW)
    expect(w).not.toBe(null)
    await scroll($, 10_000, rows)
    const open = 0 - Number((await parts(pane)).content.props?.marginTop)
    await pane.press({ key: 'toggle-todos' } as never)
    const shut = 0 - Number((await parts(pane)).content.props?.marginTop)
    const viewport = rows - HEADER_ROWS - FOOTER_ROWS
    // Header plus window plus indicators, against the viewport and margin.
    expect(open).toBe(1 + TODO_WINDOW + 2 - viewport + 1)
    expect(shut).toBe(0)
  })
}

test('a new session puts the list windows back at the top, following', async ($, on) => {
  const { pane, clock } = await startLists($, on, 60, 40, 'todos')
  await writeTodos($, todoList(20, -1))
  await pane.drawn()
  await wheelAt($, 5, HEADER_ROWS + 3, 40)
  expect(listWindow(await pane.drawn(), TODO_WINDOW)?.up).toBe('↑ 5 more')
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  expect(listWindow(await pane.drawn(), TODO_WINDOW)?.up.trim()).toBe('')
})

test('in demo mode the wheel scrolls the subagent window too', async ($, on) => {
  const { pane, clock } = await startLists($, on, 60, 40, 'subagents')
  await $.command.run({ command: 'hud-demo', args: '' } as never)
  try {
    await clock.advance(6000)
    expect(listWindow(await pane.drawn(), SUBAGENT_WINDOW)?.down).toBe('↓ 1 more')
    await wheelAt($, 1, HEADER_ROWS + 2 + 1, 40)
    const w = listWindow(await pane.drawn(), SUBAGENT_WINDOW)
    expect(w?.up).toBe('↑ 1 more')
    expect(w?.down.trim()).toBe('')
  } finally {
    await leaveDemo($)
  }
})
