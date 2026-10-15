
// The Gentle AI section: the gentle-ai toolset's versions and update status,
// the Gentleman Guardian Angel (gga) review hook, receipt-driven development
// (RDD) and the TDD policy. Detection only reads files and runs read-only
// commands; gga itself is never run for it (every gga command but `run` checks
// GitHub for updates, and `gga config` sources the repository's `.gga`).

import { clean } from './text'

// ── Pure helpers ─────────────────────────────────────────────────────────

// `gentle-ai 4.0.0` → 4.0.0: the first x.y.z in the text.
export const parseVersion = (text: string): string | null => /(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? null

// A gga config (`.gga`, `~/.config/gga/config`) is a shell file of
// `KEY="value"` lines. It is read as text and never executed: `$(...)` or
// backticks in a value stay literal text. Comments and other lines are
// skipped; a later assignment wins, as it would in the shell.
export const parseGgaConfig = (text: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|'([^']*)'|([^\s#]*))\s*(?:#.*)?$/.exec(line)
    if (!m?.[1]) continue
    out[m[1]] = clean(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return out
}

// gga marks its block in a hook file. Before the markers it wrote a bare
// `gga run` line (what its own uninstall still looks for), and older still,
// as `ai-code-review`, an `ai-code-review run` line (which `gga install`
// migrates). Only such a run command counts: a comment or any other text
// that mentions either name does not.
const GGA_MARKER = '# ======== GGA START ========'
const LEGACY_RUN = /^[ \t]*(?:gga|ai-code-review)[ \t]+run\b/m
export const ggaHookInstalled = (text: string): boolean => text.includes(GGA_MARKER) || LEGACY_RUN.test(text)

// An absolute path: POSIX `/…`, a Windows drive (`C:\\…`, `C:/…`) or UNC
// (`\\\\server\\…`). Git for Windows may print any of them.
export const isAbsolutePath = (p: string): boolean => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')

// The repo's hooks folder. Claude Code runs git with `core.hooksPath` forced to
// /dev/null, so `git rev-parse --git-path hooks` cannot be asked; the repo's
// own `core.hooksPath` (read from its config file alone) or `<common dir>/hooks`
// is what git uses outside Claude Code. Relative paths are from the repo root.
export const hooksDir = (root: string, commonDir: string, configured: string, home: string | null): string => {
  const abs = (p: string) => (isAbsolutePath(p) ? p : `${root}/${p}`)
  const set = configured.trim()
  if (!set) return `${abs(commonDir.trim())}/hooks`
  if (set === '~' || set.startsWith('~/')) return home ? `${home}${set.slice(1)}` : abs(set)
  return abs(set)
}

export type OnOff = 'on' | 'off'
export type RddStatus = {
  effective: OnOff
  /** Which setting decides: `global`, `clone` or `default`. */
  source: string
  global: OnOff | null
  /** The clone-local (project) setting; null when unset. */
  project: OnOff | null
}

const onOff = (v: unknown): OnOff | null => (v === 'on' || v === 'off' ? v : null)

// `gentle-ai review mode status --json`; null when it is not that shape.
export const parseRddStatus = (json: string): RddStatus | null => {
  try {
    const s = (JSON.parse(json) as { status?: Record<string, unknown> }).status
    const effective = onOff(s?.effective)
    if (!s || !effective) return null
    return {
      effective,
      source: typeof s.source === 'string' ? clean(s.source) : 'unknown',
      global: onOff(s.global),
      project: onOff(s.clone_local),
    }
  } catch {
    return null
  }
}

export type StrictTdd = 'on' | 'off' | 'unset'

// `strict_tdd: true` in `openspec/config.yaml`, written by the sdd-init flow.
// A line match, not a YAML parser: the value may be quoted, in any case, a
// YAML 1.1 yes/no/on/off, and followed by spaces and a `# comment`; a
// commented-out line or any other value does not count.
const STRICT_TDD_LINE = /^[ \t]*strict_tdd[ \t]*:[ \t]*(["']?)([A-Za-z]+)\1[ \t]*(?:#.*)?\r?$/m
const YAML_TRUE = new Set(['true', 'yes', 'on'])
const YAML_FALSE = new Set(['false', 'no', 'off'])
export const parseStrictTdd = (yaml: string): StrictTdd => {
  const value = STRICT_TDD_LINE.exec(yaml)?.[2]?.toLowerCase() ?? ''
  return YAML_TRUE.has(value) ? 'on' : YAML_FALSE.has(value) ? 'off' : 'unset'
}

// `brew outdated --json=v2` → newer version by short formula name (only
// outdated formulae are listed); null when the output is not that JSON.
export const parseBrewOutdated = (json: string): Record<string, string> | null => {
  try {
    const { formulae } = JSON.parse(json) as { formulae?: unknown }
    if (!Array.isArray(formulae)) return null
    const out: Record<string, string> = {}
    for (const f of formulae as { name?: unknown; current_version?: unknown }[]) {
      if (typeof f.name !== 'string' || typeof f.current_version !== 'string') continue
      out[clean(f.name.split('/').pop() ?? f.name)] = clean(f.current_version)
    }
    return out
  } catch {
    return null
  }
}

// `brew list --versions` → installed version by name (the first listed).
export const parseBrewList = (text: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const [name, version] = clean(line).trim().split(/\s+/)
    if (name && version) out[name] = version
  }
  return out
}

// Only a plain relative file name goes into the prompt text; anything else
// (an absolute path, spaces, punctuation) falls back to the default.
const SAFE_RULES = /^(?!\/)(?!.*\.\.)[\w./-]{1,80}$/
export const rulesFileName = (raw: string | undefined): string =>
  raw && SAFE_RULES.test(raw) ? raw : 'AGENTS.md'

// A RULES_FILE that is set but unsafe: `AGENTS.md` is checked instead, and
// the section says so.
export const rulesFileOverridden = (raw: string | undefined): boolean => Boolean(raw) && !SAFE_RULES.test(raw ?? '')

export const rulesPrompt = (raw: string): string => {
  const name = rulesFileName(raw)
  const what = name === 'AGENTS.md' ? 'an AGENTS.md' : name
  return `Create ${what} at the repository root with code review rules for Gentleman Guardian Angel (gga) tailored to this project's stack and conventions; keep it concise and actionable.`
}

export const STRICT_TDD_PROMPT =
  "Configure strict TDD for this project: run the sdd-init flow so that openspec/config.yaml sets strict_tdd: true with the project's test command."

// ── Detection ────────────────────────────────────────────────────────────

export const TOOLS = ['gentle-ai', 'gga', 'engram'] as const
export type ToolName = (typeof TOOLS)[number]

export type ToolStatus = {
  name: ToolName
  /** Installed version; null when not installed or unknown. */
  version: string | null
  /** Newer version brew knows of; null when up to date or unknown. */
  update: string | null
  /** Found on PATH although its version is unknown (gga without brew). */
  installed?: boolean
}

// Installed: a known version, or found on PATH without one.
export const toolInstalled = (t: ToolStatus): boolean => Boolean(t.version) || t.installed === true

export type GentleInfo = {
  tools: ToolStatus[]
  /** Whether brew answered the update check (else no up-to-date claim). */
  updatesKnown: boolean
  /** The session's repository root; null outside a repository. */
  root: string | null
  gga: {
    hook: boolean | null
    /** A project `.gga` exists. */
    projectConfig: boolean
    /** The rules file checked: RULES_FILE when safe, else `AGENTS.md`. */
    rulesFile: string
    /** RULES_FILE was set but unsafe, so `AGENTS.md` is checked instead. */
    rulesOverridden?: boolean
    rules: boolean | null
  }
  rdd: RddStatus | null
  strictTdd: StrictTdd | null
}

// brew reads its local tap metadata only: no auto-update, no analytics.
export const BREW_ENV = {
  HOMEBREW_NO_AUTO_UPDATE: '1',
  HOMEBREW_NO_ANALYTICS: '1',
  HOMEBREW_NO_ENV_HINTS: '1',
} as const

// How long a read-only command may run before `$.process.run` kills it and
// rejects: git, gentle-ai and date answer at once; brew loads Ruby first.
export const CMD_TIMEOUT_MS = 5_000
export const BREW_TIMEOUT_MS = 15_000
// A confirmed action (`gga install`, `gentle-ai review mode ...`) may write
// files, so it gets longer than a read-only probe.
export const ACTION_TIMEOUT_MS = 30_000
// A refresh joins a detection under way only this long after it started.
// Detection runs its probes one after another, each with its own timeout
// (three brew runs at most 15 s, seven other commands at most 5 s: 80 s), so a
// run older than this is stuck (a read that never answers) and a new one
// starts; the generation number drops the stuck run's result if it ever ends.
export const GENTLE_JOIN_DEADLINE_MS = 90_000

// What the section draws.
export type GentleView = GentleInfo

// ── Actions ──────────────────────────────────────────────────────────────

export type GentleAction =
  | 'gga-install'
  | 'gga-init'
  | 'rdd-project-on'
  | 'rdd-project-off'
  | 'rdd-global-on'
  | 'rdd-global-off'

const OFF_WINS = 'Off always wins: a project "on" cannot override a global "off".'

// The confirmation, constant argv and result message of each command button.
export const actionSpec = (
  action: GentleAction,
  root: string,
): { question: string; argv: string[]; env?: Record<string, string>; stdin?: string; done: string } => {
  const mode = (verb: 'enable' | 'disable', scope: 'clone' | 'global') =>
    scope === 'clone'
      ? ['gentle-ai', 'review', 'mode', verb, '--scope', 'clone', '--cwd', root, '--json']
      : ['gentle-ai', 'review', 'mode', verb, '--scope', 'global', '--json']
  switch (action) {
    case 'gga-install':
      return {
        question: 'Install the gga pre-commit hook in this repository (runs `gga install`)?',
        argv: ['gga', 'install'],
        env: { CURL_CMD: 'false' },
        done: 'gga hook installed',
      }
    case 'gga-init':
      return {
        question: 'Create a sample .gga config in this repository (runs `gga init`)?',
        argv: ['gga', 'init'],
        env: { CURL_CMD: 'false' },
        stdin: 'n\n',
        done: 'gga config created',
      }
    case 'rdd-project-on':
      return {
        question: `Turn receipt-driven development on for this project (gentle-ai review mode enable --scope clone)? ${OFF_WINS}`,
        argv: mode('enable', 'clone'),
        done: 'RDD on for this project',
      }
    case 'rdd-project-off':
      return {
        question: `Turn receipt-driven development off for this project (gentle-ai review mode disable --scope clone)? ${OFF_WINS}`,
        argv: mode('disable', 'clone'),
        done: 'RDD off for this project',
      }
    case 'rdd-global-on':
      return {
        question: `Turn receipt-driven development on for every project (gentle-ai review mode enable --scope global)? ${OFF_WINS}`,
        argv: mode('enable', 'global'),
        done: 'RDD on globally',
      }
    case 'rdd-global-off':
      return {
        question: `Turn receipt-driven development off for every project (gentle-ai review mode disable --scope global)? ${OFF_WINS}`,
        argv: mode('disable', 'global'),
        done: 'RDD off globally',
      }
  }
}

export const RUN_IT = 'Run it'
export const CANCEL = 'Cancel'

// ── Section grid ─────────────────────────────────────────────────────────

// One status vocabulary for the whole section, colored by meaning with theme
// keys: ✓ ok, ✗ missing, ↑ x.y.z update, ● on, ○ off, — unset, ? unknown.
// A Mark without a tone draws in the default text color.
export type Tone = 'success' | 'error' | 'warning' | 'subtle'
export type Mark = { text: string; tone?: Tone }

const OK: Mark = { text: '✓', tone: 'success' }
const MISSING: Mark = { text: '✗', tone: 'error' }
const ACTIVE: Mark = { text: '●', tone: 'success' }
const INACTIVE: Mark = { text: '○', tone: 'subtle' }
const UNSET: Mark = { text: '—', tone: 'subtle' }
const UNKNOWN: Mark = { text: '?', tone: 'subtle' }

export const checkMark = (v: boolean | null): Mark => (v ? OK : v === false ? MISSING : UNKNOWN)

// A tool's status: a newer version, up to date, or ? when brew did not answer
// or the version is unknown (no up-to-date claim without it); ✗ when it is
// not installed.
export const toolMark = (t: ToolStatus, updatesKnown: boolean): Mark =>
  !toolInstalled(t)
    ? MISSING
    : !t.version
      ? UNKNOWN
      : t.update
        ? { text: `↑ ${t.update}`, tone: 'warning' }
        : updatesKnown
          ? OK
          : UNKNOWN

const INSTALLED: Mark = { text: 'installed' }
const toolValue = (t: ToolStatus): Mark => (t.version ? { text: t.version } : t.installed ? INSTALLED : UNSET)

// One RDD scope's own setting; `known` is false when RDD could not be read.
export const scopeMark = (v: OnOff | null, known: boolean): Mark =>
  !known ? UNKNOWN : v === 'on' ? ACTIVE : v === 'off' ? INACTIVE : UNSET

export const strictMark = (v: StrictTdd): Mark => (v === 'on' ? ACTIVE : v === 'off' ? INACTIVE : UNSET)

// The effective RDD value and what decides it; gentle-ai's `clone` scope is
// the row the section calls `project`.
export const rddSummary = (rdd: RddStatus | null): Mark => {
  if (!rdd) return { text: '? unknown', tone: 'subtle' }
  const source = rdd.source === 'clone' ? 'project' : rdd.source
  return rdd.effective === 'on'
    ? { text: `● on · ${source}`, tone: 'success' }
    : { text: `○ off · ${source}`, tone: 'subtle' }
}

// Buttons that fill the prompt instead of running a command.
export type PromptKey = 'gga-rules' | 'tdd-configure'
export type GentleButton = { key: GentleAction | PromptKey; label: string; selected?: boolean }

export type GentleRow =
  | { kind: 'heading'; label: string; summary: Mark | null }
  | { kind: 'item'; label: string; value: Mark; detail: Mark | null; buttons: GentleButton[] }

const RULES_IGNORED = ' (RULES_FILE ignored)'
const TDD_SUMMARY: Mark = { text: 'test-first (ODD)' }

// The section's rows, in order, as data: the Pane draws them and counts their
// rows from the same list, so the tree and the estimate cannot drift apart.
// Called once gentle-ai is known to be installed.
export const gentleGrid = (g: GentleView): GentleRow[] => {
  const rows: GentleRow[] = []
  const item = (label: string, value: Mark, detail: Mark | null = null, buttons: GentleButton[] = []) =>
    rows.push({ kind: 'item', label, value, detail, buttons })
  const scope = (v: OnOff | null, scopeName: 'project' | 'global'): GentleButton[] =>
    (['on', 'off'] as const).map(choice => ({
      key: `rdd-${scopeName}-${choice}` as GentleAction,
      label: choice,
      selected: v === choice,
    }))

  rows.push({
    kind: 'heading',
    label: 'Tools',
    summary: null,
  })
  for (const t of g.tools) item(t.name, toolValue(t), toolMark(t, g.updatesKnown))

  const gga = g.tools.find(t => t.name === 'gga')
  if (gga && toolInstalled(gga)) {
    rows.push({ kind: 'heading', label: 'gga', summary: g.root ? null : { text: 'no repository', tone: 'subtle' } })
    if (g.root) {
      item('hook', checkMark(g.gga.hook), null, [
        ...(g.gga.hook === false ? [{ key: 'gga-install' as const, label: 'install' }] : []),
        ...(g.gga.projectConfig ? [] : [{ key: 'gga-init' as const, label: 'init' }]),
      ])
      item(
        'rules',
        checkMark(g.gga.rules),
        { text: `${g.gga.rulesFile}${g.gga.rulesOverridden ? RULES_IGNORED : ''}` },
        g.gga.rules === false ? [{ key: 'gga-rules', label: 'create rules' }] : [],
      )
    }
  }

  rows.push({ kind: 'heading', label: 'RDD', summary: rddSummary(g.rdd) })
  if (g.root) item('project', scopeMark(g.rdd?.project ?? null, Boolean(g.rdd)), null, scope(g.rdd?.project ?? null, 'project'))
  item('global', scopeMark(g.rdd?.global ?? null, Boolean(g.rdd)), null, scope(g.rdd?.global ?? null, 'global'))

  rows.push({ kind: 'heading', label: 'TDD', summary: TDD_SUMMARY })
  if (g.strictTdd)
    item('strict', strictMark(g.strictTdd), null, g.strictTdd === 'on' ? [] : [{ key: 'tdd-configure', label: 'configure' }])
  return rows
}

