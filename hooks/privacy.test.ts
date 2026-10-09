import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { maskView } from './register'
import type { HudView } from './register'

// Generic fixture identity: each string must vanish from a masked view.
const ACCOUNT = 'alice@Example'
const TITLE = 'secret-title'
const SESSION_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const BRANCH = 'feature/secret-branch'
const HOME = '/home/myuser'
const CWD = `${HOME}/code/secret-proj`

const liveFixture = (): HudView => ({
  demo: false,
  private: false,
  title: TITLE,
  sessionId: SESSION_ID,
  account: ACCOUNT,
  mainModel: { model: 'claude-opus-5-5', effort: 'high' },
  branch: BRANCH,
  changes: { added: 12, removed: 3 },
  outputStyle: 'Explanatory',
  cwd: CWD,
  home: HOME,
  contextPercent: 42,
  meters: [{ label: 'ctx', percent: 42, note: ' · 1M' }],
  footer: '420,000 tokens · $1.00 spent',
  servers: [{ name: 'engram', connected: true }],
  agents: [
    { id: 'a1', type: 'Explore', description: 'Map the flow', status: 'running', elapsedMs: 1000, done: false },
  ],
  models: new Map([['a1', { model: 'claude-haiku-5-5', effort: 'low' }]]),
  todos: [{ id: 'w0', content: 'Write tests', status: 'in_progress' }],
})

test('maskView replaces every identity field and leaks none of them', () => {
  const live = liveFixture()
  const masked = maskView(live)
  expect(masked.private).toBe(true)
  expect(masked.account).toBe('you@example')
  expect(masked.title).toBe('private session')
  expect(masked.sessionId).toBe('')
  expect(masked.branch).toBe('••••')
  expect(masked.cwd).toBe('~/…')
  expect(masked.home).toBe(null)

  const json = JSON.stringify(masked)
  for (const real of [ACCOUNT, TITLE, SESSION_ID.slice(0, 8), BRANCH, 'myuser', 'secret-proj', 'code/']) {
    expect(json).not.toContain(real)
  }
})

test('maskView keeps every non-identity field as it was', () => {
  const live = liveFixture()
  const masked = maskView(live)
  expect(masked.demo).toBe(false)
  expect(masked.mainModel).toEqual(live.mainModel)
  // Not identity: the output style and the change counts stay visible.
  expect(masked.outputStyle).toBe('Explanatory')
  expect(masked.changes).toEqual({ added: 12, removed: 3 })
  expect(masked.contextPercent).toBe(live.contextPercent)
  expect(masked.meters).toEqual(live.meters)
  expect(masked.footer).toBe(live.footer)
  expect(masked.servers).toEqual(live.servers)
  expect(masked.agents).toEqual(live.agents)
  expect(masked.models).toBe(live.models)
  expect(masked.todos).toEqual(live.todos)
  expect(live.account).toBe(ACCOUNT) // the input is left untouched
})

// The engine's bottom for the poller (title, account, branch, offset) and for
// everything the Pane reads.
const answerEngine = (on: On) => {
  mock.clock(on)
  mock.env(on, { HOME })
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () =>
    ({ value: [{ id: 'hud', title: 'hud', isShown: true, isFocused: false, isPlaced: true }] }) as never,
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.id', () => ({ value: SESSION_ID }) as never)
  on('session.root', () => ({ value: CWD }) as never)
  on('session.cwd', () => ({ value: CWD }) as never)
  on('session.repo', () => ({ value: { root: CWD, remote: null } }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 55 } } }) as never)
  on('tool.list', () => ({ value: [] }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('fs.read', (_$, e) => {
    const path = (e as { path: string }).path
    const text = path.endsWith('custom-title.json')
      ? JSON.stringify({ customTitle: TITLE })
      : JSON.stringify({ oauthAccount: { emailAddress: 'alice@mail.test', organizationName: 'Example' } })
    return { value: text } as never
  })
  on('process.run', (_$, e) => {
    const argv = (e as { argv: readonly string[] }).argv
    return { value: { stdout: argv[0] === 'git' ? `${BRANCH}\n` : '+0000\n', stderr: '', exitCode: 0 } } as never
  })
}

const mountPane = ($: Engine) =>
  $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'hud',
    props: { title: 'Agent HUD', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })

test('/hud-private masks the live Session section and toggles back', async ($, on) => {
  answerEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  // Let the first poller tick fill the title, account and branch caches.
  for (let i = 0; i < 50; i++) await Promise.resolve()
  const pane = await mountPane($)
  // The command's atom write redraws the mounted Pane.
  const paneText = async () => JSON.stringify(await pane.drawn())

  const live = await paneText()
  expect(live).toContain(ACCOUNT)
  expect(live).toContain(BRANCH)
  expect(live).not.toContain('🔒 private')

  const on1 = await $.command.run({ command: 'hud-private', args: '' } as never)
  expect(on1.text).toContain('on')
  const masked = await paneText()
  expect(masked).toContain('🔒 private')
  expect(masked).toContain('you@example')
  expect(masked).toContain('55%')
  for (const real of [ACCOUNT, BRANCH, TITLE, 'secret-proj', 'myuser']) expect(masked).not.toContain(real)

  const off = await $.command.run({ command: 'hud-private', args: '' } as never)
  expect(off.text).toContain('off')
  const back = await paneText()
  expect(back).toContain(ACCOUNT)
  expect(back).toContain(BRANCH)
  expect(back).not.toContain('🔒 private')
})
