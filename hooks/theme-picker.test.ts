import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PICKER_FOCUS_RETRY_MS, THEMES } from './themes'

const HOME = '/home/myuser'
const CWD = `${HOME}/code/example`

// The engine's bottom for the poller, the Pane and the picker. `opens`
// collects every `$.ui.open` argument; `ui.focus` lands wherever it is asked.
const answerEngine = (on: On, opens: unknown[] = [], closes: unknown[] = []) => {
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
  on('ui.focus', () => ({}) as never)
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

const mount = ($: Engine, requestId: string, title: string) =>
  $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId,
    props: { title, isFocused: true, bodyColumns: 60, placement: 'inline' } as never,
  })

// The person's focus ring moving onto one element of the theme dialog.
const focus = ($: Engine, element: string) =>
  $.ui.focus({
    component: 'Pane',
    requestId: 'hud-theme',
    plugin: 'agent-hud',
    element,
    origin: { kind: 'person' },
  } as never)

type Open = { id?: string; focus?: boolean; closeOnEscape?: boolean; holdToasts?: boolean; rows?: number }
const dialogOpens = (opens: unknown[]) => (opens as Open[]).filter(o => o.id === 'hud-theme')

// The sidebar is up; `/hud-theme` opens the dialog, mounted here as the
// engine would draw it.
const openPicker = async ($: Engine) => {
  await startSession($)
  const sidebar = await mount($, 'hud', 'Agent HUD')
  const text = (await $.command.run({ command: 'hud-theme', args: '' } as never)).text ?? ''
  const dialog = await mount($, 'hud-theme', 'HUD theme')
  return {
    text,
    dialog,
    sidebarText: async () => JSON.stringify(await sidebar.drawn()),
    dialogText: async () => JSON.stringify(await dialog.drawn()),
  }
}

// The HUD's own accent: the color of the sidebar header's hide button.
const accentNow = (drawn: string): string | undefined => /"key":"hide-sidebar".*?"color":"([^"]+)"/.exec(drawn)?.[1]

test('/hud-theme without a name opens a focused dialog pane, and asks for the keys again once it returned', async ($, on) => {
  const opens: unknown[] = []
  const clock = answerEngine(on, opens)
  const { text, dialog: mounted, dialogText, sidebarText } = await openPicker($)

  expect(text).toContain('● default (active)')
  expect(text).toContain('HUD theme')
  const [first] = dialogOpens(opens)
  expect(first).toMatchObject({ id: 'hud-theme', focus: true, closeOnEscape: true, holdToasts: true })
  expect(first?.rows).toBeGreaterThanOrEqual(Object.keys(THEMES).length + 1)

  // The focus asked during the command is refused while it runs: once it
  // returned, the dialog is opened again to ask for the keys.
  await clock.advance(PICKER_FOCUS_RETRY_MS)
  expect(dialogOpens(opens)).toHaveLength(2)
  expect(dialogOpens(opens)[1]).toMatchObject({ focus: true, closeOnEscape: true })

  const dialog = await dialogText()
  for (const name of Object.keys(THEMES)) expect(dialog).toContain(`theme:${name}`)
  expect(dialog).toContain('theme-cancel')
  expect(dialog).toContain('↑/↓ preview · Enter apply · Esc cancel')
  expect(dialog).not.toContain('ctrl+x tab') // it holds the keys

  // Without the keys (the focus was refused), it says how to take them.
  await mounted.redraw({ title: 'HUD theme', isFocused: false, bodyColumns: 60, placement: 'inline' } as never)
  expect(await dialogText()).toContain('ctrl+x tab or a click focuses this dialog')

  // The sidebar keeps its sections: no picker there.
  const sidebar = await sidebarText()
  expect(sidebar).toContain('Context')
  expect(sidebar).not.toContain('theme:dracula')
})

test('focusing a theme in the dialog previews it on the sidebar without saving; focus elsewhere reverts', async ($, on) => {
  answerEngine(on)
  const { sidebarText } = await openPicker($)

  await focus($, 'theme:dracula')
  expect(accentNow(await sidebarText())).toBe(THEMES.dracula.accent)
  await focus($, 'theme:nord')
  expect(accentNow(await sidebarText())).toBe(THEMES.nord.accent)
  await focus($, 'theme-cancel')
  expect(accentNow(await sidebarText())).toBe('claude')

  // Nothing was saved: a new session loads the default again.
  await focus($, 'theme:dracula')
  await startSession($)
  expect(accentNow(await sidebarText())).toBe('claude')
})

test('pressing a theme saves it and closes the dialog', async ($, on) => {
  const closes: unknown[] = []
  answerEngine(on, [], closes)
  const { dialog, sidebarText } = await openPicker($)

  await focus($, 'theme:dracula')
  await dialog.press({ key: 'theme:dracula' })
  expect(accentNow(await sidebarText())).toBe(THEMES.dracula.accent)
  expect(closes).toContainEqual(expect.objectContaining({ id: 'hud-theme' }))

  await startSession($)
  expect(accentNow(await sidebarText())).toBe(THEMES.dracula.accent)
})

test('Cancel drops the preview, closes the dialog and is not reopened by the focus retry', async ($, on) => {
  const opens: unknown[] = []
  const closes: unknown[] = []
  const clock = answerEngine(on, opens, closes)
  const { dialog, sidebarText } = await openPicker($)

  await focus($, 'theme:gruvbox-dark')
  expect(accentNow(await sidebarText())).toBe(THEMES['gruvbox-dark'].accent)
  await dialog.press({ key: 'theme-cancel' })
  expect(accentNow(await sidebarText())).toBe('claude')
  expect(closes).toContainEqual(expect.objectContaining({ id: 'hud-theme' }))

  await clock.advance(PICKER_FOCUS_RETRY_MS)
  expect(dialogOpens(opens)).toHaveLength(1)

  await startSession($)
  expect(accentNow(await sidebarText())).toBe('claude')
})

test('a focus move while no dialog is open previews nothing', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const sidebar = await mount($, 'hud', 'Agent HUD')
  await focus($, 'theme:dracula')
  expect(accentNow(JSON.stringify(await sidebar.drawn()))).toBe('claude')
})
