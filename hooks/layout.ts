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

export const CARD_ROWS = 4 // a subagent card: description, type, model, elapsed time

// The Gentle AI section is a grid: subgroup headings at HEADING_INDENT, item
// rows at ITEM_INDENT, each row a label column, a value column and its detail.
export const HEADING_INDENT = 1
export const ITEM_INDENT = 2

// The widest of some texts, in cells (one per code unit); 0 for none.
export const columnWidth = (texts: readonly string[]): number => texts.reduce((w, t) => Math.max(w, t.length), 0)

export type Grid = {
  /** Label column: the item indent plus the longest label. */
  label: number
  /** Value column: the widest value (version or status glyph). */
  value: number
  /** A heading's Box: label and value columns, so its summary sits in the detail column; the label column alone when that would not fit. */
  head: number
}

// Column widths of a grid from every label and value it draws, so all its
// rows line up whatever the width.
export const gridFor = (labels: readonly string[], values: readonly string[], columns: number): Grid => {
  const label = ITEM_INDENT + columnWidth(labels)
  const value = columnWidth(values)
  const spanned = label + 1 + value
  return { label, value, head: spanned <= columns ? spanned : label }
}

// A text button's label as drawn: `[label]`, or `[● label]` for the value a
// setting has now. Its length is the button's width in the row count.
export const buttonText = (label: string, selected = false): string => (selected ? `[● ${label}]` : `[${label}]`)

// The sticky header's title: `text` centered in `width` cells (the extra
// space, if odd, on the right), or cut to fit with a trailing `…`. A terminal
// has one font size, so a full-width inverse band is what makes it stand out.
export const centerBand = (text: string, width: number): string => {
  if (width <= 1) return '…'
  if (text.length > width) return `${text.slice(0, width - 1)}…`
  const left = Math.floor((width - text.length) / 2)
  return `${' '.repeat(left)}${text}${' '.repeat(width - text.length - left)}`
}

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

// ── Sticky header and footer ─────────────────────────────────────────────
// The Pane is drawn at exactly its body's height: the header (project name
// and the hide button) on top, the footer (Claude Code version) at the
// bottom, and between them a clipped viewport whose content the plugin moves
// itself by an offset, so the header and footer never scroll away.

export const HEADER_ROWS = 2 // the band (name + hide button) and a blank row under it
// The hide button inside the header band: a solid arrow padded to a cell
// either side, so it reads as the band's end cap.
export const HIDE_BUTTON = ' ► '
export const FOOTER_ROWS = 2 // a blank separator row and the version line
// Blank rows left under the last content line at the end of the scroll.
export const SCROLL_BOTTOM_MARGIN = 1

// Rows the scrolling viewport gets once the header and footer are placed.
export const viewportRowsFor = (bodyRows: number, footer: boolean): number =>
  Math.max(1, bodyRows - HEADER_ROWS - (footer ? FOOTER_ROWS : 0))

// The last offset: none while the content fits, else its overflow plus the
// bottom margin, so the last line never sits flush against the footer.
export const maxScrollOffset = (contentRows: number, viewportRows: number): number =>
  contentRows <= viewportRows ? 0 : contentRows - viewportRows + SCROLL_BOTTOM_MARGIN

// An offset in whole rows within [0, max]; a non-number is the top.
export const clampOffset = (offset: number, max: number): number =>
  Number.isFinite(offset) ? clamp(Math.round(offset), 0, Math.max(0, max)) : 0

// The branch line's icon: ⑂ (U+2442) is standard Unicode, so it renders
// without a Nerd Font; one column wide in most monospace fonts.
export const BRANCH_ICON = '\u2442'
