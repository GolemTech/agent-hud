import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  BRANCH_ICON,
  centerBand,
  clampOffset,
  columnWidth,
  flowRows,
  gridFor,
  HEADING_INDENT,
  ITEM_INDENT,
  HEADER_ROWS,
  layoutFor,
  MAX_BAR,
  maxScrollOffset,
  MIN_BAR,
  PANE_PADDING_X,
  ruleWidth,
  SCROLL_BOTTOM_MARGIN,
  textRows,
  viewportRowsFor,
  FOOTER_ROWS,
} from './layout'
import { SETTINGS_BUTTON, SETTINGS_BUTTON_CELLS, SETTINGS_KEY } from './settings'

// ── Pure helpers ─────────────────────────────────────────────────────────

test('layoutFor: drawable columns are the pane body less its padding', () => {
  expect(layoutFor(40, 30).columns).toBe(40 - 2 * PANE_PADDING_X)
  expect(layoutFor(40, 30).rows).toBe(30)
})

test('layoutFor: falls back to a default size when the engine reports none', () => {
  const l = layoutFor(undefined, undefined)
  expect(l.columns).toBeGreaterThan(0)
  expect(l.rows).toBeGreaterThan(0)
})

test('layoutFor: meter bars scale with the width, within bounds', () => {
  expect(layoutFor(10, 24).barWidth).toBe(MIN_BAR)
  expect(layoutFor(300, 24).barWidth).toBe(MAX_BAR)
  expect(layoutFor(28, 24).barWidth).toBeLessThan(layoutFor(60, 24).barWidth)
  for (const cols of [20, 28, 40, 60, 100]) {
    const l = layoutFor(cols, 24)
    // Label (4) + bar + percent (5) always fits the drawable width.
    expect(4 + l.barWidth + 5).toBeLessThanOrEqual(l.columns)
  }
})

test('layoutFor: compact forms below the full counts width only', () => {
  expect(layoutFor(20, 24).compact).toBe(true)
  expect(layoutFor(28, 24).compact).toBe(true)
  expect(layoutFor(40, 24).compact).toBe(false)
  expect(layoutFor(100, 24).compact).toBe(false)
})

test('columnWidth: the widest text, 0 for none', () => {
  expect(columnWidth(['gga', 'gentle-ai', 'project'])).toBe(9)
  expect(columnWidth(['✓', '2.10.1', '—'])).toBe(6)
  expect(columnWidth([])).toBe(0)
})

test('gridFor: label column = item indent + longest label; headings span label and value when that fits', () => {
  expect(ITEM_INDENT).toBe(2)
  expect(HEADING_INDENT).toBe(1)
  expect(gridFor(['gentle-ai', 'hook'], ['4.0.0', '✓', '2.10.1'], 40)).toEqual({ label: 11, value: 6, head: 18 })
  // Too narrow for the heading to reach the detail column: it keeps the label's.
  expect(gridFor(['gentle-ai'], ['2.10.1'], 17)).toEqual({ label: 11, value: 6, head: 11 })
})

test('textRows: wrapped rows of a text, at least one', () => {
  expect(textRows(0, 20)).toBe(1)
  expect(textRows(20, 20)).toBe(1)
  expect(textRows(21, 20)).toBe(2)
  expect(textRows(5, 0)).toBe(5)
})

test('flowRows: greedy flex-wrap line count with gaps', () => {
  expect(flowRows([], 20)).toBe(0)
  expect(flowRows([10, 4, 4], 20)).toBe(1) // 10 + 1 + 4 + 1 + 4 = 20
  expect(flowRows([10, 4, 5], 20)).toBe(2)
  expect(flowRows([30, 4], 20)).toBe(2) // an item wider than the line sits alone
  expect(flowRows([7, 7, 7], 7)).toBe(3)
})

test('maxScrollOffset: none while the content fits, else the overflow plus a bottom margin', () => {
  expect(SCROLL_BOTTOM_MARGIN).toBeGreaterThanOrEqual(1)
  expect(maxScrollOffset(10, 20)).toBe(0)
  expect(maxScrollOffset(20, 20)).toBe(0)
  expect(maxScrollOffset(50, 20)).toBe(50 - 20 + SCROLL_BOTTOM_MARGIN)
  expect(maxScrollOffset(0, 0)).toBe(0)
})

test('clampOffset: within [0, max], whole rows', () => {
  expect(clampOffset(-3, 10)).toBe(0)
  expect(clampOffset(4, 10)).toBe(4)
  expect(clampOffset(40, 10)).toBe(10)
  expect(clampOffset(5, 0)).toBe(0)
  expect(clampOffset(2.6, 10)).toBe(3)
  expect(clampOffset(Number.NaN, 10)).toBe(0)
})

test('centerBand: centered in the width, truncated with … when it does not fit', () => {
  expect(centerBand('abc', 9)).toBe('   abc   ')
  expect(centerBand('abcd', 9)).toBe('  abcd   ')
  expect(centerBand('abcdef', 6)).toBe('abcdef')
  expect(centerBand('abcdefgh', 6)).toBe('abcde…')
  expect(centerBand('abc', 1)).toBe('…')
})

test('viewportRowsFor: the body less the sticky header and footer, at least one', () => {
  expect(viewportRowsFor(30, true)).toBe(30 - HEADER_ROWS - FOOTER_ROWS)
  expect(viewportRowsFor(30, false)).toBe(30 - HEADER_ROWS)
  expect(viewportRowsFor(2, true)).toBe(1)
})

test('BRANCH_ICON is the standard Unicode ⑂, one code unit', () => {
  expect(BRANCH_ICON).toBe('\u2442')
  expect(BRANCH_ICON.length).toBe(1)
})

// ── Rendering at several sizes ───────────────────────────────────────────

const HOME = '/home/myuser'
const CWD = `${HOME}/code/live-proj`

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
  on('agent.list', () => ({ value: [] }) as never)
  on('fs.read', () => {
    throw new Error('no such file')
  })
  on('fs.exists', () => ({ value: false }) as never)
  on('process.run', () => ({ value: { stdout: '+0000\n', stderr: '', exitCode: 0 } }) as never)
  return clock
}

const paneProps = (bodyColumns: number, bodyRows: number) =>
  ({
    title: 'Agent HUD',
    isFocused: false,
    bodyColumns,
    placement: 'dock',
    scroll: { offset: 0, bodyRows },
  }) as never

// Demo mode with four subagents, six todos, MCP and Gentle AI sample values.
// Demo mode is module state (`demoStartedAt`): `body` runs inside it and demo
// mode is left afterwards even when an assertion fails, so no test inherits it.
const inDemo = async (
  $: Engine,
  on: On,
  bodyColumns: number,
  bodyRows: number,
  body: (pane: {
    drawn: () => Promise<unknown>
    redraw: (props: never) => Promise<void>
    press: (target: { key: string }) => Promise<unknown>
  }) => Promise<void>,
) => {
  const clock = answerEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  await $.command.run({ command: 'hud-demo', args: '' } as never)
  try {
    await clock.advance(6000)
    const pane = await $.ui.mount({
      plugin: 'agent-hud',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'hud',
      props: paneProps(bodyColumns, bodyRows),
    })
    await body(pane)
  } finally {
    await $.command.run({ command: 'hud-demo', args: '' } as never)
  }
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null
const textOf = (n: unknown): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n) : isNode(n) ? (n.children ?? []).map(textOf).join('') : ''
const all = (n: unknown, type: string, out: Node[] = []): Node[] => {
  if (!isNode(n)) return out
  if (n.type === type) out.push(n)
  for (const c of n.children ?? []) all(c, type, out)
  return out
}
const elements = (n: Node): Node[] => (n.children ?? []).filter(isNode)
const truncates = (t: Node) => String(t.props?.wrap ?? '').startsWith('truncate')

// The responsive rules, read off the drawn tree: a row of several elements
// wraps, and each of its items either keeps its width (flexShrink 0, a
// Button) or only holds truncating Text, so nothing is squeezed into one
// letter per line. A width-keeping item never exceeds the drawable width.
const checkRules = (tree: unknown, columns: number) => {
  for (const box of all(tree, 'Box')) {
    const direction = box.props?.flexDirection ?? 'row'
    const items = elements(box)
    if (direction === 'row' && items.length > 1) {
      expect({ row: textOf(box), flexWrap: box.props?.flexWrap }).toEqual({ row: textOf(box), flexWrap: 'wrap' })
      for (const item of items) {
        const keeps = item.type === 'Button' || (item.type === 'Box' && item.props?.flexShrink === 0)
        const texts = item.type === 'Text' ? [item] : all(item, 'Text').filter(t => !all(tree, 'Text').some(p => elements(p).includes(t)))
        const ok = keeps || texts.every(truncates)
        expect({ item: textOf(item), ok }).toEqual({ item: textOf(item), ok: true })
      }
    }
    // A column Box with flexShrink 0 is a container (the scrolled content,
    // the sticky header and footer), not a width-keeping label.
    if (box.props?.flexShrink === 0 && box.props?.flexDirection !== 'column') {
      const width = textOf(box).length
      expect({ fixed: textOf(box), fits: width <= columns }).toEqual({ fixed: textOf(box), fits: true })
    }
  }
}

for (const cols of [20, 28, 40, 60, 100]) {
  test(`at ${cols} columns, labels keep their width and rows wrap`, async ($, on) => {
    await inDemo($, on, cols, 60, async pane => {
      checkRules(await pane.drawn(), layoutFor(cols, 60).columns)
    })
  })
}

// Review focus: a narrow dock with the settings block open keeps the rules,
// and the header band is counted at exactly the drawable width (the settings button as
// SETTINGS_BUTTON_CELLS cells with its spaces), so it never wraps past HEADER_ROWS.
for (const cols of [20, 28, 100]) {
  test(`at ${cols} columns, the settings block keeps the rules and the header one band`, async ($, on) => {
    await inDemo($, on, cols, 60, async pane => {
      await pane.press({ key: SETTINGS_KEY })
      const tree = (await pane.drawn()) as Node
      const W = layoutFor(cols, 60).columns
      checkRules(tree, W)
      expect(textOf(tree)).toContain('[close]')
      const bandRow = elements(elements(tree)[0] as Node)[0] as Node
      expect(textOf(bandRow).length - SETTINGS_BUTTON.length + SETTINGS_BUTTON_CELLS).toBe(W)
      // The band's own text plus the button reach the edge, nothing unpainted.
      const band = all(bandRow, 'Text').find(t => t.props?.inverse === true && t.props?.wrap === 'truncate-end') as Node
      expect(textOf(band).length + SETTINGS_BUTTON_CELLS).toBe(W)
    })
  })
}

// The wider settings button still leaves the project-name band a column at
// the narrowest dock, and the header draws one band row plus the blank row
// (HEADER_ROWS): the band and the seven-cell button fit on one line.
test('at 20 columns, the wide settings button leaves the name band a column and one header row', async ($, on) => {
  await inDemo($, on, 20, 60, async pane => {
    const tree = (await pane.drawn()) as Node
    const W = layoutFor(20, 60).columns
    expect(SETTINGS_BUTTON_CELLS).toBe(7)
    const header = elements(tree)[0] as Node
    const bandRow = elements(header)[0] as Node
    const band = all(bandRow, 'Text').find(t => t.props?.inverse === true && t.props?.wrap === 'truncate-end') as Node
    expect(textOf(band).length).toBeGreaterThanOrEqual(1)
    expect(textOf(band).length + SETTINGS_BUTTON_CELLS).toBeLessThanOrEqual(W)
    // One band row (it does not wrap) plus the blank row under it.
    expect(elements(header).length).toBe(1)
    expect(header.props?.marginBottom).toBe(1)
    expect(1 + (header.props?.marginBottom as number)).toBe(HEADER_ROWS)
  })
})

test('ruleWidth: the columns left after the header items, none below the minimum', () => {
  expect(ruleWidth(40, [11])).toBe(28) // 40 - 11 - 1 gap
  expect(ruleWidth(40, [13, 12])).toBe(13) // 40 - 25 - 2 gaps
  expect(ruleWidth(14, [11])).toBe(0) // 2 left: under MIN_RULE
  expect(ruleWidth(10, [11])).toBe(0)
})

// Every section title is an inverse band, and its header row ends in a rule
// that fills the drawable width exactly (items plus one gap between each).
for (const cols of [28, 60, 100]) {
  test(`at ${cols} columns, section titles stand out and their rule fills the row`, async ($, on) => {
    await inDemo($, on, cols, 60, async pane => {
      const tree = await pane.drawn()
      const columns = layoutFor(cols, 60).columns
      const titles = all(tree, 'Text').filter(t => /^ [▾▸] /.test(textOf(t)) && t.props?.inverse === true)
      expect(titles.length).toBe(6)
      for (const title of titles) {
        const row = all(tree, 'Box').find(b => elements(b).some(i => all(i, 'Text').includes(title)) && b.props?.flexWrap === 'wrap')
        expect(row).toBeDefined()
        const items = elements(row as Node)
        // A non-plain Button draws `[ label ]` chrome the text does not show,
        // so a measured row holds plain Buttons only.
        for (const b of all(row, 'Button')) expect({ button: textOf(b), plain: b.props?.plain }).toEqual({ button: textOf(b), plain: true })
        const rule = (textOf(items[items.length - 1]).match(/^─+$/) ?? [''])[0]
        if (rule) expect(textOf(row).length + items.length - 1).toBe(columns)
        else expect(textOf(row).length).toBeLessThanOrEqual(columns)
      }
    })
  })
}

// The Gentle AI grid in demo mode: headings in order at one indent, item
// labels at another, every label Box as wide as the others at any width.
const GRID_LABELS = ['gentle-ai', 'gga', 'engram', 'hook', 'rules', 'project', 'global', 'strict']
for (const cols of [28, 60, 100]) {
  test(`at ${cols} columns, the Gentle AI grid keeps its headings and aligned labels`, async ($, on) => {
    await inDemo($, on, cols, 60, async pane => {
      const fixed = all(await pane.drawn(), 'Box').filter(b => b.props?.flexShrink === 0)
      const headings = fixed.filter(b => /^ \S/.test(textOf(b)) && all(b, 'Text').some(t => t.props?.bold === true))
      expect(headings.map(b => textOf(b).trim()).filter(t => ['Tools', 'gga', 'RDD', 'TDD'].includes(t))).toEqual([
        'Tools',
        'gga',
        'RDD',
        'TDD',
      ])
      const labels = fixed.filter(b => /^ {2}\S/.test(textOf(b)) && GRID_LABELS.includes(textOf(b).trim()))
      expect(labels.map(b => textOf(b).trim())).toEqual(GRID_LABELS)
      expect(new Set(labels.map(b => textOf(b).length)).size).toBe(1)
    })
  })
}

const meterBar = (tree: unknown, label: string): number => {
  const box = all(tree, 'Box').find(b => b.props?.flexShrink === 0 && textOf(b).startsWith(label))
  return (textOf(box).match(/━/g) ?? []).length
}

test('meter bars are wider in a wide dock than in a narrow one', async ($, on) => {
  await inDemo($, on, 28, 60, async pane => {
    const narrow = meterBar(await pane.drawn(), 'ctx')
    await pane.redraw(paneProps(100, 60))
    const wide = meterBar(await pane.drawn(), 'ctx')
    expect(narrow).toBe(layoutFor(28, 60).barWidth)
    expect(wide).toBe(layoutFor(100, 60).barWidth)
    expect(wide).toBeGreaterThan(narrow)
  })
})

test('subagent counts collapse to a compact form when narrow', async ($, on) => {
  await inDemo($, on, 28, 60, async pane => {
    const narrow = textOf(await pane.drawn())
    expect(narrow).toMatch(/●\d+ ✓\d+ ✕\d+/)
    expect(narrow).not.toContain('running')
    await pane.redraw(paneProps(60, 60))
    const wide = textOf(await pane.drawn())
    expect(wide).toMatch(/● \d+ running · ✓ \d+ done · ✕ \d+ error/)
  })
})

// The content scrolls behind the sticky footer, so every card is drawn
// whatever the height; the person scrolls to the ones below.
test('every subagent card is drawn, short pane or tall', async ($, on) => {
  const cards = async (pane: { drawn: () => Promise<unknown> }) =>
    all(await pane.drawn(), 'Text').filter(t => /subagent\)$/.test(textOf(t))).length
  await inDemo($, on, 60, 24, async pane => {
    const short = await cards(pane)
    await pane.redraw(paneProps(60, 80))
    const tall = await cards(pane)
    expect(short).toBe(4)
    expect(tall).toBe(short)
  })
})

test('the path is shortened to the drawable width', async ($, on) => {
  await inDemo($, on, 20, 60, async pane => {
    const path = all(await pane.drawn(), 'Text').find(t => textOf(t).startsWith('📁'))
    // The glyph takes two cells and a space; the rest fits the width.
    expect(textOf(path).length - 2).toBeLessThanOrEqual(layoutFor(20, 60).columns - 1)
  })
})
