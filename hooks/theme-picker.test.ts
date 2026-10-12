import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PICKER_FOCUS_RETRY_MS, THEMES } from './themes'

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

// The HUD's own accent: the color of the sidebar header's hide button.
const accentNow = (drawn: string): string | undefined => /"key":"hide-sidebar".*?"color":"([^"]+)"/.exec(drawn)?.[1]

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

  // Down from monokai: the ring would land on Cancel; it lands on default.
  await focus($, 'theme:monokai')
  await focus($, 'theme-cancel')
  expect(landed.at(-1)).toBe('theme:default')
  expect(accentNow(await drawn())).toBe('claude')

  // Up from default: the ring would leave for the header; it lands on monokai.
  await focus($, 'hide-sidebar')
  expect(landed.at(-1)).toBe('theme:monokai')
  expect(accentNow(await drawn())).toBe(THEMES.monokai.accent)

  // Up from monokai is a plain move.
  await focus($, 'theme:kanagawa')
  expect(landed.at(-1)).toBe('theme:kanagawa')
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
  await focus($, 'theme:monokai')
  await focus($, 'theme-cancel', { kind: 'plugin', name: 'agent-hud' })
  expect(landed.at(-1)).toBe('theme-cancel')
})

test('Cancel has the c hotkey', async ($, on) => {
  answerEngine(on)
  const { drawn } = await openPicker($)
  expect(await drawn()).toMatch(/"key":"theme-cancel"[^}]*"hotkey":"c"/)
})
