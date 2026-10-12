// The settings block at the top of the Pane, opened by the header's `⋮`.
// Pure: no `$` here (see CLAUDE.md); `register.tsx` keeps the open flag in
// the `settingsOpen` atom and draws the block.

import { buttonText, flowRows, ITEM_INDENT } from './layout'

export type SectionId = 'session' | 'context' | 'mcp' | 'subagents' | 'todos' | 'gentle'

// The header's only Button. The glyph U+22EE is East-Asian-width Neutral (one
// cell everywhere) and monochrome text, not an emoji, so the terminal paints it
// in the theme's colors like the band. Three spaces each side widen the click
// target to a fixed 7 cells (3 + 1 + 3), not the whole header bar, and the
// name band takes the rest of the line up to the right edge.
export const SETTINGS_KEY = 'settings'
export const SETTINGS_GLYPH = '⋮'
export const SETTINGS_BUTTON = `   ${SETTINGS_GLYPH}   `
export const SETTINGS_BUTTON_CELLS = 7

export const SETTINGS_CHANGE = 'settings-change'
export const SETTINGS_CLOSE = 'settings-close'
export const SETTINGS_TITLE = 'Settings'
export const CHANGE_TEXT = buttonText('change')
export const CLOSE_TEXT = buttonText('close')

// The label column: the item indent plus the longest label (`Sections`), so
// the Theme and Sections rows line up.
export const SETTINGS_LABEL_CELLS = ITEM_INDENT + 'Sections'.length

export const settingsLabel = (label: string): string =>
  `${' '.repeat(ITEM_INDENT)}${label}`.padEnd(SETTINGS_LABEL_CELLS)

// Rows the block draws at `columns`: the title, the Theme row (label, name
// and `[change]`, wrapping as a flex row does), `[close]`, and the blank row
// under the block.
export const settingsRows = (columns: number, themeName: string): number =>
  1 + flowRows([SETTINGS_LABEL_CELLS, themeName.length, CHANGE_TEXT.length], columns) + 1 + 1
