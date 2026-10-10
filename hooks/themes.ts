// HUD color themes. Pure: no `$` here (see CLAUDE.md), `register.tsx` reads
// the active theme from `$.state` and looks each role up through it.
//
// The HUD draws with five semantic roles. `default` maps each one to the
// Claude Code theme key it always used, so it follows `/theme` (light or dark)
// exactly as before. The presets are raw `#rrggbb` colors taken from each
// theme's canonical palette and tuned for dark terminals.

export const ROLES = ['accent', 'subtle', 'success', 'warning', 'error'] as const
export type Role = (typeof ROLES)[number]
export type Palette = Readonly<Record<Role, string>>

export const DEFAULT_THEME = 'default'

export const THEMES = {
  default: { accent: 'claude', subtle: 'subtle', success: 'success', warning: 'warning', error: 'error' },
  'one-dark-pro': { accent: '#61afef', subtle: '#5c6370', success: '#98c379', warning: '#e5c07b', error: '#e06c75' },
  'catppuccin-mocha': { accent: '#cba6f7', subtle: '#6c7086', success: '#a6e3a1', warning: '#f9e2af', error: '#f38ba8' },
  'gruvbox-dark': { accent: '#fe8019', subtle: '#928374', success: '#b8bb26', warning: '#fabd2f', error: '#fb4934' },
  dracula: { accent: '#bd93f9', subtle: '#6272a4', success: '#50fa7b', warning: '#f1fa8c', error: '#ff5555' },
  nord: { accent: '#88c0d0', subtle: '#616e88', success: '#a3be8c', warning: '#ebcb8b', error: '#bf616a' },
  'tokyo-night': { accent: '#7aa2f7', subtle: '#565f89', success: '#9ece6a', warning: '#e0af68', error: '#f7768e' },
  'solarized-dark': { accent: '#268bd2', subtle: '#586e75', success: '#859900', warning: '#b58900', error: '#dc322f' },
  'rose-pine': { accent: '#c4a7e7', subtle: '#6e6a86', success: '#9ccfd8', warning: '#f6c177', error: '#eb6f92' },
  kanagawa: { accent: '#7e9cd8', subtle: '#727169', success: '#98bb6c', warning: '#e6c384', error: '#e82424' },
  monokai: { accent: '#66d9ef', subtle: '#75715e', success: '#a6e22e', warning: '#e6db74', error: '#f92672' },
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
