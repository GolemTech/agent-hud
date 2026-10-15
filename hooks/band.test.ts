import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { isSidebarShown } from './register'

// The engine's bottom for everything the pane and the band read or call.
// `ui.panes` answers from what `ui.open` / `ui.close` did, as the engine does.
const answerEngine = (on: On) => {
  const open = new Set<string>(['hud'])
  mock.clock(on)
  on('ui.open', (_$, e) => {
    open.add(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', (_$, e) => {
    open.delete(e.id)
    return { value: undefined } as never
  })
  on('ui.panes', () =>
    ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }) as never,
  )
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box as never, {}) as never // the engine draws nothing there
  })
  on('session.usage', () =>
    ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 55 }, rateLimits: [] } }) as never,
  )
  on('tool.list', () => ({ value: [{ name: 'mcp__engram__mem_save', mcp: true }] }) as never)
  on('session.id', () => ({ value: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.cwd', () => ({ value: '/home/myuser' }) as never)
  return open
}

const mountBand = ($: Engine) =>
  $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 80 } as never,
  })

const bandText = async ($: Engine) => JSON.stringify(await (await mountBand($)).drawn())

test('isSidebarShown: only an open, placed pane counts', () => {
  expect(isSidebarShown([{ id: 'hud', isPlaced: true }])).toBe(true)
  expect(isSidebarShown([{ id: 'hud', isPlaced: false }])).toBe(false) // narrow terminal
  expect(isSidebarShown([{ id: 'other', isPlaced: true }])).toBe(false)
  expect(isSidebarShown([])).toBe(false)
})

// Regression: closing the sidebar used to leave no band. The engine's close
// mark on the Pane frame (or ctrl+x x) closes it: 'hud' leaves the open set.
test('closing the sidebar shows the band, and its button brings it back', async ($, on) => {
  const open = answerEngine(on)
  expect(await bandText($)).not.toContain('Agent HUD')

  open.delete('hud')
  const band = await mountBand($)
  const shown = JSON.stringify(await band.drawn())
  expect(shown).toContain('Agent HUD')
  expect(shown).toContain('55%')

  await band.press({ key: 'expand' })
  expect(await bandText($)).not.toContain('Agent HUD')
})

// The band's row wraps on a narrow terminal: a `gap` there would also be a row
// gap, a blank line between its wrapped lines. It spaces items by columnGap.
test('the band spaces its wrapping row with columnGap, never a row gap', async ($, on) => {
  const open = answerEngine(on)
  open.delete('hud')
  const tree = (await (await mountBand($)).drawn()) as { props?: Record<string, unknown> }
  expect(tree.props?.flexWrap).toBe('wrap')
  expect(tree.props?.gap).toBeUndefined()
  expect(tree.props?.columnGap).toBe(1)
})
