// Pure helpers for the Session branch row's upstream counts. The poller in
// `register.tsx` runs git; nothing here calls `$`.

/** Commits to push (`ahead`) and to pull (`behind`) against the upstream. */
export type AheadBehind = { ahead: number; behind: number }

// `git rev-list --left-right --count HEAD...@{upstream}` prints
// `<ahead>\t<behind>`. Anything else (empty, one number, text) is null.
export const parseAheadBehind = (stdout: string): AheadBehind | null => {
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(stdout)
  if (!m) return null
  return { ahead: Number(m[1]), behind: Number(m[2]) }
}

// The marks drawn after the branch name, each only when above zero:
// ` ↑3 ↓1`, ` ↑3`, ` ↓1` or ''. The Pane counts the branch row with its length.
export const aheadText = (ab: AheadBehind | null): string => (ab && ab.ahead > 0 ? ` ↑${ab.ahead}` : '')
export const behindText = (ab: AheadBehind | null): string => (ab && ab.behind > 0 ? ` ↓${ab.behind}` : '')
export const syncText = (ab: AheadBehind | null): string => aheadText(ab) + behindText(ab)
