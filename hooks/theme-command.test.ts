import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { THEMES } from './themes'

const HOME = '/home/myuser'
const CWD = `${HOME}/code/example`

// The engine's bottom for the poller and everything the Pane reads. `store`
// is what `$.store` holds before the session starts.
const answerEngine = (on: On, store: Record<string, unknown> = {}) => {
  const clock = mock.clock(on)
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
  on('tool.list', () => ({ value: [{ name: 'mcp__engram__mem_save', mcp: true }] }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('fs.read', () => ({ value: '{}' }) as never)
  on('fs.exists', () => ({ value: false }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }) as never)
  on('process.run', () => ({ value: { stdout: 'main\n', stderr: '', exitCode: 0 } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return clock
}

const mountPane = ($: Engine) =>
  $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'hud',
    props: { title: 'Agent HUD', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })

const startSession = ($: Engine) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)

const hudTheme = async ($: Engine, args: string) =>
  (await $.command.run({ command: 'hud-theme', args } as never)).text ?? ''

test('/hud-theme switches the Pane to a preset live and back to the theme keys', async ($, on) => {
  answerEngine(on)
  await startSession($)
  const pane = await mountPane($)
  const drawn = async () => JSON.stringify(await pane.drawn())

  const before = await drawn()
  expect(before).toContain('"color":"claude"')
  expect(before).not.toContain(THEMES.dracula.accent)

  expect(await hudTheme($, ' Dracula ')).toContain('dracula')
  const dracula = await drawn()
  expect(dracula).toContain(`"color":"${THEMES.dracula.accent}"`)
  expect(dracula).toContain(`"color":"${THEMES.dracula.subtle}"`)
  expect(dracula).not.toContain('"color":"claude"')
  expect(dracula).not.toContain('"color":"subtle"')

  expect(await hudTheme($, 'default')).toContain('default')
  expect(await drawn()).toContain('"color":"claude"')
})

test('/hud-theme lists the themes with the active one marked, and rejects unknown names', async ($, on) => {
  answerEngine(on)
  await startSession($)
  await hudTheme($, 'tokyo night')

  const list = await hudTheme($, '')
  expect(list).toContain('● tokyo-night (active)')
  for (const name of Object.keys(THEMES)) expect(list).toContain(name)
  expect(Object.keys(THEMES)).toHaveLength(31)
  expect(list.split('\n').filter(line => /^(● |  )\S/.test(line))).toHaveLength(31)

  const unknown = await hudTheme($, 'paper-white')
  expect(unknown).toContain('Unknown HUD theme "paper-white"')
  expect(unknown).toContain('rose-pine')
  // An unknown name changes nothing.
  expect(await hudTheme($, '')).toContain('● tokyo-night (active)')
})

test('the stored theme is applied at session start, and a switch is persisted', async ($, on) => {
  answerEngine(on, { theme: 'nord' })
  await startSession($)
  const pane = await mountPane($)
  expect(JSON.stringify(await pane.drawn())).toContain(`"color":"${THEMES.nord.accent}"`)

  await hudTheme($, 'gruvbox-dark')
  // A new session loads the store into the atom again: had the switch not
  // been saved, the Pane would be back on nord.
  await startSession($)
  const again = JSON.stringify(await pane.drawn())
  expect(again).toContain(`"color":"${THEMES['gruvbox-dark'].accent}"`)
  expect(again).not.toContain(THEMES.nord.accent)
})

test('an unknown stored theme falls back to default', async ($, on) => {
  answerEngine(on, { theme: 'no-such-theme' })
  await startSession($)
  const drawn = JSON.stringify(await (await mountPane($)).drawn())
  expect(drawn).toContain('"color":"claude"')
})
