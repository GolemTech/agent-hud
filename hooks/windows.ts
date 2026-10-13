// Fixed-height list windows: pure helpers shared by the theme picker and the
// Subagents and Todo lists. Pure: no `$` here (see CLAUDE.md).
//
// A list is its items' heights in rows (a picker row is 1, a subagent card 3
// or 4, a todo as many as it wraps to). Past `window` rows it draws in a
// window of exactly `window` rows that shows a run of whole items from
// `first` (an item index), so an item is never cut in half; what is left of
// the window under the last whole item stays blank. Only an item taller than
// the window on its own is drawn alone and clipped. An indicator row above
// and one below name the items hidden on that side; both are always drawn
// while the list is windowed (blank when nothing is hidden there), so the
// list's row count never changes with its offset.

export const sumRows = (heights: readonly number[]): number => heights.reduce((n, h) => n + h, 0)

// Rows a list takes: all of it while it fits the window, else the window and
// its two indicator rows.
export const windowRows = (totalRows: number, window: number): number =>
  totalRows <= window ? totalRows : window + 2

// The list is drawn whole, as it always was, with no window and no indicators.
export const fitsWindow = (heights: readonly number[], window: number): boolean => sumRows(heights) <= window

// The last `first`: the earliest item from which every item to the end fits
// in the window; the last item when it alone is taller; 0 while it all fits.
export const lastFirst = (heights: readonly number[], window: number): number => {
  let used = 0
  for (let i = heights.length - 1; i >= 0; i--) {
    used += heights[i] ?? 0
    if (used > window) return Math.min(heights.length - 1, i + 1)
  }
  return 0
}

// `first` within [0, lastFirst], in whole items; a non-number is the top.
export const clampFirst = (first: number, heights: readonly number[], window: number): number => {
  const max = lastFirst(heights, window)
  return Number.isFinite(first) ? Math.min(max, Math.max(0, Math.round(first))) : 0
}

// Whole items the window shows from `first`; at least one while any is left.
export const shownCount = (first: number, heights: readonly number[], window: number): number => {
  let used = 0
  let count = 0
  for (let i = first; i < heights.length; i++) {
    const h = heights[i] ?? 0
    if (count > 0 && used + h > window) break
    used += h
    count += 1
  }
  return count
}

export type ListWindow = {
  /** The first item drawn. */
  first: number
  /** Items drawn, from `first`. */
  count: number
  /** Items hidden above the window. */
  above: number
  /** Items hidden below it, an item that would only partly fit included. */
  below: number
}

// What the window draws at `first` (clamped); the whole list while it fits.
export const windowAt = (first: number, heights: readonly number[], window: number): ListWindow => {
  if (fitsWindow(heights, window)) return { first: 0, count: heights.length, above: 0, below: 0 }
  const from = clampFirst(first, heights, window)
  const count = shownCount(from, heights, window)
  return { first: from, count, above: from, below: heights.length - from - count }
}

// The `first` that brings item `index` into view with the least move:
// unchanged when it is already shown whole, else the item at the window's
// top or bottom edge. An index out of the list keeps `first` (clamped).
export const scrollToItem = (first: number, index: number, heights: readonly number[], window: number): number => {
  const from = clampFirst(first, heights, window)
  if (index < 0 || index >= heights.length) return from
  if (index < from) return clampFirst(index, heights, window)
  if (index < from + shownCount(from, heights, window)) return from
  let g = index
  let used = heights[index] ?? 0
  while (g > 0 && used + (heights[g - 1] ?? 0) <= window) {
    g -= 1
    used += heights[g] ?? 0
  }
  return clampFirst(g, heights, window)
}

// An indicator line for the hidden items; blank when there are none.
export const moreText = (dir: 'up' | 'down', n: number): string => (n > 0 ? `${dir === 'up' ? '↑' : '↓'} ${n} more` : '')

// ── Follow the active item ───────────────────────────────────────────────
// A list window keeps its active item (the todo in progress, the first
// running subagent) in view. A person's wheel move over the list pauses that
// on the active item it saw, until the active item is another one.

export type ListScroll = {
  /** The first item the window shows, as last moved by the wheel. */
  first: number
  /** A wheel move paused the follow. */
  paused: boolean
  /** The active item's id when the wheel paused it; null when none was active. */
  pausedAt: string | null
}

export const LIST_TOP: ListScroll = { first: 0, paused: false, pausedAt: null }

// A stored value as a ListScroll; anything malformed is the top, following.
export const parseListScroll = (v: unknown): ListScroll => {
  if (typeof v !== 'object' || v === null) return LIST_TOP
  const { first, paused, pausedAt } = v as Record<string, unknown>
  return {
    first: typeof first === 'number' && Number.isFinite(first) ? first : 0,
    paused: paused === true,
    pausedAt: typeof pausedAt === 'string' ? pausedAt : null,
  }
}

// The follow is on unless the wheel paused it on this same active item.
export const isFollowing = (s: ListScroll, activeId: string | null): boolean => !s.paused || s.pausedAt !== activeId

// The `first` the window is drawn at: the active item kept in view with the
// least move while following, else the wheel's own offset.
export const shownFirst = (
  s: ListScroll,
  heights: readonly number[],
  window: number,
  activeIndex: number,
  activeId: string | null,
): number =>
  isFollowing(s, activeId) && activeIndex >= 0
    ? scrollToItem(s.first, activeIndex, heights, window)
    : clampFirst(s.first, heights, window)

// A wheel move over the list: `by` items from where it is drawn, clamped,
// and the follow paused on the active item it saw.
export const wheelList = (
  shown: number,
  by: number,
  heights: readonly number[],
  window: number,
  activeId: string | null,
): ListScroll => ({ first: clampFirst(shown + by, heights, window), paused: true, pausedAt: activeId })

// ── Wheel routing ────────────────────────────────────────────────────────
// Where each windowed list is drawn, in body rows (0 at the body's first
// row, as `ui.scroll`'s pointer counts them), so a wheel tick over a list's
// rows scrolls that list and any other tick scrolls the Pane.

export type ListId = 'subagents' | 'todos'

export type ListSpan = {
  id: ListId
  /** The body row of the list's first row (its top indicator). */
  top: number
  /** Rows it spans: the window and both indicators. */
  rows: number
}

// The list under the pointer's body row; null over anything else, and over
// a list's rows scrolled out of the viewport (under the sticky header or the
// footer), which are not drawn there.
export const listAt = (
  spans: readonly ListSpan[],
  row: number,
  viewTop: number,
  viewRows: number,
): ListId | null => {
  if (!Number.isFinite(row) || row < viewTop || row >= viewTop + viewRows) return null
  return spans.find(s => row >= s.top && row < s.top + s.rows)?.id ?? null
}
