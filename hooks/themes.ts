// HUD color themes. Pure: no `$` here (see CLAUDE.md), `register.tsx` reads
// the active theme from `$.state` and looks each role up through it.
//
// The HUD draws with five semantic roles. `default` maps each one to the
// Claude Code theme key it always used, so it follows `/theme` (light or dark)
// exactly as before, on the terminal's own background. The presets are raw
// `#rrggbb` colors taken from each theme's canonical palette, each with its
// editor background: twenty dark ones, then ten light ones (`LIGHT_THEMES`).
// A light preset also carries its editor foreground, since the terminal's own
// (light, under a dark terminal) would be unreadable on it; a dark preset
// leaves the terminal's foreground, as the first ten always did.
//
// Every role but `subtle` reads at 3:1 or more on its background and every
// foreground at 4.5:1 (WCAG 2, `themes.test.ts`). Where an upstream color
// fell short, a shade of the same theme's palette that passes stands in, or
// else the upstream color darkened just enough (same hue and saturation):
//   catppuccin-latte  success #40a02b -> #3f9e2a, warning #df8e1d -> #c27b19
//   solarized-light   success #859900 -> #839600, warning yellow -> orange #cb4b16,
//                     foreground base00 #657b83 -> base01 #586e75
//   rose-pine-dawn    warning gold #ea9d34 -> #c77c15
//   ayu-light         accent #399ee6 -> #2996e4, success #86b300 -> #759c00,
//                     warning #fa8d3e -> #ed6706
//   everforest-light  success #8da101 -> #849701, warning #dfa000 -> #b98500
//   nord-light        Nord has no official light variant: Snow Storm #eceff4
//                     under Polar Night #2e3440, Frost accent; aurora green
//                     #a3be8c -> #719353 and yellow #ebcb8b -> #b2811f

import { clampFirst, moreText, scrollToItem, windowAt, windowRows } from './windows'

export const ROLES = ['accent', 'subtle', 'success', 'warning', 'error'] as const
export type Role = (typeof ROLES)[number]
// `background` fills the sidebar and the band; a theme without one (default)
// leaves the terminal's own background. `foreground` colors every Text that
// takes no role; a theme without one leaves the terminal's own foreground,
// which on a light background under a dark terminal would be unreadable.
export type Palette = Readonly<Record<Role, string>> & {
  readonly background?: string
  readonly foreground?: string
}

export const DEFAULT_THEME = 'default'

export const THEMES = {
  default: { accent: 'claude', subtle: 'subtle', success: 'success', warning: 'warning', error: 'error' },
  'one-dark-pro': { accent: '#61afef', subtle: '#5c6370', success: '#98c379', warning: '#e5c07b', error: '#e06c75', background: '#282c34' },
  'catppuccin-mocha': { accent: '#cba6f7', subtle: '#6c7086', success: '#a6e3a1', warning: '#f9e2af', error: '#f38ba8', background: '#1e1e2e' },
  'gruvbox-dark': { accent: '#fe8019', subtle: '#928374', success: '#b8bb26', warning: '#fabd2f', error: '#fb4934', background: '#282828' },
  dracula: { accent: '#bd93f9', subtle: '#6272a4', success: '#50fa7b', warning: '#f1fa8c', error: '#ff5555', background: '#282a36' },
  nord: { accent: '#88c0d0', subtle: '#616e88', success: '#a3be8c', warning: '#ebcb8b', error: '#bf616a', background: '#2e3440' },
  'tokyo-night': { accent: '#7aa2f7', subtle: '#565f89', success: '#9ece6a', warning: '#e0af68', error: '#f7768e', background: '#1a1b26' },
  'solarized-dark': { accent: '#268bd2', subtle: '#586e75', success: '#859900', warning: '#b58900', error: '#dc322f', background: '#002b36' },
  'rose-pine': { accent: '#c4a7e7', subtle: '#6e6a86', success: '#9ccfd8', warning: '#f6c177', error: '#eb6f92', background: '#191724' },
  kanagawa: { accent: '#7e9cd8', subtle: '#727169', success: '#98bb6c', warning: '#e6c384', error: '#e82424', background: '#1f1f28' },
  monokai: { accent: '#66d9ef', subtle: '#75715e', success: '#a6e22e', warning: '#e6db74', error: '#f92672', background: '#272822' },
  'everforest-dark': { accent: '#7fbbb3', subtle: '#859289', success: '#a7c080', warning: '#dbbc7f', error: '#e67e80', background: '#2d353b' },
  'ayu-dark': { accent: '#e6b450', subtle: '#626a73', success: '#aad94c', warning: '#ff8f40', error: '#d95757', background: '#0b0e14' },
  'github-dark': { accent: '#58a6ff', subtle: '#8b949e', success: '#3fb950', warning: '#d29922', error: '#f85149', background: '#0d1117' },
  'catppuccin-macchiato': { accent: '#c6a0f6', subtle: '#6e738d', success: '#a6da95', warning: '#eed49f', error: '#ed8796', background: '#24273a' },
  'material-ocean': { accent: '#82aaff', subtle: '#464b5d', success: '#c3e88d', warning: '#ffcb6b', error: '#f07178', background: '#0f111a' },
  'night-owl': { accent: '#82aaff', subtle: '#637777', success: '#addb67', warning: '#ecc48d', error: '#ef5350', background: '#011627' },
  nightfox: { accent: '#719cd6', subtle: '#738091', success: '#81b29a', warning: '#dbc074', error: '#c94f6d', background: '#192330' },
  'oceanic-next': { accent: '#6699cc', subtle: '#65737e', success: '#99c794', warning: '#fac863', error: '#ec5f67', background: '#1b2b34' },
  horizon: { accent: '#26bbd9', subtle: '#6c6f93', success: '#29d398', warning: '#fab795', error: '#e95678', background: '#1c1e26' },
  'synthwave-84': { accent: '#ff7edb', subtle: '#848bbd', success: '#72f1b8', warning: '#fede5d', error: '#fe4450', background: '#262335' },
  'catppuccin-latte': { accent: '#8839ef', subtle: '#9ca0b0', success: '#3f9e2a', warning: '#c27b19', error: '#d20f39', background: '#eff1f5', foreground: '#4c4f69' },
  'solarized-light': { accent: '#268bd2', subtle: '#93a1a1', success: '#839600', warning: '#cb4b16', error: '#dc322f', background: '#fdf6e3', foreground: '#586e75' },
  'github-light': { accent: '#0969da', subtle: '#6e7781', success: '#1a7f37', warning: '#9a6700', error: '#cf222e', background: '#ffffff', foreground: '#1f2328' },
  'gruvbox-light': { accent: '#af3a03', subtle: '#928374', success: '#79740e', warning: '#b57614', error: '#9d0006', background: '#fbf1c7', foreground: '#3c3836' },
  'one-light': { accent: '#4078f2', subtle: '#a0a1a7', success: '#50a14f', warning: '#c18401', error: '#e45649', background: '#fafafa', foreground: '#383a42' },
  'rose-pine-dawn': { accent: '#907aa9', subtle: '#9893a5', success: '#56949f', warning: '#c77c15', error: '#b4637a', background: '#faf4ed', foreground: '#575279' },
  'ayu-light': { accent: '#2996e4', subtle: '#8a9199', success: '#759c00', warning: '#ed6706', error: '#e65050', background: '#f8f9fa', foreground: '#5c6166' },
  'everforest-light': { accent: '#3a94c5', subtle: '#939f91', success: '#849701', warning: '#b98500', error: '#f85552', background: '#fdf6e3', foreground: '#5c6a72' },
  'tokyo-night-day': { accent: '#2e7de9', subtle: '#848cb5', success: '#587539', warning: '#8c6c3e', error: '#f52a65', background: '#e1e2e7', foreground: '#3760bf' },
  'nord-light': { accent: '#5e81ac', subtle: '#7b88a1', success: '#719353', warning: '#b2811f', error: '#bf616a', background: '#eceff4', foreground: '#2e3440' },
} as const satisfies Record<string, Palette>

// The color of a Text that takes no role: the theme's foreground, or no prop
// at all, so a theme without one (default) draws exactly as before.
export const fg = (t: Palette): { color?: string } => (t.foreground ? { color: t.foreground } : {})

export type ThemeName = keyof typeof THEMES
export const THEME_NAMES = Object.keys(THEMES) as ThemeName[]

export const isThemeName = (name: unknown): name is ThemeName =>
  typeof name === 'string' && Object.prototype.hasOwnProperty.call(THEMES, name)

// The light presets, in list order: drawn after every dark one, below the
// picker's `light` separator.
export const LIGHT_THEMES: ReadonlySet<ThemeName> = new Set<ThemeName>([
  'catppuccin-latte',
  'solarized-light',
  'github-light',
  'gruvbox-light',
  'one-light',
  'rose-pine-dawn',
  'ayu-light',
  'everforest-light',
  'tokyo-night-day',
  'nord-light',
])
export const isLight = (name: ThemeName): boolean => LIGHT_THEMES.has(name)

// The picker's separator line, drawn right before the first light theme.
export const LIGHT_SEPARATOR = 'light'

// The palette for a stored or typed name; anything unknown is `default`.
export const resolveTheme = (name: unknown): Palette => (isThemeName(name) ? THEMES[name] : THEMES.default)

export type ThemeArg = { kind: 'list' } | { kind: 'set'; name: ThemeName } | { kind: 'unknown'; input: string }

// `/hud-theme` argument: blank lists the themes; a name is matched trimmed,
// case-insensitively, with runs of spaces or underscores read as one hyphen.
export const parseThemeArg = (raw: string): ThemeArg => {
  const input = raw.trim()
  if (!input) return { kind: 'list' }
  const name = input.toLowerCase().replace(/[\s_]+/g, '-')
  return isThemeName(name) ? { kind: 'set', name } : { kind: 'unknown', input }
}

// The `/hud-theme` listing, the active theme marked.
export const themeList = (active: ThemeName): string =>
  THEME_NAMES.map(name => (name === active ? `● ${name} (active)` : `  ${name}`)).join('\n')

// ── Picker ───────────────────────────────────────────────────────────────
// `/hud-theme` without a name opens a picker inside the HUD's own Pane (a
// second pane would be a dock tab hiding the sidebar), above its sections:
// hints, one Button per theme keyed `theme:<name>`, and Cancel. The focus
// ring on a theme Button previews it (`ui.focus`); a press saves it.

// The Pane's `focus` is granted only while the prompt holds the keys over an
// empty composer, never while the command that opens it still runs: the Pane
// is opened again this long after, to ask for the keys once more.
export const PICKER_FOCUS_RETRY_MS = 300

const KEY_PREFIX = 'theme:'
export const PICKER_CANCEL = 'theme-cancel'

export const themeKey = (name: ThemeName): string => `${KEY_PREFIX}${name}`

// The theme a picker Button's key names; null for any other element.
export const themeFromKey = (key: string | undefined): ThemeName | null => {
  if (!key?.startsWith(KEY_PREFIX)) return null
  const name = key.slice(KEY_PREFIX.length)
  return isThemeName(name) ? name : null
}

// The palette both surfaces draw with: the picker's preview while one is
// focused, else the saved theme.
export const shownTheme = (saved: unknown, preview: unknown): Palette =>
  resolveTheme(isThemeName(preview) ? preview : saved)

// The first light theme: the picker draws its `light` separator right before it.
export const FIRST_LIGHT = THEME_NAMES.find(isLight)

// The picker's theme list, one entry per row: every theme in list order, and
// null for the `light` separator right before the first light one.
export const PICKER_LIST: readonly (ThemeName | null)[] = THEME_NAMES.flatMap(name =>
  name === FIRST_LIGHT ? [null, name] : [name],
)
export const PICKER_LIST_ROWS = PICKER_LIST.length

// The list draws in a fixed window of this many rows (the separator counts as
// one), so the sections below stay in view while a theme is previewed.
export const PICKER_WINDOW = 10

// The row a theme draws on in the list, the separator counted.
export const pickerRowOf = (name: ThemeName): number => PICKER_LIST.indexOf(name)

// The picker's rows are its items, one row each, so its window is the shared
// list window (`windows.ts`) over unit heights, in rows.
const unitRows = (total: number): number[] => Array.from({ length: Math.max(0, total) }, () => 1)

// The window's offset within [0, total - window]; a non-number is the top.
export const clampPickerScroll = (offset: number, total: number, window: number): number =>
  clampFirst(offset, unitRows(total), window)

// The offset that brings `row` into view with the least move: unchanged when
// it is already in view, else the row at the window's top or bottom edge.
export const scrollToRow = (offset: number, row: number, total: number, window: number): number =>
  scrollToItem(offset, row, unitRows(total), window)

// Rows hidden above and below the window at an offset.
export const pickerMore = (offset: number, total: number, window: number): { above: number; below: number } => {
  const { above, below } = windowAt(offset, unitRows(total), window)
  return { above, below }
}

// An indicator line for the hidden rows; blank when there are none.
export { moreText }

// Rows the list takes: all of it while it fits the window, else the window
// and its two indicator rows, always drawn (blank when nothing is hidden on
// that side) so the count never changes with the offset.
export const pickerListRows = windowRows

// Rows the picker block draws: the hint (and, without the keys, how to take
// them), the theme list (`pickerListRows`), Cancel, and the blank row above
// the sections.
export const pickerRows = (hasKeys: boolean): number =>
  pickerListRows(PICKER_LIST_ROWS, PICKER_WINDOW) + (hasKeys ? 1 : 2) + 2

// The picker's focus ring order: the element the Pane draws right before the
// picker (`before`), every theme Button in list order, then Cancel. The render
// draws the Buttons in this same order; the `light` separator is a Text, not
// in the ring.
export const pickerOrder = (before: string): string[] => [before, ...THEME_NAMES.map(themeKey), PICKER_CANCEL]

// Carousel: focus events carry no direction, so a wrap is inferred from the
// previous element. A step from the last theme onto the element right after
// it lands on the first theme; a step from the first theme onto the element
// right before it lands on the last. Anything else (a step inside the list, a
// jump such as a click elsewhere) is null: the move stands as it is.
export const wrapFocus = (prev: string | null, next: string | undefined, order: readonly string[]): string | null => {
  const themes = order.filter(key => themeFromKey(key) !== null)
  const first = themes[0]
  const last = themes.at(-1)
  if (!first || !last || !prev || !next) return null
  if (prev === last && next === order[order.indexOf(last) + 1]) return first
  if (prev === first && next === order[order.indexOf(first) - 1]) return last
  return null
}
