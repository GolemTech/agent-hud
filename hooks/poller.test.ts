import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BREW_TIMEOUT_MS, CMD_TIMEOUT_MS, UPDATE_TIMEOUT_MS } from './gentle'

const HOME = '/home/myuser'
const CWD = `${HOME}/code/demo-proj`

// The engine's bottom for the poller and the Pane, with `session.repo`
// failing: the branch refresh must not stop the subagent refresh.
const answerEngine = (on: On) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME })
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () =>
    ({ value: [{ id: 'hud', title: 'hud', isShown: true, isFocused: false, isPlaced: true }] }) as never,
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.id', () => ({ value: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }) as never)
  on('session.root', () => ({ value: CWD }) as never)
  on('session.cwd', () => ({ value: CWD }) as never)
  on('session.repo', () => {
    throw new Error('repo lookup failed')
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.version', () => ({ value: { version: '2.1.296', base: '2.1.296' } }) as never)
  on('session.usage', () => ({ value: { startedAt: 0 } }) as never)
  on('tool.list', () => ({ value: [] }) as never)
  on('agent.list', () =>
    ({ value: [{ id: 'a1', type: 'Explore', description: 'Map the flow', status: 'running' }] }) as never,
  )
  on('fs.read', () => {
    throw new Error('no such file')
  })
  on('fs.exists', () => ({ value: false }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }) as never)
  on('process.run', () => ({ value: { stdout: '+0000\n', stderr: '', exitCode: 0 } }) as never)
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

test('a failing source does not stop the poller from refreshing subagents', async ($, on) => {
  const clock = answerEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  // Only the first tick: it is one that refreshes the branch (every 5th).
  await clock.settle()
  const pane = await mountPane($)
  expect(JSON.stringify(await pane.drawn())).toContain('Map the flow')
})

// ── Command timeouts ─────────────────────────────────────────────────────

const BRANCH = 'feat/timeouts'
type Run = { argv: readonly string[]; init?: { timeoutMs?: number } }

// A repository whose git commands answer until `git.fail` is set; then they
// reject, as `$.process.run` does when a command outlasts its `timeoutMs`.
const answerRepoEngine = (on: On) => {
  const runs: Run[] = []
  const git = { fail: false }
  const clock = mock.clock(on)
  mock.env(on, { HOME })
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
  on('session.usage', () => ({ value: { startedAt: 0 } }) as never)
  on('tool.list', () => ({ value: [] }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('fs.read', () => {
    throw new Error('no such file')
  })
  on('fs.exists', () => ({ value: false }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }) as never)
  on('process.run', (_$, e) => {
    const run = e as Run
    runs.push(run)
    const argv = run.argv.join(' ')
    if (run.argv[0] === 'git' && git.fail) throw new Error('timed out')
    const stdout =
      argv === 'git branch --show-current'
        ? `${BRANCH}\n`
        : argv === 'git diff --shortstat HEAD'
          ? ' 1 file changed, 5 insertions(+), 2 deletions(-)\n'
          : argv === 'gentle-ai --version'
            ? 'gentle-ai 4.0.0\n'
            : '+0000\n'
    return { value: { stdout, stderr: '', exitCode: 0 } } as never
  })
  return { clock, runs, git }
}

test('every command the poller and the detection run carries a timeout', async ($, on) => {
  const { clock, runs } = answerRepoEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  expect(runs.some(r => r.argv[0] === 'git')).toBe(true)
  expect(runs.some(r => r.argv[0] === 'brew')).toBe(true)
  expect(runs.some(r => r.argv[0] === 'gentle-ai')).toBe(true)
  for (const r of runs) {
    const expected =
      r.argv[0] === 'brew' ? BREW_TIMEOUT_MS : r.argv.join(' ') === 'gentle-ai update' ? UPDATE_TIMEOUT_MS : CMD_TIMEOUT_MS
    expect(r.init?.timeoutMs).toBe(expected)
  }
})

test('a timed-out git refresh keeps the last known branch and change counts', async ($, on) => {
  const { clock, git } = answerRepoEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  const pane = await mountPane($)
  const before = JSON.stringify(await pane.drawn())
  expect(before).toContain(BRANCH)
  expect(before).toContain('+5')

  git.fail = true
  await clock.advance(5000) // tick 6 refreshes the branch again
  const after = JSON.stringify(await pane.drawn())
  expect(after).toContain(BRANCH)
  expect(after).toContain('+5')
  expect(after).toContain('-2')
})
