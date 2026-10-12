import { expect, test } from 'claude-code/testing'

import {
  CHANGE_TEXT,
  CLOSE_TEXT,
  SETTINGS_BUTTON,
  SETTINGS_BUTTON_CELLS,
  SETTINGS_KEY,
  SETTINGS_LABEL_CELLS,
  settingsLabel,
  settingsRows,
} from './settings'

test('the gear is U+2699 without VS16, counted as two cells', () => {
  expect(SETTINGS_KEY).toBe('settings')
  expect(SETTINGS_BUTTON).toBe('⚙')
  expect(SETTINGS_BUTTON.length).toBe(1)
  expect(SETTINGS_BUTTON_CELLS).toBe(2)
})

test('settingsLabel pads a label to the shared label column', () => {
  expect(SETTINGS_LABEL_CELLS).toBe(10)
  expect(settingsLabel('Theme')).toBe('  Theme   ')
  expect(settingsLabel('Sections')).toBe('  Sections')
  expect(CHANGE_TEXT).toBe('[change]')
  expect(CLOSE_TEXT).toBe('[close]')
})

test('settingsRows: the title, the Theme row as it wraps, [close] and the blank row under the block', () => {
  // 100 columns (98 drawable): label, name and [change] share one line.
  expect(settingsRows(98, 'default')).toBe(4)
  // 28 columns (26 drawable): [change] goes below the name.
  expect(settingsRows(26, 'default')).toBe(5)
  // A long name wraps the Theme row where a short one fits (34 columns, 32 drawable).
  expect(settingsRows(32, 'default')).toBe(4)
  expect(settingsRows(32, 'catppuccin-mocha')).toBe(5)
  // 20 columns (18 drawable): label, name and [change] each take a line.
  expect(settingsRows(18, 'catppuccin-mocha')).toBe(6)
})
