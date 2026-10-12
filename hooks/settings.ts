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

// ── Hidden sections ──────────────────────────────────────────────────────
// A hidden section is not drawn at all (a collapsed one keeps its title);
// its data is still collected. `register.tsx` keeps the list in the
// `hiddenSections` atom and its `$.store` copy.

export const SECTION_IDS: readonly SectionId[] = ['session', 'context', 'mcp', 'subagents', 'todos', 'gentle']

export const SECTION_LABELS: Record<SectionId, string> = {
  session: 'Session',
  context: 'Context',
  mcp: 'MCP',
  subagents: 'Subagents',
  todos: 'Todo',
  gentle: 'Gentle AI',
}

// A stored list: known ids only, each once, in draw order; anything else none.
export const parseHidden = (stored: unknown): SectionId[] =>
  Array.isArray(stored) ? SECTION_IDS.filter(id => stored.includes(id)) : []

export const toggleHidden = (hidden: readonly SectionId[], id: SectionId): SectionId[] =>
  hidden.includes(id) ? hidden.filter(h => h !== id) : SECTION_IDS.filter(s => s === id || hidden.includes(s))

export const visibleSections = (hidden: readonly SectionId[]): SectionId[] =>
  SECTION_IDS.filter(id => !hidden.includes(id))

// The band's one-line digest, part by part: context `42%`, `MCP 3/5` and
// `2 agents`, each dropped when its section is hidden.
export const summaryParts = (
  percent: number | undefined,
  connected: number,
  total: number,
  agents: number,
  hidden: readonly SectionId[],
): string[] => [
  ...(hidden.includes('context') ? [] : [`${percent === undefined ? '–' : Math.round(percent)}%`]),
  ...(hidden.includes('mcp') ? [] : [`MCP ${connected}/${total}`]),
  ...(hidden.includes('subagents') ? [] : [`${agents} agents`]),
]

// The wrench is 2 cells wide and 2 UTF-16 code units, so `.length` counts its
// drawn width exactly: there is no ambiguity left.
export const ALL_HIDDEN_TEXT = `all sections hidden · ${SETTINGS_GLYPH} to show`

// A section's check: `[✓ Todo]` shown, `[  Todo]` hidden, the same width.
export const checkText = (id: SectionId, shown: boolean): string => `[${shown ? '✓' : ' '} ${SECTION_LABELS[id]}]`

export const sectionKey = (id: SectionId): string => `show-${id}`
