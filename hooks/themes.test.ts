import { expect, test } from 'claude-code/testing'

import {
  DEFAULT_THEME,
  parseThemeArg,
  pickerRows,
  resolveTheme,
  ROLES,
  shownTheme,
  THEME_NAMES,
  themeFromKey,
  themeKey,
  THEMES,
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
    expect(Object.keys(palette).sort()).toEqual([...ROLES].sort())
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

test('pickerRows counts two hint rows, one row per theme and the Cancel row', () => {
  expect(pickerRows()).toBe(THEME_NAMES.length + 3)
})
