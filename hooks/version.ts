// The oldest Claude Code the HUD supports. The plugin manifest has no field
// for a minimum engine version, so `register.tsx` checks it at session start
// and draws only a notice below it (older builds drew a blank sidebar). Pure.

export const MIN_CLAUDE_CODE_VERSION = '2.1.295'

// The numeric core of `2.1.296`, `v2.1.296 (Claude Code)` or
// `2.1.296-dev.<build>`; undefined when the text starts with anything else.
const core = (raw: string): [number, number, number] | undefined => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?!\d)/.exec(raw.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

// Whether `raw` is at least the minimum, compared segment by segment as
// numbers. A prerelease counts as its release (`2.1.295-dev` is supported).
// Undefined when the version is unknown or unreadable: that never blocks.
export const isSupportedVersion = (raw: string | undefined): boolean | undefined => {
  const found = raw === undefined ? undefined : core(raw)
  const min = core(MIN_CLAUDE_CODE_VERSION)
  if (!found || !min) return undefined
  const [major, minor, patch] = found
  const [minMajor, minMinor, minPatch] = min
  if (major !== minMajor) return major > minMajor
  if (minor !== minMinor) return minor > minMinor
  return patch >= minPatch
}

export const unsupportedMessage = (found: string): string =>
  `Agent HUD needs Claude Code ${MIN_CLAUDE_CODE_VERSION} or newer (found ${found}). Run 'claude update'.`
