import { expect, test } from 'claude-code/testing'

import {
  DEFAULT_THEME,
  parseThemeArg,
  pickerOrder,
  pickerRows,
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

test('the theme list is default followed by the ten presets', () => {
  expect(THEME_NAMES).toEqual(['default', ...PRESETS])
})

test('every preset defines every role as a #rrggbb color', () => {
  for (const name of PRESETS) {
    const palette = THEMES[name]
    expect(Object.keys(palette).filter(k => k !== 'background').sort()).toEqual([...ROLES].sort())
    for (const role of ROLES) expect(palette[role]).toMatch(/^#[0-9a-f]{6}$/)
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
  expect(parseThemeArg(' solarized-light ')).toEqual({ kind: 'unknown', input: 'solarized-light' })
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
  expect(themeFromKey('hide-sidebar')).toBeNull()
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

test('pickerRows counts the hints, one row per theme, Cancel and the blank row under it', () => {
  expect(pickerRows(true)).toBe(THEME_NAMES.length + 3) // one hint
  expect(pickerRows(false)).toBe(THEME_NAMES.length + 4) // and how to take the keys
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
  for (const name of PRESETS) {
    expect(THEMES[name].background).toMatch(/^#[0-9a-f]{6}$/)
    expect(THEMES[name].background).toBe(BACKGROUNDS[name])
  }
  expect('background' in THEMES.default).toBe(false)
})

test('pickerOrder is the element before the picker, every theme Button, then Cancel', () => {
  const order = pickerOrder('hide-sidebar')
  expect(order[0]).toBe('hide-sidebar')
  expect(order.slice(1, -1)).toEqual(THEME_NAMES.map(themeKey))
  expect(order.at(-1)).toBe('theme-cancel')
})

test('wrapFocus turns a step past either end of the themes into the other end', () => {
  const order = pickerOrder('hide-sidebar')
  expect(wrapFocus('theme:monokai', 'theme-cancel', order)).toBe('theme:default')
  expect(wrapFocus('theme:default', 'hide-sidebar', order)).toBe('theme:monokai')
})

test('wrapFocus leaves every other move alone', () => {
  const order = pickerOrder('hide-sidebar')
  expect(wrapFocus('theme:dracula', 'theme:nord', order)).toBeNull() // inside the list
  expect(wrapFocus('theme:dracula', 'theme-cancel', order)).toBeNull() // a jump, not a step
  expect(wrapFocus('theme:monokai', 'hide-sidebar', order)).toBeNull()
  expect(wrapFocus('theme:default', 'theme-cancel', order)).toBeNull()
  expect(wrapFocus('theme-cancel', 'theme:monokai', order)).toBeNull() // back up from Cancel
  expect(wrapFocus(null, 'theme-cancel', order)).toBeNull()
  expect(wrapFocus('theme:monokai', undefined, order)).toBeNull()
})
