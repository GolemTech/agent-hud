// Responsive layout of the sidebar: pure sizing helpers for the Pane render.
// The engine raises `ui.render` again whenever the Pane's props change (its
// `bodyColumns` and `scroll.bodyRows` follow every terminal or dock resize),
// so a render that sizes itself from them adapts on every resize.

export const PANE_PADDING_X = 1 // the Pane body's paddingX, each side
const DEFAULT_BODY_COLUMNS = 40 // when the engine reports no body width
const DEFAULT_BODY_ROWS = 24 // when the engine reports no rows

export const MIN_BAR = 4
export const MAX_BAR = 20
// The full subagent tally (`● 12 running · ✓ 12 done · ✕ 12 error`) needs
// about this many columns; below it the compact `●12 ✓12 ✕12` is drawn.
const FULL_COUNTS_COLUMNS = 36
// The tool-version column (`gentle-ai 4.0.0`) and the widest status beside
// it (`✓ up to date`); the column is padded only when both fit on one line.
const TOOL_COLUMN = 17
const TOOL_STATUS = 12

export const CARD_ROWS = 4 // a subagent card: description, type, model, elapsed time

// Gentle AI sub-rows (gga rules, strict TDD) sit this far in, under their row.
export const SUB_ROW_INDENT = 3

// A text button's label as drawn: `[label]`, or `[● label]` for the value a
// setting has now. Its length is the button's width in the row count.
export const buttonText = (label: string, selected = false): string => (selected ? `[● ${label}]` : `[${label}]`)

// A section title as drawn: an inverse band, one space either side.
export const sectionTitle = (text: string): string => ` ${text} `

// A header row ends in a `───` rule that fills what its items leave of the
// line (each item's width plus one gap before the rule and between items).
// Under MIN_RULE columns the rule is left out rather than drawn as a stub.
const MIN_RULE = 3
export const ruleWidth = (columns: number, itemWidths: readonly number[]): number => {
  const used = itemWidths.reduce((sum, w) => sum + w, 0) + itemWidths.length
  const left = columns - used
  return left >= MIN_RULE ? left : 0
}

export type Layout = {
  /** Cells a line may take inside the Pane's padding. */
  columns: number
  /** Rows the Pane's body has. */
  rows: number
  /** Cells of a meter's ━ track. */
  barWidth: number
  /** Narrow dock: the compact subagent tally. */
  compact: boolean
  /** Width of the tool-version column; 0 means no padding. */
  toolPad: number
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

export const layoutFor = (bodyColumns: number | undefined, bodyRows: number | undefined): Layout => {
  const columns = Math.max(1, (bodyColumns ?? DEFAULT_BODY_COLUMNS) - 2 * PANE_PADDING_X)
  return {
    columns,
    rows: bodyRows ?? DEFAULT_BODY_ROWS,
    // A third of the line, so the reset note fits beside it in a wide dock.
    barWidth: clamp(Math.floor(columns / 3), MIN_BAR, MAX_BAR),
    compact: columns < FULL_COUNTS_COLUMNS,
    toolPad: columns >= TOOL_COLUMN + TOOL_STATUS ? TOOL_COLUMN : 0,
  }
}

// Rows a text of `width` cells takes when it wraps at `columns`; at least one.
// An estimate: word wrapping can take a row more on long text.
export const textRows = (width: number, columns: number): number =>
  Math.max(1, Math.ceil(width / Math.max(1, columns)))

// Lines a `flexWrap="wrap"` row of items `widths` wide takes at `columns`:
// greedy, as flex wrapping places them. An item wider than a line sits alone
// on its own (it shrinks or truncates there).
export const flowRows = (widths: readonly number[], columns: number, gap = 1): number => {
  let lines = 0
  let used = 0
  for (const w of widths) {
    if (lines === 0) {
      lines = 1
      used = w
    } else if (used + gap + w <= columns) {
      used += gap + w
    } else {
      lines += 1
      used = w
    }
  }
  return lines
}

// Subagent cards that fit the rows the other sections leave; at least one.
export const cardsFor = (bodyRows: number, usedRows: number): number =>
  Math.max(1, Math.floor((bodyRows - usedRows) / CARD_ROWS))

// The branch line's icon: ⑂ (U+2442) is standard Unicode, so it renders
// without a Nerd Font; one column wide in most monospace fonts.
export const BRANCH_ICON = '\u2442'
