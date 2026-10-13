import { expect, test } from 'claude-code/testing'

import {
  DEFAULT_THEME,
  fg,
  isLight,
  LIGHT_THEMES,
  parseThemeArg,
  clampPickerScroll,
  moreText,
  PICKER_LIST,
  PICKER_LIST_ROWS,
  PICKER_WINDOW,
  pickerListRows,
  pickerMore,
  pickerOrder,
  pickerRowOf,
  pickerRows,
  scrollToRow,
  resolveTheme,
  ROLES,
  shownTheme,
  THEME_NAMES,
  themeFromKey,
  themeKey,
  THEMES,
  wrapFocus,
} from './themes'

const PRESETS = [
  'one-dark-pro',
  'catppuccin-mocha',
  'gruvbox-dark',
  'dracula',
  'nord',
  'tokyo-night',
  'solarized-dark',
  'rose-pine',
  'kanagawa',
  'monokai',
] as const

const NEW_DARK = [
  'everforest-dark',
  'ayu-dark',
  'github-dark',
  'catppuccin-macchiato',
  'material-ocean',
  'night-owl',
  'nightfox',
  'oceanic-next',
  'horizon',
  'synthwave-84',
] as const

const LIGHT = [
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
] as const

const ALL_PRESETS = [...PRESETS, ...NEW_DARK, ...LIGHT] as const

test('default maps every role to the Claude Code theme key it replaces', () => {
  expect(THEMES.default).toEqual({
    accent: 'claude',
    subtle: 'subtle',
    success: 'success',
    warning: 'warning',
    error: 'error',
  })
  expect(DEFAULT_THEME).toBe('default')
})

test('the theme list is default, the dark presets, then the light ones', () => {
  expect(THEME_NAMES).toEqual(['default', ...PRESETS, ...NEW_DARK, ...LIGHT])
  expect(THEME_NAMES).toHaveLength(31)
})

test('every preset defines every role, its background and, when light, its foreground as #rrggbb', () => {
  for (const name of ALL_PRESETS) {
    const palette: Record<string, string> = THEMES[name]
    const extra = isLight(name) ? ['background', 'foreground'] : ['background']
    expect(Object.keys(palette).sort()).toEqual([...ROLES, ...extra].sort())
    for (const value of Object.values(palette)) expect(value).toMatch(/^#[0-9a-f]{6}$/)
  }
})

test('the light themes are exactly the light presets, drawn after every dark one', () => {
  expect([...LIGHT_THEMES]).toEqual([...LIGHT])
  for (const name of LIGHT) expect(isLight(name)).toBe(true)
  for (const name of ['default', ...PRESETS, ...NEW_DARK] as const) expect(isLight(name)).toBe(false)
  const firstLight = THEME_NAMES.findIndex(isLight)
  expect(THEME_NAMES.slice(firstLight).every(isLight)).toBe(true)
})

// The first ten presets, pinned: adding themes must not touch them.
test('the first ten presets keep their colors', () => {
  expect(PRESETS.map(name => THEMES[name])).toEqual([
    { accent: '#61afef', subtle: '#5c6370', success: '#98c379', warning: '#e5c07b', error: '#e06c75', background: '#282c34' },
    { accent: '#cba6f7', subtle: '#6c7086', success: '#a6e3a1', warning: '#f9e2af', error: '#f38ba8', background: '#1e1e2e' },
    { accent: '#fe8019', subtle: '#928374', success: '#b8bb26', warning: '#fabd2f', error: '#fb4934', background: '#282828' },
    { accent: '#bd93f9', subtle: '#6272a4', success: '#50fa7b', warning: '#f1fa8c', error: '#ff5555', background: '#282a36' },
    { accent: '#88c0d0', subtle: '#616e88', success: '#a3be8c', warning: '#ebcb8b', error: '#bf616a', background: '#2e3440' },
    { accent: '#7aa2f7', subtle: '#565f89', success: '#9ece6a', warning: '#e0af68', error: '#f7768e', background: '#1a1b26' },
    { accent: '#268bd2', subtle: '#586e75', success: '#859900', warning: '#b58900', error: '#dc322f', background: '#002b36' },
    { accent: '#c4a7e7', subtle: '#6e6a86', success: '#9ccfd8', warning: '#f6c177', error: '#eb6f92', background: '#191724' },
    { accent: '#7e9cd8', subtle: '#727169', success: '#98bb6c', warning: '#e6c384', error: '#e82424', background: '#1f1f28' },
    { accent: '#66d9ef', subtle: '#75715e', success: '#a6e22e', warning: '#e6db74', error: '#f92672', background: '#272822' },
  ])
})

// WCAG 2 relative luminance and contrast ratio of two #rrggbb colors.
const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

test('contrast: every role is at least 3:1 and the foreground 4.5:1 on its background', () => {
  // `subtle` is meant to recede and is left out; no preset is exempted.
  for (const name of ALL_PRESETS) {
    const palette: { background: string; foreground?: string } & Record<string, string> = THEMES[name]
    for (const role of ['accent', 'success', 'warning', 'error'] as const) {
      const ratio = contrast(palette[role] ?? '', palette.background)
      expect({ name, role, ok: ratio >= 3 }).toEqual({ name, role, ok: true })
    }
    if (palette.foreground) {
      const ratio = contrast(palette.foreground, palette.background)
      expect({ name, role: 'foreground', ok: ratio >= 4.5 }).toEqual({ name, role: 'foreground', ok: true })
    }
  }
})

test('resolveTheme falls back to default for unknown or missing names', () => {
  expect(resolveTheme('dracula')).toBe(THEMES.dracula)
  expect(resolveTheme(undefined)).toBe(THEMES.default)
  expect(resolveTheme('nope')).toBe(THEMES.default)
  expect(resolveTheme(42)).toBe(THEMES.default)
  expect(resolveTheme('constructor')).toBe(THEMES.default)
})

test('parseThemeArg: blank lists, names are trimmed and case-insensitive', () => {
  expect(parseThemeArg('')).toEqual({ kind: 'list' })
  expect(parseThemeArg('   ')).toEqual({ kind: 'list' })
  expect(parseThemeArg(' Dracula ')).toEqual({ kind: 'set', name: 'dracula' })
  expect(parseThemeArg('DEFAULT')).toEqual({ kind: 'set', name: 'default' })
})

test('parseThemeArg: spaces and underscores stand for hyphens', () => {
  expect(parseThemeArg('tokyo night')).toEqual({ kind: 'set', name: 'tokyo-night' })
  expect(parseThemeArg('One_Dark_Pro')).toEqual({ kind: 'set', name: 'one-dark-pro' })
  expect(parseThemeArg('rose  pine')).toEqual({ kind: 'set', name: 'rose-pine' })
})

test('parseThemeArg: an unknown name is reported as typed', () => {
  expect(parseThemeArg(' paper-white ')).toEqual({ kind: 'unknown', input: 'paper-white' })
  expect(parseThemeArg('toString')).toEqual({ kind: 'unknown', input: 'toString' })
})

test('themeKey and themeFromKey round-trip the picker Button keys', () => {
  expect(themeKey('dracula')).toBe('theme:dracula')
  expect(themeFromKey('theme:dracula')).toBe('dracula')
  expect(themeFromKey('theme:default')).toBe('default')
  for (const name of THEME_NAMES) expect(themeFromKey(themeKey(name))).toBe(name)
})

test('themeFromKey is null for any other element', () => {
  expect(themeFromKey(undefined)).toBeNull()
  expect(themeFromKey('theme-cancel')).toBeNull()
  expect(themeFromKey('settings')).toBeNull()
  expect(themeFromKey('theme:nope')).toBeNull()
  expect(themeFromKey('theme:')).toBeNull()
  expect(themeFromKey('dracula')).toBeNull()
})

test('shownTheme draws the preview over the saved theme, and the saved one without it', () => {
  expect(shownTheme('nord', 'dracula')).toBe(THEMES.dracula)
  expect(shownTheme('nord', null)).toBe(THEMES.nord)
  expect(shownTheme('nord', 'nope')).toBe(THEMES.nord)
  expect(shownTheme(undefined, undefined)).toBe(THEMES.default)
})

test('pickerRows counts the hints, the fixed window and its two indicator rows, Cancel and the blank row under it', () => {
  expect(PICKER_LIST_ROWS).toBe(THEME_NAMES.length + 1) // every theme and the light separator
  expect(PICKER_LIST_ROWS).toBeGreaterThan(PICKER_WINDOW)
  expect(pickerRows(true)).toBe(PICKER_WINDOW + 2 + 3) // one hint
  expect(pickerRows(false)).toBe(PICKER_WINDOW + 2 + 4) // and how to take the keys
})

test('pickerListRows: the whole list while it fits, else the window and its two indicator rows', () => {
  expect(pickerListRows(6, 10)).toBe(6)
  expect(pickerListRows(10, 10)).toBe(10)
  expect(pickerListRows(32, 10)).toBe(12)
})

test('PICKER_LIST is every theme in order with the separator (null) right before the first light one', () => {
  expect(PICKER_LIST.filter(n => n !== null)).toEqual(THEME_NAMES)
  const sep = PICKER_LIST.indexOf(null)
  expect(PICKER_LIST[sep - 1]).toBe('synthwave-84')
  expect(PICKER_LIST[sep + 1]).toBe('catppuccin-latte')
  expect(pickerRowOf('default')).toBe(0)
  expect(pickerRowOf('synthwave-84')).toBe(sep - 1)
  expect(pickerRowOf('catppuccin-latte')).toBe(sep + 1)
  expect(pickerRowOf('nord-light')).toBe(PICKER_LIST_ROWS - 1)
})

test('clampPickerScroll keeps the window inside the list', () => {
  expect(clampPickerScroll(-3, 32, 10)).toBe(0)
  expect(clampPickerScroll(5, 32, 10)).toBe(5)
  expect(clampPickerScroll(40, 32, 10)).toBe(22)
  expect(clampPickerScroll(4, 6, 10)).toBe(0) // the list fits
  expect(clampPickerScroll(Number.NaN, 32, 10)).toBe(0)
})

test('scrollToRow moves the window the least that brings a row into view', () => {
  expect(scrollToRow(0, 3, 32, 10)).toBe(0) // already in view
  expect(scrollToRow(0, 10, 32, 10)).toBe(1) // one past the bottom
  expect(scrollToRow(5, 2, 32, 10)).toBe(2) // above the top
  expect(scrollToRow(0, 31, 32, 10)).toBe(22) // the last row: the end
  expect(scrollToRow(22, 0, 32, 10)).toBe(0) // the first row: the top
  expect(scrollToRow(0, 4, 6, 10)).toBe(0) // the list fits
})

test('pickerMore counts the rows hidden above and below the window', () => {
  expect(pickerMore(0, 32, 10)).toEqual({ above: 0, below: 22 })
  expect(pickerMore(4, 32, 10)).toEqual({ above: 4, below: 18 })
  expect(pickerMore(22, 32, 10)).toEqual({ above: 22, below: 0 })
  expect(pickerMore(0, 6, 10)).toEqual({ above: 0, below: 0 })
})

test('moreText names the hidden rows, blank when none', () => {
  expect(moreText('up', 4)).toBe('↑ 4 more')
  expect(moreText('down', 17)).toBe('↓ 17 more')
  expect(moreText('up', 0)).toBe('')
})

const BACKGROUNDS = {
  'one-dark-pro': '#282c34',
  'catppuccin-mocha': '#1e1e2e',
  'gruvbox-dark': '#282828',
  dracula: '#282a36',
  nord: '#2e3440',
  'tokyo-night': '#1a1b26',
  'solarized-dark': '#002b36',
  'rose-pine': '#191724',
  kanagawa: '#1f1f28',
  monokai: '#272822',
} as const

test('every preset has its editor background; default keeps the terminal one', () => {
  for (const name of PRESETS) expect(THEMES[name].background).toBe(BACKGROUNDS[name])
  for (const name of ALL_PRESETS) expect(THEMES[name].background).toMatch(/^#[0-9a-f]{6}$/)
  expect('background' in THEMES.default).toBe(false)
})

test('pickerOrder is the element before the picker, every theme Button, then Cancel', () => {
  const order = pickerOrder('settings')
  expect(order[0]).toBe('settings')
  expect(order.slice(1, -1)).toEqual(THEME_NAMES.map(themeKey))
  expect(order.at(-1)).toBe('theme-cancel')
})

test('wrapFocus turns a step past either end of the themes into the other end', () => {
  const order = pickerOrder('settings')
  expect(wrapFocus('theme:nord-light', 'theme-cancel', order)).toBe('theme:default')
  expect(wrapFocus('theme:default', 'settings', order)).toBe('theme:nord-light')
})

test('wrapFocus leaves every other move alone', () => {
  const order = pickerOrder('settings')
  expect(wrapFocus('theme:dracula', 'theme:nord', order)).toBeNull() // inside the list
  expect(wrapFocus('theme:dracula', 'theme-cancel', order)).toBeNull() // a jump, not a step
  expect(wrapFocus('theme:nord-light', 'settings', order)).toBeNull()
  expect(wrapFocus('theme:monokai', 'theme-cancel', order)).toBeNull() // monokai is no longer the last
  expect(wrapFocus('theme:synthwave-84', 'theme:catppuccin-latte', order)).toBeNull() // across the separator
  expect(wrapFocus('theme:default', 'theme-cancel', order)).toBeNull()
  expect(wrapFocus('theme-cancel', 'theme:nord-light', order)).toBeNull() // back up from Cancel
  expect(wrapFocus(null, 'theme-cancel', order)).toBeNull()
  expect(wrapFocus('theme:nord-light', undefined, order)).toBeNull()
})

test('fg adds the theme foreground as a color, and nothing for a theme without one', () => {
  expect(fg(THEMES.default)).toEqual({})
  expect('color' in fg(THEMES.nord)).toBe(false)
  expect(fg({ ...THEMES.nord, foreground: '#eceff4' })).toEqual({ color: '#eceff4' })
})

test('default and the dark presets have no foreground, so their trees stay as they were', () => {
  expect('foreground' in THEMES.default).toBe(false)
  for (const name of [...PRESETS, ...NEW_DARK]) expect('foreground' in THEMES[name]).toBe(false)
  for (const name of LIGHT) expect(THEMES[name].foreground).toMatch(/^#[0-9a-f]{6}$/)
})
