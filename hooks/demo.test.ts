import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { demoSnapshot } from './demo'

const byId = (elapsedMs: number) => new Map(demoSnapshot(elapsedMs).agents.map(a => [a.id, a]))
const statuses = (elapsedMs: number) => demoSnapshot(elapsedMs).todos.map(t => t.status)

test('demoSnapshot: fixed sample session, no personal data', () => {
  const d = demoSnapshot(0)
  expect(d.session.title).toBe('checkout-refactor')
  expect(d.session.account).toBe('you@Acme')
  expect(d.session.outputStyle).toBe('Explanatory')
  expect(d.session.changes).toEqual({ added: 42, removed: 7 })
  expect(d.session.aheadBehind).toEqual({ ahead: 3, behind: 1 })
  expect(d.session.cwd.startsWith(d.session.home)).toBe(true)
  expect(d.meters.map(m => m.label)).toEqual(['ctx', '5h', '7d'])
  expect(d.footer).toBe('420,118 tokens · $3.42 spent')
  expect(d.servers.map(s => s.connected)).toEqual([true, true, true, false])
})

test('demoSnapshot at 0 ms: A1 and A2 running, first todo in progress', () => {
  const agents = byId(0)
  expect([...agents.keys()]).toEqual(['A1', 'A2'])
  expect(agents.get('A1')?.status).toBe('running')
  expect(agents.get('A1')?.done).toBe(false)
  expect(agents.get('A1')?.tokens).toBe(undefined)
  expect(agents.get('A2')?.status).toBe('running')
  expect(statuses(0)).toEqual(['in_progress', 'pending', 'pending', 'pending', 'pending', 'pending'])
})

test('demoSnapshot at 6000 ms: A1 completed with tokens, A4 running', () => {
  const agents = byId(6000)
  expect([...agents.keys()]).toEqual(['A1', 'A2', 'A3', 'A4'])
  expect(agents.get('A1')).toEqual({
    id: 'A1',
    type: 'Explore',
    description: 'Map the checkout flow',
    status: 'completed',
    elapsedMs: 5000,
    done: true,
    tokens: 12_400,
    model: 'claude-haiku-5-5',
    effort: 'low',
  })
  expect(agents.get('A2')?.status).toBe('running')
  expect(agents.get('A3')?.elapsedMs).toBe(4000)
  expect(agents.get('A4')?.status).toBe('running')
  expect(agents.get('A4')?.elapsedMs).toBe(0)
  expect(agents.get('A4')?.tokens).toBe(undefined)
  expect(statuses(6000)).toEqual(['completed', 'completed', 'in_progress', 'pending', 'pending', 'pending'])
})

test('demoSnapshot at 20000 ms: A1-A3 completed, A4 failed, all todos completed', () => {
  const agents = byId(20_000)
  for (const id of ['A1', 'A2', 'A3']) {
    expect(agents.get(id)?.status).toBe('completed')
    expect(agents.get(id)?.done).toBe(true)
  }
  expect(agents.get('A3')?.elapsedMs).toBe(10_000)
  expect(agents.get('A3')?.tokens).toBe(18_900)
  expect(agents.get('A4')?.status).toBe('failed')
  expect(agents.get('A4')?.done).toBe(true)
  expect(agents.get('A4')?.tokens).toBe(7_200)
  expect(statuses(20_000).every(s => s === 'completed')).toBe(true)
  expect(statuses(15_000).every(s => s === 'completed')).toBe(true)
})

test('demoSnapshot: Gentle AI section with fictional static values', () => {
  const g = demoSnapshot(0).gentle
  expect(g.tools.map(t => `${t.name} ${t.version} ${t.update ?? '-'}`)).toEqual([
    'gentle-ai 4.0.0 -',
    'gga 2.10.1 -',
    'engram 2.2.1 3.3.0',
  ])
  expect(g.root).toBe(demoSnapshot(0).session.cwd)
  expect(g.gga).toEqual({ hook: false, projectConfig: true, rulesFile: 'AGENTS.md', rules: true })
  expect(g.rdd?.effective).toBe('on')
  expect(g.strictTdd).toBe('unset')
})

// ── Wiring ───────────────────────────────────────────────────────────────

const HOME = '/home/myuser'
const CWD = `${HOME}/code/live-proj`
const SESSION_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

// The engine's bottom for the poller and the Pane: a live session with no
// title or account files and no Gentle AI tools.
const answerEngine = (on: On) => {
  const clock = mock.clock(on)
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
  on('session.repo', () => ({ value: null }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.version', () => ({ value: { version: '2.1.296', base: '2.1.296' } }) as never)
  on('session.usage', () => ({ value: { startedAt: 0 } }) as never)
  on('tool.list', () => ({ value: [] }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('fs.read', () => {
    throw new Error('no such file')
  })
  on('process.run', () => ({ value: { stdout: '+0000\n', stderr: '', exitCode: 0 } }) as never)
  return clock
}

test('/hud-demo shows the sample session, and running it again restores live data', async ($, on) => {
  const clock = answerEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  const pane = await $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'hud',
    props: { title: 'Agent HUD', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })
  const paneText = async () => JSON.stringify(await pane.drawn())

  const live = await paneText()
  expect(live).toContain(SESSION_ID.slice(0, 8))
  expect(live).toContain('live-proj')
  expect(live).not.toContain('checkout-refactor')

  const onRes = await $.command.run({ command: 'hud-demo', args: '' } as never)
  expect(onRes.text).toContain('Demo mode on')
  await clock.advance(1000) // the next tick's rows write redraws the Pane
  const demo = await paneText()
  expect(demo).toContain('checkout-refactor')
  expect(demo).toContain('you@Acme')
  expect(demo).not.toContain('live-proj')
  // The demo footer shows an older install with a newer release out.
  expect(demo).toContain(' 2.1.296')
  expect(demo).toContain(' ↑ 2.1.301')

  const offRes = await $.command.run({ command: 'hud-demo', args: '' } as never)
  expect(offRes.text).toBe('Demo mode off.')
  await clock.advance(1000)
  const back = await paneText()
  expect(back).toContain(SESSION_ID.slice(0, 8))
  expect(back).toContain('live-proj')
  expect(back).not.toContain('checkout-refactor')
  expect(back).not.toContain('you@Acme')
})
