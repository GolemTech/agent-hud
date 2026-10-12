import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { isSupportedVersion, MIN_CLAUDE_CODE_VERSION, unsupportedMessage } from './version'

test('the minimum is 2.1.295', () => {
  expect(MIN_CLAUDE_CODE_VERSION).toBe('2.1.295')
})

test('isSupportedVersion compares major, minor and patch as numbers', () => {
  expect(isSupportedVersion('2.1.295')).toBe(true) // equal
  expect(isSupportedVersion('2.1.296')).toBe(true) // newer patch
  expect(isSupportedVersion('2.1.1000')).toBe(true) // numeric, not text, compare
  expect(isSupportedVersion('2.2.0')).toBe(true) // newer minor
  expect(isSupportedVersion('3.0.0')).toBe(true) // newer major
  expect(isSupportedVersion('2.1.294')).toBe(false)
  expect(isSupportedVersion('2.1.288')).toBe(false)
  expect(isSupportedVersion('2.0.999')).toBe(false)
  expect(isSupportedVersion('1.9.300')).toBe(false)
})

test('isSupportedVersion reads decorated and prerelease versions by their core', () => {
  expect(isSupportedVersion('2.1.296 (Claude Code)')).toBe(true)
  expect(isSupportedVersion(' v2.1.295 ')).toBe(true)
  expect(isSupportedVersion('2.1.295-dev.20260920.t101500.sha1a2b3c4')).toBe(true)
  expect(isSupportedVersion('2.1.288-dev')).toBe(false)
})

test('isSupportedVersion is undefined for an unknown version, which never blocks', () => {
  expect(isSupportedVersion(undefined)).toBeUndefined()
  expect(isSupportedVersion('')).toBeUndefined()
  expect(isSupportedVersion('garbage')).toBeUndefined()
  expect(isSupportedVersion('2.1')).toBeUndefined()
  expect(isSupportedVersion('x2.1.295')).toBeUndefined()
})

test('unsupportedMessage names the minimum, the version found and the fix', () => {
  expect(unsupportedMessage('2.1.288')).toBe(
    "Agent HUD needs Claude Code 2.1.295 or newer (found 2.1.288). Run 'claude update'.",
  )
})

// The engine's bottom for the poller and the Pane, answering `version`.
const answerEngine = (on: On, version: string, toasts: string[]) => {
  mock.clock(on)
  mock.env(on, { HOME: '/home/myuser' })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () =>
    ({ value: [{ id: 'hud', title: 'hud', isShown: true, isFocused: false, isPlaced: true }] }) as never,
  )
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? JSON.stringify(e)))
    return { value: undefined } as never
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.version', () => ({ value: { version, base: version } }) as never)
  on('session.id', () => ({ value: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }) as never)
  on('session.root', () => ({ value: '/home/myuser/code/example' }) as never)
  on('session.cwd', () => ({ value: '/home/myuser/code/example' }) as never)
  on('session.repo', () => ({ value: { root: '/home/myuser/code/example', remote: null } }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 55 } } }) as never)
  on('tool.list', () => ({ value: [] }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('fs.read', () => ({ value: '{}' }) as never)
  on('fs.exists', () => ({ value: false }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }) as never)
  on('process.run', () => ({ value: { stdout: 'main\n', stderr: '', exitCode: 0 } }) as never)
}

const paneText = async ($: Engine) => {
  await $.session.start({ cwd: '/home/myuser/code/example', surface: 'terminal', isInteractive: true } as never)
  const pane = await $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'hud',
    props: { title: 'Agent HUD', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })
  return JSON.stringify(await pane.drawn())
}

test('on Claude Code 2.1.288 the Pane draws only the update notice', async ($, on) => {
  const toasts: string[] = []
  answerEngine(on, '2.1.288', toasts)
  const drawn = await paneText($)
  expect(drawn).toContain('Agent HUD needs Claude Code 2.1.295 or newer (found 2.1.288)')
  expect(drawn).not.toContain('55%')
  expect(drawn).not.toContain('Context')
  expect(toasts.join('\n')).toContain('needs Claude Code 2.1.295')
})

test('on Claude Code 2.1.295 the Pane draws the full HUD', async ($, on) => {
  const toasts: string[] = []
  answerEngine(on, '2.1.295', toasts)
  const drawn = await paneText($)
  expect(drawn).toContain('55%')
  expect(drawn).toContain('Context')
  expect(drawn).not.toContain('needs Claude Code')
  expect(toasts).toEqual([])
})
