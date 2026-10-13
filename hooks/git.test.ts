import { expect, test } from 'claude-code/testing'

import { aheadText, behindText, parseAheadBehind, syncText } from './git'
import { maskView } from './register'
import type { HudView } from './register'

test('parseAheadBehind: the tab-separated counts of rev-list --left-right --count', () => {
  expect(parseAheadBehind('156\t2\n')).toEqual({ ahead: 156, behind: 2 })
  expect(parseAheadBehind('0\t0')).toEqual({ ahead: 0, behind: 0 })
  expect(parseAheadBehind('  3   1  \n')).toEqual({ ahead: 3, behind: 1 })
})

test('parseAheadBehind: anything but two counts is null', () => {
  expect(parseAheadBehind('')).toBe(null)
  expect(parseAheadBehind('\n')).toBe(null)
  expect(parseAheadBehind('12')).toBe(null)
  expect(parseAheadBehind('1\t2\t3')).toBe(null)
  expect(parseAheadBehind('fatal: no upstream configured for branch')).toBe(null)
  expect(parseAheadBehind('-1\t2')).toBe(null)
})

test('syncText: each mark only above zero, nothing without counts', () => {
  expect(syncText({ ahead: 156, behind: 2 })).toBe(' ↑156 ↓2')
  expect(syncText({ ahead: 3, behind: 0 })).toBe(' ↑3')
  expect(syncText({ ahead: 0, behind: 1 })).toBe(' ↓1')
  expect(syncText({ ahead: 0, behind: 0 })).toBe('')
  expect(syncText(null)).toBe('')
  expect(aheadText({ ahead: 3, behind: 1 })).toBe(' ↑3')
  expect(behindText({ ahead: 3, behind: 1 })).toBe(' ↓1')
})

test('maskView keeps the upstream counts: they are not identity', () => {
  const view = { branch: 'feat/x', aheadBehind: { ahead: 4, behind: 1 } } as unknown as HudView
  const masked = maskView(view)
  expect(masked.branch).toBe('••••')
  expect(masked.aheadBehind).toEqual({ ahead: 4, behind: 1 })
})
