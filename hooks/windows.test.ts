import { expect, test } from 'claude-code/testing'

import {
  clampFirst,
  fitsWindow,
  isFollowing,
  lastFirst,
  LIST_TOP,
  listAt,
  moreText,
  parseListScroll,
  scrollToItem,
  shownCount,
  shownFirst,
  sumRows,
  wheelList,
  windowAt,
  windowRows,
} from './windows'

const ones = (n: number) => Array.from({ length: n }, () => 1)
// Five subagent cards of 4 rows: 20 rows, a 12-row window shows three.
const CARDS = [4, 4, 4, 4, 4]

test('windowRows: the whole list while it fits, else the window and its two indicator rows', () => {
  expect(windowRows(6, 8)).toBe(6)
  expect(windowRows(8, 8)).toBe(8)
  expect(windowRows(20, 12)).toBe(14)
})

test('fitsWindow and sumRows read the items heights', () => {
  expect(sumRows([4, 3, 4])).toBe(11)
  expect(fitsWindow([4, 3, 4], 12)).toBe(true)
  expect(fitsWindow(CARDS, 12)).toBe(false)
  expect(fitsWindow([], 8)).toBe(true)
})

test('lastFirst: the earliest item from which the rest fits whole', () => {
  expect(lastFirst(ones(32), 10)).toBe(22)
  expect(lastFirst(CARDS, 12)).toBe(2)
  expect(lastFirst([1, 1, 3, 4, 4], 8)).toBe(3) // 4 + 4 fit, 3 + 4 + 4 do not
  expect(lastFirst([1, 20], 8)).toBe(1) // the last item alone is taller
  expect(lastFirst(ones(5), 8)).toBe(0)
  expect(lastFirst([], 8)).toBe(0)
})

test('clampFirst keeps the window inside the list, in whole items', () => {
  expect(clampFirst(-2, CARDS, 12)).toBe(0)
  expect(clampFirst(9, CARDS, 12)).toBe(2)
  expect(clampFirst(1.4, CARDS, 12)).toBe(1)
  expect(clampFirst(Number.NaN, CARDS, 12)).toBe(0)
  expect(clampFirst(3, ones(5), 8)).toBe(0) // the list fits
})

test('shownCount: whole items only, at least one', () => {
  expect(shownCount(0, CARDS, 12)).toBe(3)
  expect(shownCount(0, [4, 3, 4, 4], 12)).toBe(3) // 11 rows, the fourth card would be cut
  expect(shownCount(1, [4, 3, 4, 4], 12)).toBe(3)
  expect(shownCount(0, [20, 1], 8)).toBe(1) // taller than the window: drawn alone
})

test('windowAt counts the items hidden on each side', () => {
  expect(windowAt(0, CARDS, 12)).toEqual({ first: 0, count: 3, above: 0, below: 2 })
  expect(windowAt(1, CARDS, 12)).toEqual({ first: 1, count: 3, above: 1, below: 1 })
  expect(windowAt(9, CARDS, 12)).toEqual({ first: 2, count: 3, above: 2, below: 0 })
  // A partly fitting item counts as hidden below.
  expect(windowAt(0, [4, 3, 4, 4], 12)).toEqual({ first: 0, count: 3, above: 0, below: 1 })
  expect(windowAt(4, ones(5), 8)).toEqual({ first: 0, count: 5, above: 0, below: 0 })
})

test('scrollToItem moves the window the least that shows an item whole', () => {
  expect(scrollToItem(0, 1, CARDS, 12)).toBe(0) // already shown
  expect(scrollToItem(0, 3, CARDS, 12)).toBe(1) // one past the bottom
  expect(scrollToItem(2, 0, CARDS, 12)).toBe(0) // above the top
  expect(scrollToItem(0, 4, CARDS, 12)).toBe(2) // the last: the end
  expect(scrollToItem(0, 1, [20, 1], 8)).toBe(1)
  expect(scrollToItem(1, -1, CARDS, 12)).toBe(1) // no item: unchanged
  // With unit rows it is the picker's row scroll.
  expect(scrollToItem(0, 10, ones(32), 10)).toBe(1)
  expect(scrollToItem(0, 31, ones(32), 10)).toBe(22)
})

test('moreText names the hidden items, blank when none', () => {
  expect(moreText('up', 2)).toBe('↑ 2 more')
  expect(moreText('down', 0)).toBe('')
})

test('follow: on until a wheel move pauses it on the active item it saw', () => {
  expect(isFollowing(LIST_TOP, 'w3')).toBe(true)
  const paused = wheelList(2, -1, CARDS, 12, 'a4')
  expect(paused).toEqual({ first: 1, paused: true, pausedAt: 'a4' })
  expect(isFollowing(paused, 'a4')).toBe(false)
  expect(isFollowing(paused, 'a5')).toBe(true) // the active item changed
  expect(isFollowing(wheelList(0, 1, CARDS, 12, null), null)).toBe(false)
  expect(wheelList(0, 99, CARDS, 12, null).first).toBe(2) // clamped
})

test('shownFirst keeps the active item in view while following, else the wheel offset', () => {
  expect(shownFirst(LIST_TOP, CARDS, 12, 4, 'a4')).toBe(2)
  expect(shownFirst(LIST_TOP, CARDS, 12, -1, null)).toBe(0)
  const paused = { first: 0, paused: true, pausedAt: 'a4' }
  expect(shownFirst(paused, CARDS, 12, 4, 'a4')).toBe(0)
  expect(shownFirst(paused, CARDS, 12, 4, 'a5')).toBe(2)
})

test('parseListScroll: anything malformed is the top, following', () => {
  expect(parseListScroll(undefined)).toEqual(LIST_TOP)
  expect(parseListScroll({ first: 'x', paused: 1 })).toEqual(LIST_TOP)
  expect(parseListScroll({ first: 3, paused: true, pausedAt: 'w1' })).toEqual({ first: 3, paused: true, pausedAt: 'w1' })
})

test('listAt: the list under a body row inside the viewport', () => {
  const spans = [
    { id: 'subagents' as const, top: 5, rows: 14 },
    { id: 'todos' as const, top: 22, rows: 10 },
  ]
  expect(listAt(spans, 5, 2, 30)).toBe('subagents')
  expect(listAt(spans, 18, 2, 30)).toBe('subagents')
  expect(listAt(spans, 19, 2, 30)).toBe(null)
  expect(listAt(spans, 25, 2, 30)).toBe('todos')
  // Out of the viewport (header above, footer below): never a list.
  expect(listAt([{ id: 'todos', top: 0, rows: 10 }], 1, 2, 30)).toBe(null)
  expect(listAt(spans, 31, 2, 20)).toBe(null)
  expect(listAt(spans, Number.NaN, 2, 30)).toBe(null)
})
