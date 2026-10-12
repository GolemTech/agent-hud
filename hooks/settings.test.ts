import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { layoutFor, textRows } from './layout'
import { summaryLine } from './register'
import {
  ALL_HIDDEN_TEXT,
  CHANGE_TEXT,
  checkText,
  CLOSE_TEXT,
  parseHidden,
  SECTION_IDS,
  SECTION_LABELS,
  sectionKey,
  summaryParts,
  toggleHidden,
  visibleSections,
  SETTINGS_BUTTON,
  SETTINGS_BUTTON_CELLS,
  SETTINGS_GLYPH,
  SETTINGS_CHANGE,
  SETTINGS_CLOSE,
  SETTINGS_KEY,
  SETTINGS_LABEL_CELLS,
  SETTINGS_TITLE,
  settingsLabel,
  settingsRows,
} from './settings'
import { PICKER_CANCEL, PICKER_FOCUS_RETRY_MS, THEME_NAMES, THEMES } from './themes'

test('the settings button is U+22EE padded by three spaces each side: seven cells', () => {
  expect(SETTINGS_KEY).toBe('settings')
  expect(SETTINGS_GLYPH).toBe('\u22EE')
  expect(SETTINGS_BUTTON).toBe('   \u22EE   ')
  expect(SETTINGS_BUTTON_CELLS).toBe(7)
  // U+22EE is one UTF-16 unit and one cell: the string length is the drawn width.
  expect(SETTINGS_BUTTON.length).toBe(SETTINGS_BUTTON_CELLS)
})

test('settingsLabel pads a label to the shared label column', () => {
  expect(SETTINGS_LABEL_CELLS).toBe(10)
  expect(settingsLabel('Theme')).toBe('  Theme   ')
  expect(settingsLabel('Sections')).toBe('  Sections')
  expect(CHANGE_TEXT).toBe('[change]')
  expect(CLOSE_TEXT).toBe('[close]')
})

test('settingsRows: the title, the Theme row as it wraps, [close] and the blank row under the block', () => {
  // 100 columns (98 drawable): label, name and [change] share one line.
  expect(settingsRows(98, 'default')).toBe(4)
  // 28 columns (26 drawable): [change] goes below the name.
  expect(settingsRows(26, 'default')).toBe(5)
  // A long name wraps the Theme row where a short one fits (34 columns, 32 drawable).
  expect(settingsRows(32, 'default')).toBe(4)
  expect(settingsRows(32, 'catppuccin-mocha')).toBe(5)
  // 20 columns (18 drawable): label, name and [change] each take a line.
  expect(settingsRows(18, 'catppuccin-mocha')).toBe(6)
})

test('SECTION_IDS lists the six sections in draw order, each with its label', () => {
  expect(SECTION_IDS).toEqual(['session', 'context', 'mcp', 'subagents', 'todos', 'gentle'])
  expect(SECTION_IDS.map(id => SECTION_LABELS[id])).toEqual(['Session', 'Context', 'MCP', 'Subagents', 'Todo', 'Gentle AI'])
})

test('parseHidden keeps known ids once, in draw order; anything else is none', () => {
  expect(parseHidden(['todos', 'bogus', 'session', 'todos', 3])).toEqual(['session', 'todos'])
  expect(parseHidden([])).toEqual([])
  for (const bad of [undefined, null, 'mcp', 3, { mcp: true }]) expect(parseHidden(bad)).toEqual([])
})

test('toggleHidden hides or shows one section, keeping draw order', () => {
  expect(toggleHidden([], 'todos')).toEqual(['todos'])
  expect(toggleHidden(['todos'], 'session')).toEqual(['session', 'todos'])
  expect(toggleHidden(['session', 'todos'], 'session')).toEqual(['todos'])
})

test('visibleSections keeps draw order', () => {
  expect(visibleSections([])).toEqual([...SECTION_IDS])
  expect(visibleSections(['mcp', 'session'])).toEqual(['context', 'subagents', 'todos', 'gentle'])
  expect(visibleSections([...SECTION_IDS])).toEqual([])
})

test('summaryParts drops the parts of hidden sections; nothing hidden is the old line', () => {
  expect(summaryParts(26, 5, 9, 2, []).join(' · ')).toBe('26% · MCP 5/9 · 2 agents')
  expect(summaryParts(undefined, 0, 0, 0, []).join(' · ')).toBe('–% · MCP 0/0 · 0 agents')
  expect(summaryParts(26, 5, 9, 2, ['context'])).toEqual(['MCP 5/9', '2 agents'])
  expect(summaryParts(26, 5, 9, 2, ['mcp', 'subagents'])).toEqual(['26%'])
  expect(summaryParts(26, 5, 9, 2, ['context', 'mcp', 'subagents'])).toEqual([])
  expect(summaryParts(26, 5, 9, 2, ['session', 'todos', 'gentle'])).toEqual(['26%', 'MCP 5/9', '2 agents'])
  expect(summaryLine(26, 5, 9, 2)).toBe('26% · MCP 5/9 · 2 agents')
  expect(summaryLine(26, 5, 9, 2, ['context', 'mcp', 'subagents'])).toBe('')
})

test('checks keep one width checked or not, so a toggle never changes the wrap', () => {
  expect(checkText('todos', true)).toBe('[✓ Todo]')
  expect(checkText('todos', false)).toBe('[  Todo]')
  for (const id of SECTION_IDS) expect(checkText(id, false).length).toBe(checkText(id, true).length)
  expect(sectionKey('mcp')).toBe('show-mcp')
})

test('the all-hidden line names the gear and takes two rows at 28 columns', () => {
  expect(ALL_HIDDEN_TEXT).toBe('all sections hidden · 🔧 to show')
  expect(textRows(ALL_HIDDEN_TEXT.length, layoutFor(28, 24).columns)).toBe(2)
})

// ── Wiring ───────────────────────────────────────────────────────────────

const HOME = '/home/myuser'
const CWD = `${HOME}/code/example`

// The engine's bottom for the poller, the Pane, the picker and the scroll.
// `opens` collects every `$.ui.open` argument; `refuse` throws for the ones
// it returns true for, as a refused open.
const answerEngine = (
  on: On,
  store: Record<string, unknown> = {},
  opens: unknown[] = [],
  refuse: (e: unknown) => boolean = () => false,
) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME })
  mock.store(on, store)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', (_$, e) => {
    opens.push(e)
    if (refuse(e)) throw new Error('open refused')
    return { value: { isPlaced: true } } as never
  })
  on('ui.focus', () => ({}) as never)
  on('ui.scroll', () => ({}) as never)
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
  on('tool.list', () => ({ value: [] }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('fs.read', () => ({ value: '{}' }) as never)
  on('fs.exists', () => ({ value: false }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }) as never)
  on('process.run', () => ({ value: { stdout: 'main\n', stderr: '', exitCode: 0 } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return clock
}

const startSession = ($: Engine) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)

// Plain flow (no body height), as theme-picker.test.ts mounts it.
const mountPane = ($: Engine, isFocused = false) =>
  $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'hud',
    props: { title: 'Agent HUD', isFocused, bodyColumns: 60, placement: 'dock' } as never,
  })

// Sticky layout: drawn at `bodyRows`, scrolled by the plugin's own offset.
const mountSticky = ($: Engine, bodyColumns: number, bodyRows: number) =>
  $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'hud',
    props: { title: 'Agent HUD', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows } } as never,
  })

const scroll = ($: Engine, by: number, bodyRows: number) =>
  $.ui.scroll({ component: 'Pane', requestId: 'hud', offset: 0, by, bodyRows, contentRows: bodyRows, origin: { kind: 'person' } } as never)

const focus = ($: Engine, element: string) =>
  $.ui.focus({ component: 'Pane', requestId: 'hud', plugin: 'agent-hud', element, origin: { kind: 'person' } } as never)

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null
const textOf = (n: unknown): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n) : isNode(n) ? (n.children ?? []).map(textOf).join('') : ''
const elements = (n: Node): Node[] => (n.children ?? []).filter(isNode)
// The sticky layout's scrolled content: root → [header, viewport, footer].
const contentBox = (root: unknown): Node => elements(elements(root as Node)[1] as Node)[0] as Node
const endOffset = async (pane: { drawn: () => Promise<unknown> }, $: Engine, bodyRows: number) => {
  await pane.drawn()
  await scroll($, 10_000, bodyRows)
  return -Number(contentBox(await pane.drawn()).props?.marginTop)
}

// The HUD's own accent: the color of the header's ⋮ Button.
const accentNow = (drawn: string): string | undefined => /"key":"settings".*?"color":"([^"]+)"/.exec(drawn)?.[1]

const inDemo = async ($: Engine, clock: { advance: (ms: number) => Promise<void> }, body: () => Promise<void>) => {
  await $.command.run({ command: 'hud-demo', args: '' } as never)
  try {
    await clock.advance(6000)
    await body()
  } finally {
    await $.command.run({ command: 'hud-demo', args: '' } as never)
  }
}

test('with the picker open the ring starts at ⋮: settings before the first theme, no hide-sidebar', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const pane = await mountPane($)
  await $.command.run({ command: 'hud-theme', args: '' } as never)
  const tree = JSON.stringify(await pane.drawn())
  const at = (key: string) => tree.indexOf(`"key":"${key}"`)
  expect(at(SETTINGS_KEY)).toBeGreaterThan(-1)
  expect(at(SETTINGS_KEY)).toBeLessThan(at(`theme:${THEME_NAMES[0]}`))
  expect(tree).not.toContain('hide-sidebar')
})

test('⋮ opens the settings block above the sections, ⋮ again or [close] closes it, a new session starts closed', async ($, on) => {
  answerEngine(on, { theme: 'tokyo-night' })
  await startSession($)
  const pane = await mountPane($)
  const drawn = async () => JSON.stringify(await pane.drawn())
  expect(await drawn()).not.toContain(SETTINGS_CLOSE)

  await pane.press({ key: SETTINGS_KEY })
  const open = await drawn()
  expect(open).toContain(SETTINGS_TITLE)
  expect(open).toContain(settingsLabel('Theme'))
  expect(open).toContain('tokyo-night')
  expect(open).toContain(SETTINGS_CHANGE)
  expect(open.indexOf(SETTINGS_CLOSE)).toBeLessThan(open.indexOf('Context'))

  await pane.press({ key: SETTINGS_KEY })
  expect(await drawn()).not.toContain(SETTINGS_CLOSE)

  await pane.press({ key: SETTINGS_KEY })
  await pane.press({ key: SETTINGS_CLOSE })
  expect(await drawn()).not.toContain(SETTINGS_CLOSE)

  await pane.press({ key: SETTINGS_KEY })
  await startSession($)
  expect(await drawn()).not.toContain(SETTINGS_CLOSE)
})

test('opening the block scrolls the sections back to the top (demo mode)', async ($, on) => {
  const clock = answerEngine(on)
  await startSession($)
  await clock.settle()
  await inDemo($, clock, async () => {
    const pane = await mountSticky($, 60, 24)
    await scroll($, 3, 24)
    expect(contentBox(await pane.drawn()).props?.marginTop).toBe(-3)
    await pane.press({ key: SETTINGS_KEY })
    expect(contentBox(await pane.drawn()).props?.marginTop).toBe(0)
  })
})

for (const cols of [28, 100]) {
  test(`at ${cols} columns the block's counted rows match the drawn tree (demo mode)`, async ($, on) => {
    const clock = answerEngine(on)
    await startSession($)
    await clock.settle()
    await inDemo($, clock, async () => {
      const W = layoutFor(cols, 24).columns
      const pane = await mountSticky($, cols, 24)
      const closedEnd = await endOffset(pane, $, 24)
      await pane.press({ key: SETTINGS_KEY })
      const openEnd = await endOffset(pane, $, 24)
      expect(openEnd - closedEnd).toBe(settingsRows(W, 'default'))

      // The block is the first item of the content; its rows hold the widths
      // settingsRows counts.
      await scroll($, -10_000, 24)
      const block = elements(contentBox(await pane.drawn()))[0] as Node
      expect(block.props?.marginBottom).toBe(1)
      expect(textOf(elements(block)[0])).toBe(SETTINGS_TITLE)
      const themeRow = elements(block)[1] as Node
      expect(themeRow.props?.flexWrap).toBe('wrap')
      expect(elements(themeRow).map(i => textOf(i).length)).toEqual([SETTINGS_LABEL_CELLS, 'default'.length, CHANGE_TEXT.length])
      expect(textOf(elements(block).at(-1))).toBe(CLOSE_TEXT)
    })
  })
}

test('[change] closes the block and opens the picker in the HUD pane, asking for the keys', async ($, on) => {
  const opens: unknown[] = []
  const clock = answerEngine(on, {}, opens)
  await startSession($)
  const pane = await mountPane($)
  await pane.press({ key: SETTINGS_KEY })
  await pane.press({ key: SETTINGS_CHANGE })
  const tree = JSON.stringify(await pane.drawn())
  expect(tree).toContain(`theme:${THEME_NAMES[0]}`)
  expect(tree).toContain(PICKER_CANCEL)
  expect(tree).not.toContain(SETTINGS_CLOSE)
  const asked = () => (opens as { id?: string; focus?: boolean }[]).filter(o => o.focus === true)
  expect(asked()).toHaveLength(1)
  expect(asked()[0]?.id).toBe('hud')
  await clock.advance(PICKER_FOCUS_RETRY_MS)
  expect(asked()).toHaveLength(2)
})

test('[change] still schedules the focus retry when the first open fails', async ($, on) => {
  // The first open asking for the keys is refused, later ones are placed.
  const opens: unknown[] = []
  const asked = () => (opens as { focus?: boolean }[]).filter(o => o.focus === true)
  const clock = answerEngine(on, {}, opens, e => (e as { focus?: boolean }).focus === true && asked().length === 1)
  await startSession($)
  const pane = await mountPane($)
  await pane.press({ key: SETTINGS_KEY })
  await pane.press({ key: SETTINGS_CHANGE })
  const tree = JSON.stringify(await pane.drawn())
  expect(tree).toContain(PICKER_CANCEL)
  expect(asked()).toHaveLength(1)
  await clock.advance(PICKER_FOCUS_RETRY_MS)
  expect(asked()).toHaveLength(2)
})

test('/hud-theme with the block open closes it and opens the picker', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const pane = await mountPane($)
  await pane.press({ key: SETTINGS_KEY })
  await $.command.run({ command: 'hud-theme', args: '' } as never)
  const tree = JSON.stringify(await pane.drawn())
  expect(tree).toContain(PICKER_CANCEL)
  expect(tree).not.toContain(SETTINGS_CLOSE)
})

// Review focus: the settings button replaces a picker that is previewing a theme.
test('⋮ with the picker open closes it without saving, drops the preview and opens the block', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const pane = await mountPane($, true)
  await $.command.run({ command: 'hud-theme', args: '' } as never)
  await focus($, 'theme:dracula')
  expect(accentNow(JSON.stringify(await pane.drawn()))).toBe(THEMES.dracula.accent)

  await pane.press({ key: SETTINGS_KEY })
  const tree = JSON.stringify(await pane.drawn())
  expect(tree).not.toContain(PICKER_CANCEL)
  expect(tree).toContain(SETTINGS_CLOSE)
  expect(accentNow(tree)).toBe('claude')

  await startSession($)
  expect(accentNow(JSON.stringify(await pane.drawn()))).toBe('claude')
})

// Review focus: a plain text glyph painted in the theme's colors (inverse over the
// accent), so it never disappears into the band the way a color emoji does.
for (const name of ['default', 'dracula']) {
  test(`the settings button's Text is inverse in the ${name} accent`, async ($, on) => {
    answerEngine(on, { theme: name })
    await startSession($)
    const pane = await mountPane($)
    const tree = JSON.stringify(await pane.drawn())
    const accent = THEMES[name as keyof typeof THEMES].accent
    expect(tree).toMatch(new RegExp(`"key":"settings".*?"inverse":true.*?"color":"${accent}"|"key":"settings".*?"color":"${accent}".*?"inverse":true`))
    expect(accentNow(tree)).toBe(accent)
    expect(tree).toContain(SETTINGS_BUTTON)
  })
}
