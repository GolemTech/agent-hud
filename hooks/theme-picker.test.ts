import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PICKER_FOCUS_RETRY_MS, PICKER_LIST_ROWS, PICKER_WINDOW, pickerRows, THEMES } from './themes'

const HOME = '/home/myuser'
const CWD = `${HOME}/code/example`

// The engine's bottom for the poller, the Pane and the picker. `opens`
// collects every `$.ui.open` argument; `ui.focus` lands wherever it is asked.
const answerEngine = (on: On, opens: unknown[] = [], closes: unknown[] = [], landed: (string | undefined)[] = []) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', (_$, e) => {
    opens.push(e)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', (_$, e) => {
    closes.push(e)
    return { value: undefined } as never
  })
  on('ui.focus', (_$, e) => {
    landed.push((e as { element?: string }).element)
    return {} as never
  })
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
  // The engine's own scroll move, beneath the plugin's observer.
  on('ui.scroll', () => ({}) as never)
  return clock
}

const startSession = ($: Engine) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)

const SIDEBAR = { title: 'Agent HUD', bodyColumns: 60, placement: 'dock' }

const mountSidebar = ($: Engine, isFocused = true) =>
  $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'hud',
    props: { ...SIDEBAR, isFocused } as never,
  })

// The person's focus ring moving onto one element of the sidebar.
const focus = ($: Engine, element?: string, origin: object = { kind: 'person' }) =>
  $.ui.focus({
    component: 'Pane',
    requestId: 'hud',
    plugin: element ? 'agent-hud' : undefined,
    element,
    origin,
  } as never)

type Open = { id?: string; title?: string; focus?: boolean; closeOnEscape?: boolean }

const openPicker = async ($: Engine) => {
  await startSession($)
  const pane = await mountSidebar($)
  const text = (await $.command.run({ command: 'hud-theme', args: '' } as never)).text ?? ''
  return { pane, text, drawn: async () => JSON.stringify(await pane.drawn()) }
}

// The HUD's own accent: the color of the sidebar header's ⋮ Button.
const accentNow = (drawn: string): string | undefined => /"key":"settings".*?"color":"([^"]+)"/.exec(drawn)?.[1]

test('/hud-theme without a name opens the picker inside the focused sidebar, above its sections', async ($, on) => {
  const opens: unknown[] = []
  const clock = answerEngine(on, opens)
  const { text, drawn } = await openPicker($)

  expect(text).toContain('● default (active)')
  // The HUD's own pane, never a second one (it would be a tab hiding the sidebar).
  expect((opens as Open[]).every(o => o.id === 'hud')).toBe(true)
  const asked = (opens as Open[]).filter(o => o.focus === true)
  expect(asked).toHaveLength(1)
  expect(asked[0]).toMatchObject({ id: 'hud', title: 'Agent HUD' })
  expect(asked[0]?.closeOnEscape).toBeUndefined() // Escape returns the keys, the HUD stays

  // Once the command returned, the keys are asked for again.
  await clock.advance(PICKER_FOCUS_RETRY_MS)
  expect((opens as Open[]).filter(o => o.focus === true)).toHaveLength(2)

  const tree = await drawn()
  for (const name of Object.keys(THEMES)) expect(tree).toContain(`theme:${name}`)
  expect(tree).toContain('theme-cancel')
  expect(tree).toContain('↑/↓ preview · Enter apply · c cancel · Esc revert')
  expect(tree).not.toContain('ctrl+x tab') // it holds the keys
  // The sections stay drawn, below the picker.
  expect(tree).toContain('Context')
  expect(tree.indexOf('theme-cancel')).toBeLessThan(tree.indexOf('Context'))
})

test('focusing a theme recolors the sidebar itself without saving; focus elsewhere reverts', async ($, on) => {
  answerEngine(on)
  const { drawn } = await openPicker($)

  await focus($, 'theme:dracula')
  expect(accentNow(await drawn())).toBe(THEMES.dracula.accent)
  await focus($, 'theme:nord')
  expect(accentNow(await drawn())).toBe(THEMES.nord.accent)
  await focus($, 'theme-cancel')
  expect(accentNow(await drawn())).toBe('claude')
  await focus($, 'theme:nord')
  await focus($) // one of the engine's own stops
  expect(accentNow(await drawn())).toBe('claude')

  // Nothing was saved: a new session loads the default again.
  await focus($, 'theme:dracula')
  await startSession($)
  expect(accentNow(await drawn())).toBe('claude')
})

test('without the keys the sidebar shows the saved theme and how to take them', async ($, on) => {
  answerEngine(on)
  const { pane, drawn } = await openPicker($)
  await focus($, 'theme:dracula')
  await pane.redraw({ ...SIDEBAR, isFocused: false } as never)
  const tree = await drawn()
  expect(accentNow(tree)).toBe('claude')
  expect(tree).toContain('ctrl+x tab or a click')
  expect(tree).toContain('theme:dracula') // still picking
})

test('pressing a theme saves it and closes the picker, not the sidebar', async ($, on) => {
  const closes: unknown[] = []
  answerEngine(on, [], closes)
  const { pane, drawn } = await openPicker($)

  await focus($, 'theme:dracula')
  await pane.press({ key: 'theme:dracula' })
  const tree = await drawn()
  expect(accentNow(tree)).toBe(THEMES.dracula.accent)
  expect(tree).not.toContain('theme:nord')
  expect(tree).toContain('Context')
  expect(closes).toEqual([])

  await startSession($)
  expect(accentNow(await drawn())).toBe(THEMES.dracula.accent)
})

test('Cancel drops the preview and closes the picker without saving', async ($, on) => {
  const closes: unknown[] = []
  answerEngine(on, [], closes)
  const { pane, drawn } = await openPicker($)

  await focus($, 'theme:gruvbox-dark')
  expect(accentNow(await drawn())).toBe(THEMES['gruvbox-dark'].accent)
  await pane.press({ key: 'theme-cancel' })
  const tree = await drawn()
  expect(accentNow(tree)).toBe('claude')
  expect(tree).not.toContain('theme:dracula')
  expect(closes).toEqual([])

  await startSession($)
  expect(accentNow(await drawn())).toBe('claude')
})

test('a focus move while no picker is open previews nothing', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const sidebar = await mountSidebar($)
  await focus($, 'theme:dracula')
  expect(accentNow(JSON.stringify(await sidebar.drawn()))).toBe('claude')
})

// The background the Pane's root Box is filled with, if any.
const rootBackground = (drawn: string): string | undefined =>
  (JSON.parse(drawn) as { props?: { backgroundColor?: string } }).props?.backgroundColor

test('the sidebar is filled with the theme background; default draws none; a preview changes it', async ($, on) => {
  answerEngine(on)
  const { pane, drawn } = await openPicker($)

  const plain = await drawn()
  expect(rootBackground(plain)).toBeUndefined()
  expect(plain).not.toContain('backgroundColor')

  await focus($, 'theme:nord')
  expect(rootBackground(await drawn())).toBe(THEMES.nord.background)

  await pane.press({ key: 'theme:dracula' })
  expect(rootBackground(await drawn())).toBe(THEMES.dracula.background)

  // Sticky layout (the body's height known) fills the same root.
  await pane.redraw({ ...SIDEBAR, isFocused: true, scroll: { bodyRows: 30 } } as never)
  expect(rootBackground(await drawn())).toBe(THEMES.dracula.background)
})

test('the picker wraps like a carousel: past the last theme to the first, before the first to the last', async ($, on) => {
  const landed: (string | undefined)[] = []
  answerEngine(on, [], [], landed)
  const { drawn } = await openPicker($)

  // Down from the last theme: the ring would land on Cancel; it lands on default.
  await focus($, 'theme:nord-light')
  await focus($, 'theme-cancel')
  expect(landed.at(-1)).toBe('theme:default')
  expect(accentNow(await drawn())).toBe('claude')

  // Up from default: the ring would leave for the header's ⋮; it lands on the last (light) theme.
  await focus($, 'settings')
  expect(landed.at(-1)).toBe('theme:nord-light')
  expect(accentNow(await drawn())).toBe(THEMES['nord-light'].accent)

  // Up from it is a plain move.
  await focus($, 'theme:tokyo-night-day')
  expect(landed.at(-1)).toBe('theme:tokyo-night-day')

  // Down from monokai, no longer the last, is a plain move too.
  await focus($, 'theme:monokai')
  await focus($, 'theme:everforest-dark')
  expect(landed.at(-1)).toBe('theme:everforest-dark')
})

test('the carousel leaves non-adjacent jumps and plugin moves untouched', async ($, on) => {
  const landed: (string | undefined)[] = []
  answerEngine(on, [], [], landed)
  await openPicker($)

  // A click from dracula onto Cancel is no step past the last theme.
  await focus($, 'theme:dracula')
  await focus($, 'theme-cancel')
  expect(landed.at(-1)).toBe('theme-cancel')

  // The plugin's own move (an autoFocus) is never redirected.
  await focus($, 'theme:nord-light')
  await focus($, 'theme-cancel', { kind: 'plugin', name: 'agent-hud' })
  expect(landed.at(-1)).toBe('theme-cancel')
})

test('Cancel has the c hotkey', async ($, on) => {
  answerEngine(on)
  const { drawn } = await openPicker($)
  expect(await drawn()).toMatch(/"key":"theme-cancel"[^}]*"hotkey":"c"/)
})

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null
const textOf = (n: unknown): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n) : isNode(n) ? (n.children ?? []).map(textOf).join('') : ''
// Every Button key and plain picker line, in drawing order.
const pickerLines = (n: unknown, out: string[] = []): string[] => {
  if (!isNode(n)) return out
  if (n.type === 'Button') return [...out, `button:${String(n.props?.key)}`]
  if (n.type === 'Text') return [...out, `text:${textOf(n).trim()}`]
  return (n.children ?? []).reduce<string[]>((acc, c) => pickerLines(c, acc), out)
}

test('the picker draws the dark themes, a light separator that is no Button, then the light themes', async ($, on) => {
  answerEngine(on)
  const { pane } = await openPicker($)
  const lines = pickerLines(await pane.drawn())
  const at = (line: string) => lines.indexOf(line)
  expect(at('text:light')).toBeGreaterThan(-1)
  expect(at('button:theme:synthwave-84')).toBe(at('text:light') - 1)
  expect(at('button:theme:catppuccin-latte')).toBe(at('text:light') + 1)
  // The last theme, then the window's bottom indicator, then Cancel.
  expect(at('button:theme:nord-light')).toBe(at('button:theme-cancel') - 2)
  for (const name of Object.keys(THEMES)) expect(at(`button:theme:${name}`)).toBeGreaterThan(-1)
})

test('a light theme previews with its own foreground and background', async ($, on) => {
  answerEngine(on)
  const { drawn } = await openPicker($)
  await focus($, 'theme:github-light')
  const tree = await drawn()
  expect(accentNow(tree)).toBe(THEMES['github-light'].accent)
  expect(rootBackground(tree)).toBe(THEMES['github-light'].background)
  expect(tree).toContain(`"color":"${THEMES['github-light'].foreground}"`)
})

// ── Fixed window ────────────────────────────────────────────────────────

const all = (n: unknown, pick: (n: Node) => boolean, out: Node[] = []): Node[] => {
  if (!isNode(n)) return out
  if (pick(n)) out.push(n)
  for (const c of n.children ?? []) all(c, pick, out)
  return out
}
// The picker block: the column that holds Cancel and the clipped theme window.
const pickerBlock = (tree: unknown): Node => {
  const blocks = all(tree, n => n.type === 'Box' && n.props?.marginBottom === 1 && JSON.stringify(n).includes('theme-cancel'))
  return blocks.at(-1) as Node
}
// The clipped window and the shift of the list inside it.
const pickerWindow = (tree: unknown) => {
  const box = all(pickerBlock(tree), n => n.type === 'Box' && n.props?.overflow === 'hidden')[0] as Node
  const list = (box.children ?? []).filter(isNode)[0] as Node
  return { box, offset: 0 - Number(list.props?.marginTop ?? 0) }
}
const moreLines = (tree: unknown) =>
  (pickerBlock(tree).children ?? []).filter(isNode).filter(n => n.type === 'Text').map(n => textOf(n))

// A wheel or scroll key over the Pane.
const wheel = ($: Engine, by: number) =>
  $.ui.scroll({ component: 'Pane', requestId: 'hud', offset: 0, by, bodyRows: 40, contentRows: 40, origin: { kind: 'person' } } as never)

const STICKY = { ...SIDEBAR, isFocused: true, scroll: { offset: 0, bodyRows: 40 } }

test('the theme list draws in a clipped window of PICKER_WINDOW rows, with the hidden rows named', async ($, on) => {
  answerEngine(on)
  const { pane } = await openPicker($)
  const tree = await pane.drawn()
  const w = pickerWindow(tree)
  expect(w.box.props?.height).toBe(PICKER_WINDOW)
  expect(w.offset).toBe(0) // default, the saved theme, is the first row
  // Every theme Button is still drawn (the ring keeps its order), clipped by the window.
  for (const name of Object.keys(THEMES)) expect(JSON.stringify(w.box)).toContain(`theme:${name}`)
  const lines = moreLines(tree)
  expect(lines).toContain(`↓ ${PICKER_LIST_ROWS - PICKER_WINDOW} more`)
  expect(lines.some(l => /^↑ \d+ more$/.test(l))).toBe(false)
})

test('pickerRows equals the rows the picker block draws', async ($, on) => {
  answerEngine(on)
  const { pane } = await openPicker($)
  for (const isFocused of [true, false]) {
    await pane.redraw({ ...SIDEBAR, isFocused } as never)
    const block = pickerBlock(await pane.drawn())
    const drawnRows =
      (block.children ?? []).filter(isNode).reduce((n, c) => n + (typeof c.props?.height === 'number' ? Number(c.props.height) : 1), 0) +
      Number(block.props?.marginBottom ?? 0)
    expect(drawnRows).toBe(pickerRows(isFocused))
  }
})

test('a focus move past the bottom of the window shifts it by the least', async ($, on) => {
  answerEngine(on)
  const { pane } = await openPicker($)
  await focus($, 'theme:monokai') // row 10, one past the window
  const tree = await pane.drawn()
  expect(pickerWindow(tree).offset).toBe(1)
  expect(moreLines(tree)).toContain('↑ 1 more')
  expect(moreLines(tree)).toContain(`↓ ${PICKER_LIST_ROWS - PICKER_WINDOW - 1} more`)
  // Back up inside the window: no move.
  await focus($, 'theme:nord')
  expect(pickerWindow(await pane.drawn()).offset).toBe(1)
})

test('a carousel wrap jumps the window to that end', async ($, on) => {
  answerEngine(on)
  const { pane } = await openPicker($)
  await focus($, 'theme:nord-light')
  expect(pickerWindow(await pane.drawn()).offset).toBe(PICKER_LIST_ROWS - PICKER_WINDOW)
  await focus($, 'theme-cancel') // wraps onto default
  expect(pickerWindow(await pane.drawn()).offset).toBe(0)
  await focus($, 'settings') // wraps onto nord-light
  expect(pickerWindow(await pane.drawn()).offset).toBe(PICKER_LIST_ROWS - PICKER_WINDOW)
})

test('the picker opens with the saved theme in view', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const pane = await mountSidebar($)
  await $.command.run({ command: 'hud-theme', args: 'nord-light' } as never)
  await $.command.run({ command: 'hud-theme', args: '' } as never)
  expect(pickerWindow(await pane.drawn()).offset).toBe(PICKER_LIST_ROWS - PICKER_WINDOW)
})

test('a scroll while the picker is open moves its window, not the sections, clamped to the list', async ($, on) => {
  answerEngine(on)
  const { pane } = await openPicker($)
  await pane.redraw(STICKY as never)
  await wheel($, 3)
  let tree = (await pane.drawn()) as Node
  expect(pickerWindow(tree).offset).toBe(3)
  // The sections' own shift (the viewport's content box) did not move.
  const content = all(tree, n => n.type === 'Box' && n.props?.overflow === 'hidden' && n.props?.height !== PICKER_WINDOW)[0] as Node
  expect((content.children ?? []).filter(isNode)[0]?.props?.marginTop).toBe(0)
  await wheel($, 100)
  expect(pickerWindow(await pane.drawn()).offset).toBe(PICKER_LIST_ROWS - PICKER_WINDOW)
  await wheel($, -100)
  expect(pickerWindow(await pane.drawn()).offset).toBe(0)

  // Closed, the scroll moves the sections again (a shorter body, so they overflow).
  await pane.press({ key: 'theme-cancel' })
  await pane.redraw({ ...STICKY, scroll: { offset: 0, bodyRows: 12 } } as never)
  await wheel($, 2)
  tree = (await pane.drawn()) as Node
  const viewport = all(tree, n => n.type === 'Box' && n.props?.overflow === 'hidden')[0] as Node
  expect((viewport.children ?? []).filter(isNode)[0]?.props?.marginTop).toBe(-2)
})

test('closing the picker resets its window', async ($, on) => {
  answerEngine(on)
  const { pane } = await openPicker($)
  await wheel($, 5)
  expect(pickerWindow(await pane.drawn()).offset).toBe(5)
  await pane.press({ key: 'theme-cancel' })
  await $.command.run({ command: 'hud-theme', args: '' } as never)
  expect(pickerWindow(await pane.drawn()).offset).toBe(0)
})
