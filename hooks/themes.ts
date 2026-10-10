// HUD color themes. Pure: no `$` here (see CLAUDE.md), `register.tsx` reads
// the active theme from `$.state` and looks each role up through it.
//
// The HUD draws with five semantic roles. `default` maps each one to the
// Claude Code theme key it always used, so it follows `/theme` (light or dark)
// exactly as before, on the terminal's own background. The presets are raw
// `#rrggbb` colors taken from each theme's canonical palette, each with its
// editor background, and tuned for dark terminals.

export const ROLES = ['accent', 'subtle', 'success', 'warning', 'error'] as const
export type Role = (typeof ROLES)[number]
// `background` fills the sidebar and the band; a theme without one (default)
// leaves the terminal's own background.
export type Palette = Readonly<Record<Role, string>> & { readonly background?: string }

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
} as const satisfies Record<string, Palette>

export type ThemeName = keyof typeof THEMES
export const THEME_NAMES = Object.keys(THEMES) as ThemeName[]

export const isThemeName = (name: unknown): name is ThemeName =>
  typeof name === 'string' && Object.prototype.hasOwnProperty.call(THEMES, name)

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

// Rows the picker block draws: the hint (and, without the keys, how to take
// them), one Button per theme, Cancel, and the blank row above the sections.
export const pickerRows = (hasKeys: boolean): number => THEME_NAMES.length + (hasKeys ? 1 : 2) + 2

// The picker's focus ring order: the element the Pane draws right before the
// picker (`before`), every theme Button in list order, then Cancel. The render
// draws the Buttons in this same order.
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
