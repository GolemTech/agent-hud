import { expect, test } from 'claude-code/testing'

import { DEFAULT_THEME, parseThemeArg, resolveTheme, ROLES, THEME_NAMES, THEMES } from './themes'

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
