import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { THEMES } from './themes'

const HOME = '/home/myuser'
const CWD = `${HOME}/code/example`

// The engine's bottom for the poller, the Pane and the picker. `opens`
// collects every `$.ui.open` argument; `ui.focus` lands wherever it is asked.
const answerEngine = (on: On, opens: unknown[] = []) => {
  mock.clock(on)
  mock.env(on, { HOME })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', (_$, e) => {
    opens.push(e)
    return { value: { isPlaced: true } } as never
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
}

const startSession = ($: Engine) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)

const mountPane = ($: Engine) =>
  $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'hud',
    props: { title: 'Agent HUD', isFocused: true, bodyColumns: 60, placement: 'dock' } as never,
  })

// The person's focus ring moving onto one element of the Pane.
const focus = ($: Engine, element: string) =>
  $.ui.focus({
    component: 'Pane',
    requestId: 'hud',
    plugin: 'agent-hud',
    element,
    origin: { kind: 'person' },
  } as never)

const openPicker = async ($: Engine) => {
  await startSession($)
  const pane = await mountPane($)
  const text = (await $.command.run({ command: 'hud-theme', args: '' } as never)).text ?? ''
  const drawn = async () => JSON.stringify(await pane.drawn())
  return { pane, text, drawn }
}

// The HUD's own accent: the color of the header's hide button. The picker's
// rows draw every theme's accent as a swatch, so the whole tree cannot tell.
const accentNow = (drawn: string): string | undefined => /"key":"hide-sidebar".*?"color":"([^"]+)"/.exec(drawn)?.[1]

test('/hud-theme without a name opens the picker in a focused Pane and still lists the themes', async ($, on) => {
  const opens: unknown[] = []
  answerEngine(on, opens)
  const { text, drawn } = await openPicker($)

  expect(text).toContain('● default (active)')
  expect(opens.some(o => (o as { id?: string; focus?: boolean }).id === 'hud' && (o as { focus?: boolean }).focus === true)).toBe(true)

  const picker = await drawn()
  for (const name of Object.keys(THEMES)) expect(picker).toContain(`theme:${name}`)
  expect(picker).toContain('theme-cancel')
  expect(picker).not.toContain('Context') // the sections give way to the picker
})

test('focusing a theme previews it without saving; focus elsewhere reverts', async ($, on) => {
  answerEngine(on)
  const { drawn } = await openPicker($)

  await focus($, 'theme:dracula')
  expect(accentNow(await drawn())).toBe(THEMES.dracula.accent)

  await focus($, 'theme:nord')
  expect(accentNow(await drawn())).toBe(THEMES.nord.accent)

  // Off the theme buttons (Cancel, the header's hide button): the saved theme.
  await focus($, 'theme-cancel')
  const back = await drawn()
  expect(accentNow(back)).toBe('claude')
  expect(back).toContain('theme:dracula') // still picking

  // Nothing was saved: a new session loads the default again.
  await focus($, 'theme:dracula')
  await startSession($)
  const fresh = await drawn()
  expect(accentNow(fresh)).toBe('claude')
  expect(fresh).not.toContain('theme:dracula') // a new session closes the picker
})

test('pressing a theme saves it, closes the picker and survives a new session', async ($, on) => {
  answerEngine(on)
  const { pane, drawn } = await openPicker($)

  await focus($, 'theme:dracula')
  await pane.press({ key: 'theme:dracula' })
  const saved = await drawn()
  expect(accentNow(saved)).toBe(THEMES.dracula.accent)
  expect(saved).not.toContain('theme:nord') // picker closed
  expect(saved).toContain('Context')

  await startSession($)
  expect(accentNow(await drawn())).toBe(THEMES.dracula.accent)
})

test('Cancel drops the preview and closes the picker without saving', async ($, on) => {
  answerEngine(on)
  const { pane, drawn } = await openPicker($)

  await focus($, 'theme:gruvbox-dark')
  expect(accentNow(await drawn())).toBe(THEMES['gruvbox-dark'].accent)
  await pane.press({ key: 'theme-cancel' })
  const after = await drawn()
  expect(accentNow(after)).toBe('claude')
  expect(after).not.toContain('theme:dracula')

  await startSession($)
  expect(accentNow(await drawn())).toBe('claude')
})

test('a focus move while no picker is open previews nothing', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const pane = await mountPane($)
  await focus($, 'theme:dracula')
  expect(accentNow(JSON.stringify(await pane.drawn()))).toBe('claude')
})
