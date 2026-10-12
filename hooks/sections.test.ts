import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { CARD_ROWS, layoutFor, SCROLL_BOTTOM_MARGIN, textRows, viewportRowsFor } from './layout'
import { ALL_HIDDEN_TEXT, checkText, SECTION_IDS, sectionKey, SETTINGS_CLOSE, SETTINGS_KEY, settingsRows } from './settings'
import type { SectionId } from './settings'

const HOME = '/home/myuser'
const CWD = `${HOME}/code/example`

// The engine's bottom for the poller, the Pane, the band and the scroll.
// `ui.panes` lists no pane, so the band always draws. With `failedSaves`,
// `$.store.set` records the key it was asked to write there and throws.
const answerEngine = (on: On, store: Record<string, unknown> = {}, failedSaves: string[] | null = null) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME })
  if (failedSaves) {
    on('store.get', () => ({ value: undefined }) as never)
    on('store.set', (_$, e) => {
      failedSaves.push(e.key)
      throw new Error('store unavailable')
    })
  } else {
    mock.store(on, store)
  }
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.scroll', () => ({}) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.id', () => ({ value: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }) as never)
  on('session.root', () => ({ value: CWD }) as never)
  on('session.cwd', () => ({ value: CWD }) as never)
  on('session.repo', () => ({ value: { root: CWD, remote: null } }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.version', () => ({ value: { version: '2.1.296', base: '2.1.296' } }) as never)
  on('session.usage', () =>
    ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 55 }, rateLimits: [] } }) as never,
  )
  on('tool.list', () => ({ value: [{ name: 'mcp__engram__mem_save', mcp: true }] }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('fs.read', () => ({ value: '{}' }) as never)
  on('fs.exists', () => ({ value: false }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }) as never)
  on('process.run', () => ({ value: { stdout: 'main\n', stderr: '', exitCode: 0 } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return clock
}

const startSession = ($: Engine) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)

const mountSticky = ($: Engine, bodyColumns = 60, bodyRows = 24) =>
  $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'hud',
    props: { title: 'Agent HUD', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows } } as never,
  })

const scroll = ($: Engine, by: number, bodyRows: number) =>
  $.ui.scroll({ component: 'Pane', requestId: 'hud', offset: 0, by, bodyRows, contentRows: bodyRows, origin: { kind: 'person' } } as never)

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
type Pane = { drawn: () => Promise<unknown>; press: (target: { key: string }) => Promise<unknown> }
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
// The sticky layout: root → [header, viewport, footer]; viewport → [content].
const headerOf = (root: unknown): Node => elements(root as Node)[0] as Node
const contentBox = (root: unknown): Node => elements(elements(root as Node)[1] as Node)[0] as Node
const endOffset = async (pane: Pane, $: Engine, bodyRows: number) => {
  await pane.drawn()
  await scroll($, 10_000, bodyRows)
  return -Number(contentBox(await pane.drawn()).props?.marginTop)
}
const drawnText = async (pane: Pane) => JSON.stringify(await pane.drawn())

// Opens the block, presses each check, closes the block.
const toggle = async (pane: Pane, ...ids: SectionId[]) => {
  await pane.press({ key: SETTINGS_KEY })
  for (const id of ids) await pane.press({ key: sectionKey(id) })
  await pane.press({ key: SETTINGS_CLOSE })
}

const mountBand = ($: Engine) =>
  $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 80 } as never,
  })

const inDemo = async ($: Engine, clock: { advance: (ms: number) => Promise<void> }, body: () => Promise<void>) => {
  await $.command.run({ command: 'hud-demo', args: '' } as never)
  try {
    await clock.advance(6000)
    await body()
  } finally {
    await $.command.run({ command: 'hud-demo', args: '' } as never)
  }
}

test('a check hides its section, the choice survives a new session, and a second press shows it', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const pane = await mountSticky($, 60, 200)
  expect(await drawnText(pane)).toContain('toggle-todos')

  await toggle(pane, 'todos')
  expect(await drawnText(pane)).not.toContain('toggle-todos')
  expect(await drawnText(pane)).toContain('toggle-gentle')

  await startSession($)
  expect(await drawnText(pane)).not.toContain('toggle-todos')

  await toggle(pane, 'todos')
  expect(await drawnText(pane)).toContain('toggle-todos')
})

test('the checks mark shown sections and keep their width when unchecked', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const pane = await mountSticky($, 60, 200)
  await pane.press({ key: SETTINGS_KEY })
  await pane.press({ key: sectionKey('todos') })
  const tree = await drawnText(pane)
  expect(tree).toContain('[✓ Session]')
  expect(tree).toContain('[  Todo]')
  const todoCheck = all(await pane.drawn(), 'Button').find(b => b.props?.key === sectionKey('todos'))
  expect(textOf(todoCheck).length).toBe(checkText('todos', true).length)
})

test('hiding Subagents with cards shrinks the end offset by the whole section (demo mode)', async ($, on) => {
  const clock = answerEngine(on)
  await startSession($)
  await clock.settle()
  await inDemo($, clock, async () => {
    const pane = await mountSticky($, 60, 24)
    const shown = await endOffset(pane, $, 24)
    await pane.press({ key: 'toggle-subagents' })
    const collapsedEnd = await endOffset(pane, $, 24)
    await pane.press({ key: 'toggle-subagents' })
    await toggle(pane, 'subagents')
    const hiddenEnd = await endOffset(pane, $, 24)
    // Collapsing drops the tally and the cards; hiding also drops the margin
    // row and the one-line header.
    expect(shown - collapsedEnd).toBeGreaterThan(CARD_ROWS)
    expect(shown - hiddenEnd).toBe(shown - collapsedEnd + 2)
    expect(await drawnText(pane)).not.toContain('subagent)')
  })
})

test('hiding Session leaves no blank row at the top: the first drawn section has no margin', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const pane = await mountSticky($, 60, 200)
  await toggle(pane, 'session')
  const first = elements(contentBox(await pane.drawn()))[0] as Node
  expect(first.props?.marginTop).toBeUndefined()
  expect(JSON.stringify(first)).toContain('toggle-context')
})

test('a collapsed section hidden and shown again is still collapsed', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const pane = await mountSticky($, 60, 200)
  await pane.press({ key: 'toggle-mcp' })
  expect(await drawnText(pane)).toContain('▸ MCP')
  await toggle(pane, 'mcp')
  expect(await drawnText(pane)).not.toContain('toggle-mcp')
  await toggle(pane, 'mcp')
  expect(await drawnText(pane)).toContain('▸ MCP')
})

test('every section hidden draws the all-hidden line below the block, counted with textRows', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const bodyRows = 10
  const W = layoutFor(28, bodyRows).columns
  const pane = await mountSticky($, 28, bodyRows)
  await pane.press({ key: SETTINGS_KEY })
  for (const id of SECTION_IDS) await pane.press({ key: sectionKey(id) })
  const tree = await drawnText(pane)
  expect(tree).toContain(ALL_HIDDEN_TEXT)
  expect(tree.indexOf(SETTINGS_CLOSE)).toBeLessThan(tree.indexOf(ALL_HIDDEN_TEXT))
  const content = settingsRows(W, 'default') + textRows(ALL_HIDDEN_TEXT.length, W)
  expect(await endOffset(pane, $, bodyRows)).toBe(content - viewportRowsFor(bodyRows, true) + SCROLL_BOTTOM_MARGIN)
})

test('the checks work in demo mode', async ($, on) => {
  const clock = answerEngine(on)
  await startSession($)
  await clock.settle()
  await inDemo($, clock, async () => {
    const pane = await mountSticky($, 60, 24)
    await toggle(pane, 'mcp')
    expect(await drawnText(pane)).not.toContain('toggle-mcp')
    await toggle(pane, 'mcp')
    expect(await drawnText(pane)).toContain('toggle-mcp')
  })
})

// Review focus: a malformed stored value.
test('a malformed stored choice hides only the known sections', async ($, on) => {
  answerEngine(on, { hiddenSections: ['mcp', 'bogus', 'mcp', 3] })
  await startSession($)
  const pane = await mountSticky($, 60, 200)
  const tree = await drawnText(pane)
  expect(tree).not.toContain('toggle-mcp')
  for (const id of ['session', 'context', 'subagents', 'todos', 'gentle']) expect(tree).toContain(`toggle-${id}`)
})

for (const stored of ['mcp', { mcp: true }]) {
  test(`a stored ${typeof stored === 'string' ? 'string' : 'object'} hides nothing`, async ($, on) => {
    answerEngine(on, { hiddenSections: stored })
    await startSession($)
    const pane = await mountSticky($, 60, 200)
    const tree = await drawnText(pane)
    for (const id of SECTION_IDS) expect(tree).toContain(`toggle-${id}`)
  })
}

// Review focus: the store cannot be written.
// The check's onPress returns toggleSection's promise and the kit's press
// awaits it, so without the catch in toggleSection the press rejects and
// this test fails at `toggle`.
test('a failed save still hides the section for this session and keeps nothing', async ($, on) => {
  const failedSaves: string[] = []
  answerEngine(on, {}, failedSaves)
  await startSession($)
  const pane = await mountSticky($, 60, 200)
  await toggle(pane, 'todos')
  expect(failedSaves).toEqual(['hiddenSections'])
  expect(await drawnText(pane)).not.toContain('toggle-todos')

  // Nothing was stored: a new session shows the section again.
  await startSession($)
  expect(await drawnText(pane)).toContain('toggle-todos')
})

// Review focus: privacy mode must never be invisible.
test('privacy mode stays visible in the header with every section hidden', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const pane = await mountSticky($, 60, 24)
  await $.command.run({ command: 'hud-private', args: '' } as never)
  await toggle(pane, ...SECTION_IDS)
  const root = await pane.drawn()
  expect(textOf(headerOf(root))).toContain('🔒')
  expect(textOf(contentBox(root))).toContain(ALL_HIDDEN_TEXT)
})
