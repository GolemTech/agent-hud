import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { BRANCH_ICON } from './layout'

const HOME = '/home/myuser'
const CWD = `${HOME}/code/demo-proj`
const BRANCH = 'feat/session-line'

// The project's local settings file; a test switches the style in it.
const LEARNING = JSON.stringify({ outputStyle: 'Learning' })
let localSettings = LEARNING

// The engine's bottom for the poller and the Pane. `git diff --shortstat HEAD`
// reports changes, the project's local settings name an output style, and
// `prompt.compose` answers an empty section list.
const answerEngine = (on: On, diff: string) => {
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
  on('fs.read', (_$, e) => {
    const path = (e as { path: string }).path
    if (path === `${CWD}/.claude/settings.local.json`) return { value: localSettings } as never
    throw new Error('no such file')
  })
  on('process.run', (_$, e) => {
    const argv = (e as { argv: readonly string[] }).argv.join(' ')
    const stdout = argv === 'git branch --show-current' ? `${BRANCH}\n` : argv === 'git diff --shortstat HEAD' ? diff : '+0000\n'
    return { value: { stdout, stderr: '', exitCode: 0 } } as never
  })
  on('prompt.compose', () => ({ sections: [] }) as never)
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

const compose = (outputStyle: { name: string; isKeepingCodingInstructions: boolean } | null) =>
  ({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle, traits: [] }) as never

test('the Session section shows the branch with its change counts and the output style', async ($, on) => {
  const clock = answerEngine(on, ' 3 files changed, 42 insertions(+), 7 deletions(-)\n')
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  const pane = await mountPane($)
  const text = async () => JSON.stringify(await pane.drawn())

  const before = await text()
  expect(before).toContain(BRANCH)
  expect(before).toContain('+42')
  expect(before).toContain('-7')
  // Before any request, the style comes from the settings files.
  expect(before).toContain('Learning')

  // The style the engine composes with wins over the settings.
  const res = await $.prompt.compose(compose({ name: 'Explanatory', isKeepingCodingInstructions: true }))
  expect(res.sections).toEqual([])
  await clock.advance(1000)
  const after = await text()
  expect(after).toContain('Explanatory')
  expect(after).not.toContain('Learning')

  // A compose with no style (a subagent's request carries none) keeps the
  // main loop's style instead of hiding the line.
  await $.prompt.compose(compose(null))
  await clock.advance(1000)
  const kept = await text()
  expect(kept).toContain('Explanatory')
  expect(kept).toContain('🎭')
})

test('a clean working tree shows the branch without change counts', async ($, on) => {
  const clock = answerEngine(on, '')
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  const text = JSON.stringify(await (await mountPane($)).drawn())
  expect(text).toContain(BRANCH)
  expect(text).toContain(BRANCH_ICON)
  expect(text).not.toContain('🌿')
  expect(text).not.toContain('+0')
})

test('the branch icon is the standard ⑂, bold in the theme accent', async ($, on) => {
  const clock = answerEngine(on, '')
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  const text = JSON.stringify(await (await mountPane($)).drawn())
  expect(text).toContain('{"type":"Text","props":{"bold":true,"color":"claude"},"children":["⑂"]}')
})

test('the footer shows the Claude Code version', async ($, on) => {
  const clock = answerEngine(on, '')
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  const text = JSON.stringify(await (await mountPane($)).drawn())
  expect(text).toContain('Claude')
  expect(text).toContain('Code')
  expect(text).toContain('2.1.296')
})

test('a style switch in the settings mid-session shows, back to the default included', async ($, on) => {
  const clock = answerEngine(on, '')
  try {
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
    await clock.settle()
    const pane = await mountPane($)
    const text = async () => JSON.stringify(await pane.drawn())

    await $.prompt.compose(compose({ name: 'Explanatory', isKeepingCodingInstructions: true }))
    await clock.advance(1000)
    expect(await text()).toContain('Explanatory')

    // The settings unchanged: a style-less compose still keeps the line.
    await clock.advance(30_000)
    await $.prompt.compose(compose(null))
    await clock.advance(1000)
    expect(await text()).toContain('Explanatory')

    // The person picks the default style: the setting changes, the line goes.
    localSettings = JSON.stringify({ outputStyle: 'default' })
    await clock.advance(30_000)
    const cleared = await text()
    expect(cleared).not.toContain('Explanatory')
    expect(cleared).not.toContain('🎭')

    // A named style composed later shows again.
    await $.prompt.compose(compose({ name: 'Learning', isKeepingCodingInstructions: true }))
    await clock.advance(1000)
    expect(await text()).toContain('Learning')
  } finally {
    localSettings = LEARNING
  }
})
