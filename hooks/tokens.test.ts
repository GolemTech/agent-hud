import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const HOME = '/home/myuser'
const CWD = `${HOME}/code/demo-proj`

// One response's usage: a context of `context` tokens, mostly cache reads.
const usage = (context: number) => ({
  input_tokens: 2_000,
  cache_read_input_tokens: context - 2_000,
  cache_creation_input_tokens: 0,
  output_tokens: 500,
  model: 'claude-opus-5-5',
})

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
  on('session.repo', () => ({ value: null }) as never)
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
  on('turn.complete', (_$, e) => ({ text: '', usage: (e as { usage?: unknown }).usage }) as never)
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

// A turn's usage is its requests' counts summed (each request re-reads the
// cached context), so a long subagent turn reports millions. The card shows a
// context size, taken per request from `turn.step`; the summed turn.complete
// usage must never reach it. (The kit could not be made to answer turn.step
// in a test, so the per-request path is covered by `ctxTokens` alone.)
test('a subagent turn summed usage never becomes the card token count', async ($, on) => {
  const clock = answerEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  await $.turn.complete({ agentId: 'a1', usage: usage(8_200_000), reason: 'answered' } as never)
  await clock.advance(1000)
  const text = JSON.stringify(await (await mountPane($)).drawn())
  expect(text).toContain('Map the flow')
  expect(text).not.toContain('8.2M')
})
