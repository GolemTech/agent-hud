import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import {
  ACTION_TIMEOUT_MS,
  actionSpec,
  BREW_TIMEOUT_MS,
  CMD_TIMEOUT_MS,
  UPDATE_TIMEOUT_MS,
  UPGRADE_TIMEOUT_MS,
  checkMark,
  GENTLE_JOIN_DEADLINE_MS,
  gentleGrid,
  cellLines,
  gentleRowLines,
  rowCells,
  ggaHookInstalled,
  hooksDir,
  isAbsolutePath,
  parseBrewList,
  parseBrewOutdated,
  parseGentleUpdate,
  parseGgaConfig,
  parseRddStatus,
  parseStrictTdd,
  parseUpgradeResult,
  parseVersion,
  runFailure,
  upgradeToast,
  rddSummary,
  rulesFileName,
  rulesFileOverridden,
  rulesPrompt,
  scopeMark,
  strictMark,
  toolMark,
} from './gentle'
import type { GentleRow, GentleView } from './gentle'
import { gridFor } from './layout'

// ── Pure helpers ─────────────────────────────────────────────────────────

test('parseVersion: the first x.y.z in the text, null otherwise', () => {
  expect(parseVersion('gentle-ai 4.0.0\n')).toBe('4.0.0')
  expect(parseVersion('v10.2.33-rc.1')).toBe('10.2.33')
  expect(parseVersion('')).toBe(null)
  expect(parseVersion('gentle-ai dev')).toBe(null)
})

test('parseGgaConfig: shell KEY="value" lines read as text, never evaluated', () => {
  const text = [
    '# Gentleman Guardian Angel',
    'PROVIDER="claude"',
    "RULES_FILE='REVIEW.md'",
    'TIMEOUT=300',
    '  export STRICT_MODE="true"  # trailing comment',
    'FILE_PATTERNS="$(rm -rf /tmp/x)"',
    'EXCLUDE=`id`',
    'not a pair',
    '# PROVIDER="ignored"',
  ].join('\n')
  expect(parseGgaConfig(text)).toEqual({
    PROVIDER: 'claude',
    RULES_FILE: 'REVIEW.md',
    TIMEOUT: '300',
    STRICT_MODE: 'true',
    FILE_PATTERNS: '$(rm -rf /tmp/x)',
    EXCLUDE: '`id`',
  })
  expect(parseGgaConfig('')).toEqual({})
  // A later line wins, as the shell would leave it.
  expect(parseGgaConfig('PROVIDER="a"\nPROVIDER="b"')).toEqual({ PROVIDER: 'b' })
})

test('ggaHookInstalled: the GGA block marker, or a legacy unmarked run line', () => {
  expect(ggaHookInstalled('#!/bin/sh\n# ======== GGA START ========\ngga run\n# ======== GGA END ========\n')).toBe(true)
  // Before the markers gga wrote a bare run line; older still, ai-code-review.
  expect(ggaHookInstalled('#!/bin/sh\n# Gentleman Guardian Angel\ngga run || exit 1\n')).toBe(true)
  expect(ggaHookInstalled('#!/bin/sh\n  ai-code-review run || exit 1\n')).toBe(true)
  expect(ggaHookInstalled('#!/bin/sh\ngga run "$1" || exit 1\n')).toBe(true)
  // A mention is not an installed hook.
  expect(ggaHookInstalled('#!/bin/sh\n# ai-code-review\n')).toBe(false)
  expect(ggaHookInstalled('#!/bin/sh\necho "see ai-code-review docs"\n')).toBe(false)
  expect(ggaHookInstalled('#!/bin/sh\n# gga run\n')).toBe(false)
  expect(ggaHookInstalled('#!/bin/sh\nmy-ai-code-review run\n')).toBe(false)
  expect(ggaHookInstalled('#!/bin/sh\ngitleaks protect --staged\n')).toBe(false)
  expect(ggaHookInstalled('')).toBe(false)
})

test('isAbsolutePath: POSIX, Windows drive and UNC paths are absolute', () => {
  for (const p of ['/home/myuser/repo/.git', 'C:\\Users\\myuser\\repo\\.git', 'C:/Users/myuser/repo/.git', 'd:\\x', '\\\\server\\share'])
    expect(isAbsolutePath(p)).toBe(true)
  for (const p of ['.git', '../common/.git', 'C:relative', 'hooks']) expect(isAbsolutePath(p)).toBe(false)
})

test('hooksDir: a Windows common dir is absolute, not joined to the root', () => {
  expect(hooksDir('C:/Users/myuser/repo', 'C:/Users/myuser/repo/.git', '', null)).toBe('C:/Users/myuser/repo/.git/hooks')
})

test('hooksDir: the repo-configured core.hooksPath, else <common dir>/hooks', () => {
  expect(hooksDir('/home/myuser/p', '.git', '', null)).toBe('/home/myuser/p/.git/hooks')
  expect(hooksDir('/home/myuser/p', '/home/myuser/main/.git\n', '', null)).toBe('/home/myuser/main/.git/hooks')
  expect(hooksDir('/home/myuser/p', '.git', '.husky\n', null)).toBe('/home/myuser/p/.husky')
  expect(hooksDir('/home/myuser/p', '.git', '/opt/hooks', null)).toBe('/opt/hooks')
  expect(hooksDir('/home/myuser/p', '.git', '~/hooks', '/home/myuser')).toBe('/home/myuser/hooks')
})

test('parseRddStatus: effective mode and its source from the status JSON', () => {
  const json = JSON.stringify({
    schema: 'gentle-ai.review-mode/v1',
    status: { global: 'on', clone_local: '', effective: 'on', source: 'global' },
  })
  expect(parseRddStatus(json)).toEqual({ effective: 'on', source: 'global', global: 'on', project: null })
  expect(
    parseRddStatus(JSON.stringify({ status: { global: 'off', clone_local: 'on', effective: 'off', source: 'global' } })),
  ).toEqual({ effective: 'off', source: 'global', global: 'off', project: 'on' })
  expect(parseRddStatus('{"status":{"effective":"on","source":"default"}}')).toEqual({
    effective: 'on',
    source: 'default',
    global: null,
    project: null,
  })
  expect(parseRddStatus('not json')).toBe(null)
  expect(parseRddStatus('{}')).toBe(null)
  expect(parseRddStatus('{"status":{"effective":"maybe"}}')).toBe(null)
})

test('parseStrictTdd: strict_tdd true / false / unset from openspec/config.yaml text', () => {
  expect(parseStrictTdd('project: shop\nstrict_tdd: true\n')).toBe('on')
  expect(parseStrictTdd('rules:\n  strict_tdd: false # for now\n')).toBe('off')
  expect(parseStrictTdd('project: shop\n')).toBe('unset')
  expect(parseStrictTdd('# strict_tdd: true\n')).toBe('unset')
  expect(parseStrictTdd('')).toBe('unset')
})

test('parseStrictTdd: quoted values, inline comments, spaces and YAML yes/no/on/off', () => {
  expect(parseStrictTdd('strict_tdd: "true"\n')).toBe('on')
  expect(parseStrictTdd("strict_tdd: 'false'\n")).toBe('off')
  expect(parseStrictTdd('strict_tdd: true # enforced\n')).toBe('on')
  expect(parseStrictTdd('  strict_tdd  :   false   \n')).toBe('off')
  expect(parseStrictTdd('strict_tdd: true\r\n')).toBe('on')
  expect(parseStrictTdd('strict_tdd: yes\n')).toBe('on')
  expect(parseStrictTdd('strict_tdd: On\n')).toBe('on')
  expect(parseStrictTdd('strict_tdd: no\n')).toBe('off')
  expect(parseStrictTdd('strict_tdd: OFF\n')).toBe('off')
  // Commented out, mismatched quotes or another key: not a setting.
  expect(parseStrictTdd('  # strict_tdd: true\nstrict_tdd: false\n')).toBe('off')
  expect(parseStrictTdd('strict_tdd: "true\n')).toBe('unset')
  expect(parseStrictTdd('strict_tdd: trueish\n')).toBe('unset')
  expect(parseStrictTdd('not_strict_tdd: true\n')).toBe('unset')
})

test('parseBrewOutdated: the newer version per formula, short names', () => {
  const json = JSON.stringify({
    formulae: [
      { name: 'example-tap/tap/engram', installed_versions: ['2.2.1'], current_version: '3.3.0' },
      { name: 'gga', installed_versions: ['2.10.1'], current_version: '2.11.0' },
    ],
    casks: [],
  })
  expect(parseBrewOutdated(json)).toEqual({ engram: '3.3.0', gga: '2.11.0' })
  expect(parseBrewOutdated('{"formulae":[],"casks":[]}')).toEqual({})
  expect(parseBrewOutdated('Warning: something\n')).toBe(null)
  expect(parseBrewOutdated('')).toBe(null)
  expect(parseBrewOutdated('{"formulae":[{"name":42}]}')).toEqual({})
})

// `gentle-ai update` as gentle-ai 4.1.1 prints it (exit 0).
const UPDATE_TABLE = [
  'Update Check',
  '============',
  '',
  '  [UP] gentle-ai     installed: 4.1.1       latest: 4.2.0       brew upgrade --formula gentle-ai',
  '  [ok] engram        installed: 3.4.0       latest: 3.4.0',
  '  [ok] gga           installed: 2.10.1      latest: 2.10.1',
  '',
  '1 update(s) available.',
  '',
].join('\n')

test('parseGentleUpdate: installed and latest per known tool from the update table', () => {
  expect(parseGentleUpdate(UPDATE_TABLE)).toEqual({
    'gentle-ai': { installed: '4.1.1', latest: '4.2.0' },
    engram: { installed: '3.4.0', latest: '3.4.0' },
    gga: { installed: '2.10.1', latest: '2.10.1' },
  })
})

test('parseGentleUpdate: spinner frames on \\r, ANSI colors, CRLF and unknown tools are tolerated', () => {
  const noisy =
    '  ⠋ Checking for updates...\r  ⠙ Checking for updates...\r\u001b[2K\r' +
    UPDATE_TABLE.replace('[UP]', '\u001b[33m[UP]\u001b[0m').replace(/\n/g, '\r\n') +
    '  [ok] other-tool    installed: 1.0.0       latest: 1.0.0\n'
  expect(parseGentleUpdate(noisy)).toEqual({
    'gentle-ai': { installed: '4.1.1', latest: '4.2.0' },
    engram: { installed: '3.4.0', latest: '3.4.0' },
    gga: { installed: '2.10.1', latest: '2.10.1' },
  })
})

test('parseGentleUpdate: only the tools whose row parses; null when none does', () => {
  expect(parseGentleUpdate('  [UP] engram  installed: 3.3.0  latest: 3.4.0  brew upgrade engram  extra\n')).toEqual({
    engram: { installed: '3.3.0', latest: '3.4.0' },
  })
  expect(parseGentleUpdate('  [??] gga  installed: unknown  latest: 2.10.1\n')).toBe(null)
  expect(parseGentleUpdate('  ⠋ Checking for updates...\r')).toBe(null)
  expect(parseGentleUpdate('')).toBe(null)
  expect(parseGentleUpdate('{"tools":[]}')).toBe(null)
})

// `gentle-ai upgrade gga` on Windows with gga installed by hand (exit 0): it
// skips the tool, wraps the row's message onto the next line, and says so only
// in the summary line.
const UPGRADE_WINDOWS = [
  '  ⠋ Upgrading gga via script (2.8.1 → 2.10.1)...',
  '  -- Upgrading gga via script (2.8.1 → 2.10.1)',
  'Upgrade',
  '=======',
  '',
  '  Upgrades managed tool binaries only.',
  '  Agent configs are preserved — no install or sync is performed.',
  '',
  '  [--] gga           manual update required: upgrade "gga" on Windows requires manual',
  'update: See https://github.com/Gentleman-Programming/gentleman-guardian-angel',
  '',
  '  Config backup: upgrade-20261016T003724Z',
  '  0 succeeded, 0 failed, 1 skipped.',
  '',
].join('\n')
const GGA_URL = 'https://github.com/Gentleman-Programming/gentleman-guardian-angel'
const WINDOWS_REASON = `manual update required: upgrade "gga" on Windows requires manual update: See ${GGA_URL}`
const UPGRADE_SUCCESS = '  1 succeeded, 0 failed, 0 skipped.\n'

test('parseUpgradeResult: the summary counts and the wrapped row message', () => {
  expect(parseUpgradeResult(UPGRADE_WINDOWS)).toEqual({ succeeded: 0, failed: 0, skipped: 1, reason: WINDOWS_REASON })
  expect(parseUpgradeResult('  1 succeeded, 0 failed, 0 skipped.\n')).toEqual({
    succeeded: 1,
    failed: 0,
    skipped: 0,
    reason: null,
  })
})

test('parseUpgradeResult: spinner frames on \\r, ANSI colors and CRLF are tolerated', () => {
  const noisy =
    '  ⠋ Upgrading gga via script...\r  ⠙ Upgrading gga via script...\r\u001b[2K\r' +
    UPGRADE_WINDOWS.replace('[--]', '\u001b[33m[--]\u001b[0m')
      .replace('1 skipped', '\u001b[1m1\u001b[0m skipped')
      .replace(/\n/g, '\r\n')
  expect(parseUpgradeResult(noisy)).toEqual({ succeeded: 0, failed: 0, skipped: 1, reason: WINDOWS_REASON })
})

test('parseUpgradeResult: null without a summary line', () => {
  expect(parseUpgradeResult('')).toBe(null)
  expect(parseUpgradeResult('  ⠋ Upgrading gga via script...\r')).toBe(null)
  expect(parseUpgradeResult('  [--] gga  manual update required\n')).toBe(null)
  expect(parseUpgradeResult('  [--] gentle-ai 4.1.1 → 4.2.0 (dry-run)\n\n1 upgrade(s) pending\n')).toBe(null)
})

test('upgradeToast: the summary decides, never the exit code alone', () => {
  const r = (succeeded: number, failed: number, skipped: number, reason: string | null = null) => ({
    succeeded,
    failed,
    skipped,
    reason,
  })
  expect(upgradeToast('gga', 0, r(1, 0, 0), 'gga upgraded')).toBe('gga upgraded')
  expect(upgradeToast('gga', 0, r(0, 1, 0, 'download failed'), 'gga upgraded')).toBe('failed (download failed)')
  expect(upgradeToast('gga', 3, r(0, 1, 0), 'gga upgraded')).toBe('failed (exit 3)')
  expect(upgradeToast('gga', 0, r(0, 0, 1, 'already current'), 'gga upgraded')).toBe('gga not upgraded: already current')
  expect(upgradeToast('gga', 0, r(0, 0, 1), 'gga upgraded')).toBe('gga not upgraded')
  expect(upgradeToast('gga', 0, null, 'gga upgraded')).toBe('gga: upgrade finished, check the version')
  expect(upgradeToast('gga', 2, null, 'gga upgraded')).toBe('failed (exit 2)')
  expect(upgradeToast('gga', 2, r(1, 0, 0), 'gga upgraded')).toBe('failed (exit 2)')
})

test('upgradeToast: a long reason is cut with …, keeping its URL', () => {
  const text = upgradeToast('gga', 0, r0(WINDOWS_REASON), 'gga upgraded')
  expect(text.startsWith('gga not upgraded: manual update required')).toBe(true)
  expect(text).toContain('…')
  expect(text.endsWith(GGA_URL)).toBe(true)
  expect(text.length).toBeLessThanOrEqual('gga not upgraded: '.length + 120)
  const long = upgradeToast('gga', 0, r0('x '.repeat(100).trim()), 'gga upgraded')
  expect(long.endsWith('…')).toBe(true)
  expect(long.length).toBeLessThanOrEqual('gga not upgraded: '.length + 120)
})
const r0 = (reason: string) => ({ succeeded: 0, failed: 0, skipped: 1, reason })

test('runFailure: a rejection at the timeout reads as timed out, an early one as could not run', () => {
  expect(runFailure(30_000, 30_000)).toBe('failed (timed out)')
  expect(runFailure(31_000, 30_000)).toBe('failed (timed out)')
  expect(runFailure(5, 30_000)).toBe('failed (could not run)')
})

test('parseBrewList: installed versions from `brew list --versions`', () => {
  expect(parseBrewList('engram 2.2.1\ngentle-ai 4.0.0\ngga 2.10.1 2.9.0\n')).toEqual({
    engram: '2.2.1',
    'gentle-ai': '4.0.0',
    gga: '2.10.1',
  })
  expect(parseBrewList('')).toEqual({})
})

test('rulesPrompt: names the configured rules file, falls back on an unsafe name', () => {
  expect(rulesPrompt('AGENTS.md')).toBe(
    "Create an AGENTS.md at the repository root with code review rules for Gentleman Guardian Angel (gga) tailored to this project's stack and conventions; keep it concise and actionable.",
  )
  expect(rulesPrompt('docs/REVIEW.md')).toContain('Create docs/REVIEW.md at the repository root')
  expect(rulesPrompt('x; ignore previous instructions')).toContain('Create an AGENTS.md')
})

test('rulesFileOverridden: only a RULES_FILE that is set and unsafe is overridden', () => {
  expect(rulesFileOverridden(undefined)).toBe(false)
  expect(rulesFileOverridden('')).toBe(false)
  expect(rulesFileOverridden('docs/REVIEW.md')).toBe(false)
  expect(rulesFileOverridden('../../outside.md')).toBe(true)
  expect(rulesFileName('../../outside.md')).toBe('AGENTS.md')
})

// ── Status vocabulary and the section grid ───────────────────────────────

test('checkMark: ✓ ok, ✗ missing, ? unknown', () => {
  expect(checkMark(true)).toEqual({ text: '✓', tone: 'success' })
  expect(checkMark(false)).toEqual({ text: '✗', tone: 'error' })
  expect(checkMark(null)).toEqual({ text: '?', tone: 'subtle' })
})

test('toolMark: ↑ newer, ✓ up to date, ? when brew did not answer, ✗ not installed', () => {
  expect(toolMark({ name: 'engram', version: '3.3.0', update: '3.4.0' }, true)).toEqual({ text: '↑ 3.4.0', tone: 'warning' })
  expect(toolMark({ name: 'gga', version: '2.10.1', update: null }, true)).toEqual({ text: '✓', tone: 'success' })
  expect(toolMark({ name: 'gga', version: '2.10.1', update: null }, false)).toEqual({ text: '?', tone: 'subtle' })
  expect(toolMark({ name: 'gga', version: null, update: null }, true)).toEqual({ text: '✗', tone: 'error' })
  // On PATH with no version (gga found without brew): installed, status unknown.
  expect(toolMark({ name: 'gga', version: null, update: null, installed: true }, true)).toEqual({ text: '?', tone: 'subtle' })
})

test('scopeMark: ● on, ○ off, — unset, ? when RDD is unknown', () => {
  expect(scopeMark('on', true)).toEqual({ text: '●', tone: 'success' })
  expect(scopeMark('off', true)).toEqual({ text: '○', tone: 'subtle' })
  expect(scopeMark(null, true)).toEqual({ text: '—', tone: 'subtle' })
  expect(scopeMark(null, false)).toEqual({ text: '?', tone: 'subtle' })
})

test('strictMark: ● on, ○ off, — unset', () => {
  expect(strictMark('on')).toEqual({ text: '●', tone: 'success' })
  expect(strictMark('off')).toEqual({ text: '○', tone: 'subtle' })
  expect(strictMark('unset')).toEqual({ text: '—', tone: 'subtle' })
})

test('rddSummary: the effective value and the scope that decides it', () => {
  const rdd = (effective: 'on' | 'off', source: string) => ({ effective, source, global: null, project: null })
  expect(rddSummary(rdd('on', 'global'))).toEqual({ text: '● on · global', tone: 'success' })
  expect(rddSummary(rdd('off', 'clone'))).toEqual({ text: '○ off · project', tone: 'subtle' })
  expect(rddSummary(rdd('on', 'default'))).toEqual({ text: '● on · default', tone: 'success' })
  expect(rddSummary(null)).toEqual({ text: '? unknown', tone: 'subtle' })
})

const VIEW: GentleView = {
  tools: [
    { name: 'gentle-ai', version: '4.0.0', update: null },
    { name: 'gga', version: '2.10.1', update: null },
    { name: 'engram', version: '3.3.0', update: '3.4.0' },
  ],
  updatesKnown: true,
  root: '/home/myuser/code/demo-proj',
  gga: { hook: false, projectConfig: false, rulesFile: 'AGENTS.md', rules: true },
  rdd: { effective: 'on', source: 'global', global: 'on', project: null },
  strictTdd: 'unset',
}

test('gentleGrid: headings Tools, gga, RDD, TDD, each with its item rows', () => {
  const unset = { text: '—', tone: 'subtle' }
  expect(gentleGrid(VIEW)).toEqual([
    { kind: 'heading', label: 'Tools', summary: null },
    { kind: 'item', label: 'gentle-ai', value: { text: '4.0.0' }, detail: { text: '✓', tone: 'success' }, buttons: [] },
    { kind: 'item', label: 'gga', value: { text: '2.10.1' }, detail: { text: '✓', tone: 'success' }, buttons: [] },
    {
      kind: 'item',
      label: 'engram',
      value: { text: '3.3.0' },
      detail: { text: '↑ 3.4.0', tone: 'warning' },
      buttons: [{ key: 'gentle-upgrade-engram', label: 'upgrade' }],
    },
    { kind: 'heading', label: 'gga', summary: null },
    {
      kind: 'item',
      label: 'hook',
      value: { text: '✗', tone: 'error' },
      detail: null,
      buttons: [
        { key: 'gga-install', label: 'install' },
        { key: 'gga-init', label: 'init' },
      ],
    },
    { kind: 'item', label: 'rules', value: { text: '✓', tone: 'success' }, detail: { text: 'AGENTS.md' }, buttons: [] },
    { kind: 'heading', label: 'RDD', summary: { text: '● on · global', tone: 'success' } },
    {
      kind: 'item',
      label: 'project',
      value: unset,
      detail: null,
      buttons: [
        { key: 'rdd-project-on', label: 'on', selected: false },
        { key: 'rdd-project-off', label: 'off', selected: false },
      ],
    },
    {
      kind: 'item',
      label: 'global',
      value: { text: '●', tone: 'success' },
      detail: null,
      buttons: [
        { key: 'rdd-global-on', label: 'on', selected: true },
        { key: 'rdd-global-off', label: 'off', selected: false },
      ],
    },
    { kind: 'heading', label: 'TDD', summary: { text: 'test-first (ODD)' } },
    { kind: 'item', label: 'strict', value: unset, detail: null, buttons: [{ key: 'tdd-configure', label: 'configure' }] },
  ])
})

test('gentleGrid: what each state leaves out or adds', () => {
  const labels = (v: GentleView) => gentleGrid(v).map(r => `${r.kind === 'heading' ? '#' : ''}${r.label}`)
  // Outside a repository: no project row, and gga says why it has no rows.
  const noRepo = gentleGrid({ ...VIEW, root: null })
  expect(noRepo.find(r => r.label === 'gga' && r.kind === 'heading')).toEqual({
    kind: 'heading',
    label: 'gga',
    summary: { text: 'no repository', tone: 'subtle' },
  })
  expect(labels({ ...VIEW, root: null })).toEqual(['#Tools', 'gentle-ai', 'gga', 'engram', '#gga', '#RDD', 'global', '#TDD', 'strict'])
  // gga not installed: its version is —, its status ✗, and no gga group.
  const noGga = gentleGrid({ ...VIEW, tools: [VIEW.tools[0]!, { name: 'gga', version: null, update: null }, VIEW.tools[2]!] })
  expect(noGga[2]).toEqual({ kind: 'item', label: 'gga', value: { text: '—', tone: 'subtle' }, detail: { text: '✗', tone: 'error' }, buttons: [] })
  expect(noGga.some(r => r.kind === 'heading' && r.label === 'gga')).toBe(false)
  // gga on PATH with no version: `installed`, status ?, and its gga group.
  const pathGga = gentleGrid({
    ...VIEW,
    tools: [VIEW.tools[0]!, { name: 'gga', version: null, update: null, installed: true }, VIEW.tools[2]!],
  })
  expect(pathGga[2]).toEqual({ kind: 'item', label: 'gga', value: { text: 'installed' }, detail: { text: '?', tone: 'subtle' }, buttons: [] })
  expect(pathGga.some(r => r.kind === 'heading' && r.label === 'gga')).toBe(true)
  // Strict TDD unknown: no strict row.
  expect(gentleGrid({ ...VIEW, updatesKnown: false })[0]).toEqual({ kind: 'heading', label: 'Tools', summary: null })
  expect(labels({ ...VIEW, strictTdd: null }).slice(-1)).toEqual(['#TDD'])
  // RDD unknown: ? everywhere, no button marked.
  const unknown = gentleGrid({ ...VIEW, rdd: null })
  expect(unknown.find(r => r.label === 'RDD')).toEqual({ kind: 'heading', label: 'RDD', summary: { text: '? unknown', tone: 'subtle' } })
  expect(unknown.find(r => r.label === 'global')).toMatchObject({ value: { text: '?', tone: 'subtle' } })
  // An unsafe RULES_FILE says so, briefly; missing rules offer [create rules].
  expect(gentleGrid({ ...VIEW, gga: { ...VIEW.gga, rules: false, rulesOverridden: true } })[6]).toEqual({
    kind: 'item',
    label: 'rules',
    value: { text: '✗', tone: 'error' },
    detail: { text: 'AGENTS.md (RULES_FILE ignored)' },
    buttons: [{ key: 'gga-rules', label: 'create rules' }],
  })
  // Strict TDD on: ● and nothing to configure.
  expect(gentleGrid({ ...VIEW, strictTdd: 'on' }).slice(-1)[0]).toMatchObject({ value: { text: '●', tone: 'success' }, buttons: [] })
})

// ── Grid rows: a label cell and a value cell that wraps inside itself ────

test('cellLines: greedy lines inside the value cell; a wider item wraps over its own lines', () => {
  expect(cellLines([], 10)).toBe(0)
  expect(cellLines([6, 1], 10)).toBe(1) // 6 + 1 + 1
  expect(cellLines([6, 4, 5], 10)).toBe(2) // [6] then [4 5]
  expect(cellLines([6, 25, 4], 10)).toBe(5) // [6], 25 over 3 lines, [4]
})

// VIEW's grid: labels up to `gentle-ai` (label cell 11), values up to 6.
const GRID = gridFor(
  gentleGrid(VIEW).flatMap(r => (r.kind === 'item' ? [r.label] : [])),
  gentleGrid(VIEW).flatMap(r => (r.kind === 'item' ? [r.value.text] : [])),
  22,
)
const rowNamed = (label: string, kind: GentleRow['kind'] = 'item') =>
  gentleGrid(VIEW).find(r => r.label === label && r.kind === kind) as GentleRow

test('rowCells: the value cell takes the rest of the line; a heading summary moves to the value column when the detail column is too narrow', () => {
  expect(rowCells(rowNamed('project'), GRID, 22)).toEqual({ label: 11, cell: 10 })
  // `● on · global` (13) does not fit after the 18-cell span at 22 columns.
  expect(rowCells(rowNamed('RDD', 'heading'), GRID, 22)).toEqual({ label: 11, cell: 10 })
  expect(rowCells(rowNamed('RDD', 'heading'), GRID, 40)).toEqual({ label: 18, cell: 21 })
  // Never a cell under one column.
  expect(rowCells(rowNamed('project'), GRID, 5).cell).toBe(1)
})

test('gentleRowLines: wrapped value-cell lines count, at the cell width', () => {
  // `—` [on] [off] fit on one 39-cell line, but wrap once in a 10-cell cell.
  expect(gentleRowLines(rowNamed('project'), GRID, 40)).toBe(1)
  expect(gentleRowLines(rowNamed('project'), GRID, 22)).toBe(2)
  // `●` [● on] [off]: each part on its own line in 10 cells.
  expect(gentleRowLines(rowNamed('global'), GRID, 22)).toBe(3)
  // `test-first (ODD)` (16) wraps over two lines of the 10-cell cell.
  expect(gentleRowLines(rowNamed('TDD', 'heading'), GRID, 22)).toBe(2)
  expect(gentleRowLines(rowNamed('Tools', 'heading'), GRID, 22)).toBe(1)
})

test('gentleRowLines: an [upgrade] button counts in its tool row', () => {
  // `3.3.0 ` ↑ 3.4.0 [upgrade]: 6 + 1 + 7 + 1 + 9 = 24 fits a 28-cell cell.
  expect(gentleRowLines(rowNamed('engram'), GRID, 40)).toBe(1)
  // In a 10-cell cell: the value with nothing beside it, ↑ 3.4.0, [upgrade].
  expect(gentleRowLines(rowNamed('engram'), GRID, 22)).toBe(3)
  // The same row without its button takes one line less.
  const bare = { ...rowNamed('engram'), buttons: [] } as GentleRow
  expect(gentleRowLines(bare, GRID, 22)).toBe(2)
})

// ── Upgrade actions ──────────────────────────────────────────────────────

const TOOL_VERSIONS = [
  { name: 'gentle-ai', version: '4.1.1', update: '4.2.0' },
  { name: 'gga', version: '2.10.1', update: '2.11.0' },
  { name: 'engram', version: '3.3.0', update: '3.4.0' },
] as const

test('actionSpec: each tool upgrades through `gentle-ai upgrade <tool>`, untracked and with a long timeout', () => {
  for (const t of TOOL_VERSIONS) {
    const spec = actionSpec(`gentle-upgrade-${t.name}`, '/home/myuser/code/demo-proj', TOOL_VERSIONS)
    expect(spec.argv).toEqual(['gentle-ai', 'upgrade', t.name])
    expect(spec.env).toEqual({ DO_NOT_TRACK: '1' })
    expect(spec.timeoutMs).toBe(UPGRADE_TIMEOUT_MS)
    expect(spec.question).toContain(t.name)
    expect(spec.question).toContain(`${t.version} → ${t.update}`)
    expect(spec.question).toContain(`gentle-ai upgrade ${t.name}`)
    expect(spec.done).toContain(t.name)
  }
  expect(UPGRADE_TIMEOUT_MS).toBe(300_000)
})

test('actionSpec: only the gentle-ai upgrade suggests `gentle-ai sync` afterwards', () => {
  const done = (tool: 'gentle-ai' | 'gga' | 'engram') => actionSpec(`gentle-upgrade-${tool}`, '/r', TOOL_VERSIONS).done
  expect(done('gentle-ai')).toContain('gentle-ai sync')
  expect(done('gga')).not.toContain('sync')
  expect(done('engram')).not.toContain('sync')
})

test('actionSpec: an upgrade with unknown versions still names the tool and the command', () => {
  const spec = actionSpec('gentle-upgrade-engram', '/r')
  expect(spec.question).toContain('engram')
  expect(spec.question).toContain('gentle-ai upgrade engram')
  expect(spec.question).not.toContain('→')
})

test('actionSpec: other actions keep the default action timeout', () => {
  expect(actionSpec('gga-install', '/r').timeoutMs).toBeUndefined()
})

test('gentleGrid: [upgrade] only on the tool rows that have an update', () => {
  const tools = gentleGrid(VIEW).slice(1, 4)
  expect(tools.map(r => (r.kind === 'item' ? r.buttons.map(b => b.key) : []))).toEqual([
    [],
    [],
    ['gentle-upgrade-engram'],
  ])
  // Not installed, or up to date: no button.
  const none = gentleGrid({ ...VIEW, tools: VIEW.tools.map(t => ({ ...t, update: null })) })
  expect(none.some(r => r.kind === 'item' && r.buttons.some(b => b.key.startsWith('gentle-upgrade-')))).toBe(false)
})

// ── Wiring ───────────────────────────────────────────────────────────────

const HOME = '/home/myuser'
const ROOT = `${HOME}/code/demo-proj`

type Run = { argv: readonly string[]; init?: { cwd?: string; env?: Record<string, string>; stdin?: string } }

// The engine's bottom: gentle-ai 4.0.0, engram has an update, the gga hook is
// missing, a project `.gga` names no rules file and AGENTS.md is absent, RDD
// is on from the global setting, openspec sets no strict_tdd.
const ON_GLOBAL = JSON.stringify({ status: { global: 'on', clone_local: '', effective: 'on', source: 'global' } })

// Whether the session runs inside a repository; a test turns it off.
let inRepo = true

// The repo's pre-commit hook text; a test swaps in gga's block to install it.
let preCommit = '#!/bin/sh\ngitleaks protect --staged\n'

// The project's `.gga`; a test names another rules file in it.
const GGA_FILE = 'PROVIDER="claude"\n'
let ggaFile = GGA_FILE

// How a `gga` action command ends: its exit code, or a rejection (it could
// not start, or outlasted its timeout).
let ggaOutcome: number | Error = 0

// `$.session.cwd()` rejects this many times before answering again.
let cwdFailures = 0

// No Homebrew (as on Windows): every brew run rejects.
let brewMissing = false
// What `engram version` prints; null when engram cannot start.
let engramVersion: string | null = null
// What `which gga` / `where gga` print; a missing key cannot start.
let pathLookup: Record<string, string> = {}
// The session's environment; a test drops HOME for USERPROFILE.
let envVars: Record<string, string> = { HOME }
// What `gentle-ai update` prints, or a rejection (offline, timed out); null
// answers an empty stdout, as an old gentle-ai would.
let gentleUpdate: string | Error | null = null
// How a `gentle-ai upgrade` run ends: its exit code, a rejection, or a
// rejection once its timeout has passed; and what it prints.
let upgradeOutcome: number | Error | 'timeout' = 0
let upgradeStdout = UPGRADE_SUCCESS

// Puts every fixture variable back, so the tests stay order-independent.
const resetFixture = () => {
  inRepo = true
  preCommit = '#!/bin/sh\ngitleaks protect --staged\n'
  ggaFile = GGA_FILE
  ggaOutcome = 0
  cwdFailures = 0
  brewMissing = false
  engramVersion = null
  pathLookup = {}
  envVars = { HOME }
  gentleUpdate = null
  upgradeOutcome = 0
  upgradeStdout = UPGRADE_SUCCESS
}

const answerEngine = (
  on: On,
  answer: () => string | Error = () => 'Cancel',
  rddStatus?: (clock: MockClock) => Promise<string>,
) => {
  const runs: Run[] = []
  const fills: { text: string; mode?: string }[] = []
  const toasts: string[] = []
  const exists: string[] = []
  const reads: string[] = []
  const asks: string[] = []
  const clock = mock.clock(on)
  mock.env(on, envVars)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () =>
    ({ value: [{ id: 'hud', title: 'hud', isShown: true, isFocused: false, isPlaced: true }] }) as never,
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.id', () => ({ value: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }) as never)
  on('session.root', () => ({ value: ROOT }) as never)
  on('session.cwd', () => {
    if (cwdFailures > 0) {
      cwdFailures -= 1
      throw new Error('cwd unavailable')
    }
    return { value: ROOT } as never
  })
  on('session.repo', () => ({ value: inRepo ? { root: ROOT, remote: null } : null }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.version', () => ({ value: { version: '2.1.296', base: '2.1.296' } }) as never)
  on('session.usage', () => ({ value: { startedAt: 0 } }) as never)
  on('tool.list', () => ({ value: [] }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('fs.read', (_$, e) => {
    const path = (e as { path: string }).path
    reads.push(path)
    if (path === `${ROOT}/.gga`) return { value: ggaFile } as never
    if (path === `${ROOT}/.git/hooks/pre-commit`) return { value: preCommit } as never
    if (path === `${ROOT}/openspec/config.yaml`) return { value: 'project: demo-proj\n' } as never
    throw new Error('no such file')
  })
  on('fs.exists', (_$, e) => {
    exists.push((e as { path: string }).path)
    return { value: false } as never
  })
  on('process.run', (_$, e) => {
    const run = e as Run
    runs.push(run)
    const argv = run.argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { stdout, stderr: '', exitCode } }) as never
    if (run.argv[0] === 'gga') {
      if (ggaOutcome instanceof Error) throw ggaOutcome
      return out('', ggaOutcome)
    }
    if (argv.startsWith('gentle-ai upgrade')) {
      if (upgradeOutcome instanceof Error) throw upgradeOutcome
      if (upgradeOutcome === 'timeout')
        return clock.sleep(UPGRADE_TIMEOUT_MS).then(() => {
          throw new Error('timed out')
        }) as never
      return out(upgradeStdout, upgradeOutcome)
    }
    if (argv === 'gentle-ai --version') return out('gentle-ai 4.0.0\n')
    if (argv === 'gentle-ai update') {
      if (gentleUpdate instanceof Error) throw gentleUpdate
      return out(gentleUpdate ?? '')
    }
    if (run.argv[0] === 'brew' && brewMissing) throw new Error('brew: command not found')
    if (argv === 'engram version') {
      if (engramVersion === null) throw new Error('engram: command not found')
      return out(engramVersion)
    }
    if (argv === 'which gga' || argv === 'where gga') {
      const found = pathLookup[argv]
      if (found === undefined) throw new Error(`${run.argv[0]}: command not found`)
      return out(found, found ? 0 : 1)
    }
    if (argv.startsWith('brew list')) return out('engram 2.2.1\ngentle-ai 4.0.0\ngga 2.10.1\n')
    if (argv.startsWith('brew outdated'))
      return out(
        JSON.stringify({
          formulae: [{ name: 'example/tap/engram', installed_versions: ['2.2.1'], current_version: '3.3.0' }],
          casks: [],
        }),
        1,
      )
    // As the engine runs git: `core.hooksPath=/dev/null` is forced, so the
    // hooks path git reports is not the repo's; its common dir and its own
    // config file are unaffected (here no core.hooksPath: exit 1).
    if (argv === 'git rev-parse --git-path hooks') return out('/dev/null\n')
    if (argv === 'git rev-parse --git-common-dir') return out('.git\n')
    if (argv === `git config --file ${ROOT}/.git/config --get core.hooksPath`) return out('', 1)
    if (argv.startsWith('gentle-ai review mode status'))
      return rddStatus ? rddStatus(clock).then(s => out(s)) : out(ON_GLOBAL)
    if (argv === 'date +%z') return out('+0000\n')
    return out('')
  })
  // `$.ui.ask` runs the AskUserQuestion tool; its answer is keyed by question.
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const a = answer()
    if (a instanceof Error) throw a
    const q = (e as unknown as { questions: { question: string }[] }).questions[0]?.question ?? ''
    asks.push(q)
    return { result: { questions: [], answers: { [q]: a } } } as never
  })
  on('prompt.fill', (_$, e) => {
    fills.push(e as { text: string; mode?: string })
    return { isFilled: true, text: (e as { text: string }).text, cursor: 0 } as never
  })
  on('ui.toast', (_$, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('prompt.compose', () => ({ sections: [] }) as never)
  return { clock, runs, fills, toasts, exists, reads, asks }
}

const mountPane = ($: Engine) =>
  $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'hud',
    props: { title: 'Agent HUD', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
    viewport: { rows: 80, columns: 60 },
  } as never)

const start = async (
  $: Engine,
  on: On,
  answer?: () => string | Error,
  rddStatus?: (clock: MockClock) => Promise<string>,
) => {
  const engine = answerEngine(on, answer, rddStatus)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
  await engine.clock.settle()
  return engine
}

// The row: the innermost Box whose direct child holds a Text that starts with
// `label` (the label's own Box, or the Text itself).
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const rowOf = (tree: unknown, label: string): Node | null => {
  const hasLabel = (n: unknown): boolean =>
    typeof n === 'object' && n !== null &&
    (((n as Node).type === 'Text' && String((n as Node).children?.[0] ?? '').trimStart().startsWith(label)) ||
      ((n as Node).children ?? []).some(hasLabel))
  const walk = (n: unknown): Node | null => {
    if (typeof n !== 'object' || n === null) return null
    for (const c of (n as Node).children ?? []) {
      const found = walk(c)
      if (found) return found
    }
    const node = n as Node
    const direct = (node.children ?? []).some(
      c => typeof c === 'object' && c !== null && ((c as Node).type === 'Box' || (c as Node).type === 'Text') && hasLabel(c),
    )
    return node.type === 'Box' && direct && (node.children ?? []).length > 1 ? node : null
  }
  return walk(tree)
}
const textOf = (n: unknown): string =>
  typeof n === 'string' || typeof n === 'number'
    ? String(n)
    : typeof n === 'object' && n !== null
      ? ((n as Node).children ?? []).map(textOf).join('')
      : ''
// A grid row's cells as drawn: the label, then what its value cell holds
// (value, detail, buttons).
const cellNodes = (tree: unknown, label: string): unknown[] =>
  (rowOf(tree, label)?.children ?? []).flatMap(c =>
    typeof c === 'object' && c !== null && (c as Node).type === 'Box' && (c as Node).props?.flexWrap === 'wrap'
      ? ((c as Node).children ?? [])
      : [c],
  )
// The same, padding trimmed.
const cellsOf = (tree: unknown, label: string): string[] => cellNodes(tree, label).map(c => textOf(c).trim())
const ITEM_LABELS = ['gentle-ai', 'gga', 'engram', 'hook', 'rules', 'project', 'global', 'strict']
const HEADINGS = ['Tools', 'gga', 'RDD', 'TDD']
const headingsOf = (tree: unknown): string[] => {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (typeof n !== 'object' || n === null) return
    const node = n as Node
    if (node.type === 'Text' && node.props?.bold === true && node.props?.color === 'subtle') out.push(textOf(node).trim())
    for (const c of node.children ?? []) walk(c)
  }
  walk(tree)
  return out.filter(t => HEADINGS.includes(t))
}

test('Gentle AI text buttons draw only their own [label], no Button chrome around it', async ($, on) => {
  await start($, on)
  const tree = JSON.stringify(await (await mountPane($)).drawn())
  for (const key of ['rdd-project-on', 'rdd-global-off', 'gga-install', 'gentle-refresh', 'gentle-upgrade-engram']) {
    expect(tree).toMatch(new RegExp(`"key":"${key}"[^}]*"plain":true`))
  }
})

test('narrow sidebar: RDD scope labels never shrink and sit on their own rows', async ($, on) => {
  await start($, on)
  const tree = await (await mountPane($)).drawn()
  for (const label of ['project', 'global']) {
    const row = rowOf(tree, label)
    expect(row).not.toBeNull()
    expect(row?.props?.flexWrap).toBe('wrap')
    // The label's own Box keeps its width; the buttons wrap below it instead.
    const labelBox = (row?.children ?? []).find(
      c => (c as Node).type === 'Box' && (c as Node).props?.flexShrink === 0,
    )
    expect(labelBox).toBeDefined()
  }
  const project = JSON.stringify(rowOf(tree, 'project'))
  expect(project).not.toContain('rdd-global')
})

test('narrow sidebar: wrapped buttons and summaries stay in the value cell, under the value column', async ($, on) => {
  await start($, on)
  const pane = await mountPane($)
  await pane.redraw({ title: 'Agent HUD', isFocused: false, bodyColumns: 24, placement: 'dock' } as never) // 22 drawable
  const tree = await pane.drawn()
  const project = rowOf(tree, 'project')
  const [labelBox, cell] = (project?.children ?? []) as Node[]
  expect(project?.children?.length).toBe(2)
  expect(textOf(labelBox).length).toBe(11)
  expect(cell?.type).toBe('Box')
  expect(cell?.props).toMatchObject({ flexShrink: 0, flexWrap: 'wrap', columnGap: 1, width: 10 })
  expect(JSON.stringify(cell)).toContain('"key":"rdd-project-off"')
  // The TDD summary sits in the same column, in a cell of its own width.
  const tdd = rowOf(tree, 'TDD')
  expect(textOf((tdd?.children ?? [])[0]).length).toBe(11)
  expect((tdd?.children?.[1] as Node).props).toMatchObject({ width: 10, flexWrap: 'wrap' })
  expect(textOf(tdd?.children?.[1])).toBe('test-first (ODD)')
})

test('each RDD scope row shows its own value and marks it on its buttons; unset is —', async ($, on) => {
  await start($, on) // global on, project unset
  const tree = await (await mountPane($)).drawn()
  const global = JSON.stringify(rowOf(tree, 'global'))
  const project = JSON.stringify(rowOf(tree, 'project'))
  expect(global).toContain('"[● on]"')
  expect(global).toContain('"[off]"')
  expect(project).not.toContain('[●')
  expect(cellsOf(tree, 'project').slice(0, 2)).toEqual(['project', '—'])
  expect(cellsOf(tree, 'global').slice(0, 2)).toEqual(['global', '●'])
})

test('the Gentle AI section is one grid: headings Tools, gga, RDD, TDD and aligned rows', async ($, on) => {
  await start($, on)
  const tree = await (await mountPane($)).drawn()
  expect(JSON.stringify(tree)).toContain('Gentle AI')
  expect(headingsOf(tree)).toEqual(HEADINGS)
  expect(JSON.stringify(tree)).not.toContain('last updated')
  expect(cellsOf(tree, 'gentle-ai')).toEqual(['gentle-ai', '4.0.0', '✓'])
  expect(cellsOf(tree, 'gga')).toEqual(['gga', '2.10.1', '✓'])
  expect(cellsOf(tree, 'engram')).toEqual(['engram', '2.2.1', '↑ 3.3.0', '[upgrade]'])
  expect(cellsOf(tree, 'hook').slice(0, 3)).toEqual(['hook', '✗', '[install]'])
  expect(cellsOf(tree, 'rules')).toEqual(['rules', '✗', 'AGENTS.md', '[create rules]'])
  expect(cellsOf(tree, 'RDD')).toEqual(['RDD', '● on · global'])
  expect(cellsOf(tree, 'TDD')).toEqual(['TDD', 'test-first (ODD)'])
  expect(cellsOf(tree, 'strict')).toEqual(['strict', '—', '[configure]'])
  // Every item's label Box is as wide as the others, and so is every value.
  const widths = (cell: number) =>
    new Set(ITEM_LABELS.map(l => textOf(cellNodes(tree, l)[cell]).length))
  expect(widths(0).size).toBe(1)
  expect(widths(1).size).toBe(1)
  for (const l of ITEM_LABELS) expect((rowOf(tree, l)?.children?.[0] as Node).props?.flexShrink).toBe(0)
})

test('an installed gga hook shows ✓ although the engine forces core.hooksPath', async ($, on) => {
  preCommit = '#!/bin/sh\n# ======== GGA START ========\ngga run\n# ======== GGA END ========\n'
  try {
    await start($, on)
    const tree = await (await mountPane($)).drawn()
    expect(cellsOf(tree, 'hook').slice(0, 2)).toEqual(['hook', '✓'])
  } finally {
    resetFixture()
  }
})

test('detection never runs gga, and brew runs without auto-update', async ($, on) => {
  const { runs } = await start($, on)
  expect(runs.some(r => r.argv[0] === 'gga')).toBe(false)
  const brew = runs.filter(r => r.argv[0] === 'brew')
  expect(brew.length).toBeGreaterThan(0)
  for (const r of brew) expect(r.init?.env?.HOMEBREW_NO_AUTO_UPDATE).toBe('1')
})

test('gga install runs exactly `gga install` with CURL_CMD=false after "Run it"', async ($, on) => {
  const { runs, toasts } = await start($, on, () => 'Run it')
  const pane = await mountPane($)
  await pane.press({ key: 'gga-install' })
  const gga = runs.filter(r => r.argv[0] === 'gga')
  expect(gga.length).toBe(1)
  expect(gga[0]?.argv).toEqual(['gga', 'install'])
  expect(gga[0]?.init?.env?.CURL_CMD).toBe('false')
  expect(gga[0]?.init?.cwd).toBe(ROOT)
  expect(toasts).toContain('gga hook installed')
})

test('gga install runs nothing on Cancel or a dismissed dialog', async ($, on) => {
  let answer: string | Error = 'Cancel'
  const { runs } = await start($, on, () => answer)
  const pane = await mountPane($)
  await pane.press({ key: 'gga-install' })
  answer = new Error('dismissed')
  await pane.press({ key: 'gga-install' })
  expect(runs.some(r => r.argv[0] === 'gga')).toBe(false)
})

test('the project RDD button runs the clone-scoped enable after "Run it"', async ($, on) => {
  const { runs } = await start($, on, () => 'Run it')
  await (await mountPane($)).press({ key: 'rdd-project-on' })
  expect(runs.some(r => r.argv.join(' ') === `gentle-ai review mode enable --scope clone --cwd ${ROOT} --json`)).toBe(
    true,
  )
})

test('outside a repository in privacy mode, the global RDD button runs in the real cwd', async ($, on) => {
  inRepo = false
  try {
    const { runs } = await start($, on, () => 'Run it')
    await $.command.run({ command: 'hud-private', args: '' } as never)
    await (await mountPane($)).press({ key: 'rdd-global-on' })
    const run = runs.find(r => r.argv.join(' ') === 'gentle-ai review mode enable --scope global --json')
    expect(run).toBeDefined()
    expect(run?.init?.cwd).toBe(ROOT)
  } finally {
    resetFixture()
  }
})

test('create rules fills the prompt with the rules request, and sends nothing', async ($, on) => {
  const { fills } = await start($, on)
  await (await mountPane($)).press({ key: 'gga-rules' })
  expect(fills.length).toBe(1)
  expect(fills[0]?.text).toBe(rulesPrompt('AGENTS.md'))
  expect(fills[0]?.mode).toBe('replace')
})

test('in demo mode the section shows sample values and its buttons only say so', async ($, on) => {
  const { runs, fills, toasts } = await start($, on, () => 'Run it')
  await $.command.run({ command: 'hud-demo', args: '' } as never)
  try {
    const pane = await mountPane($)
    const text = JSON.stringify(await pane.drawn())
    expect(text).not.toContain('last updated')
    const before = runs.length
    await pane.press({ key: 'gga-install' })
    await pane.press({ key: 'tdd-configure' })
    await pane.press({ key: 'gentle-refresh' })
    // The demo engram row has an update, so it shows [upgrade]; it runs nothing.
    expect(text).toContain('"key":"gentle-upgrade-engram"')
    await pane.press({ key: 'gentle-upgrade-engram' })
    expect(runs.length).toBe(before)
    expect(fills.length).toBe(0)
    expect(toasts.filter(t => t === 'demo mode').length).toBe(4)
  } finally {
    await $.command.run({ command: 'hud-demo', args: '' } as never) // leave demo mode, even on a failure
  }
})

// Reaching the periodic detection takes 300 real ticks, each one redrawing the
// Pane: about 2 s here, but past the 5 s default on a slow CI runner.
const PERIODIC = { timeoutMs: 20_000 }

test('an action refresh wins over an older periodic detection that finishes later', PERIODIC, async ($, on) => {
  const offClone = JSON.stringify({ status: { global: 'on', clone_local: 'off', effective: 'off', source: 'clone' } })
  let calls = 0
  // 1: session start; 2: the periodic run at tick 301, answering 3 s late
  // with what was true before the action; 3: the refresh after the action.
  const rddStatus = async (clock: MockClock) => {
    calls += 1
    if (calls === 2) {
      await clock.sleep(3000)
      return ON_GLOBAL
    }
    return calls === 1 ? ON_GLOBAL : offClone
  }
  const { clock, runs } = await start($, on, () => 'Run it', rddStatus)
  const pane = await mountPane($)
  await clock.advance(300_000) // tick 301: the periodic detection starts
  expect(calls).toBe(2)

  await pane.press({ key: 'rdd-project-off' })
  await clock.settle()
  expect(runs.some(r => r.argv.join(' ') === `gentle-ai review mode disable --scope clone --cwd ${ROOT} --json`)).toBe(
    true,
  )
  // The action's refresh runs at once instead of joining the older run.
  expect(calls).toBe(3)

  await clock.advance(3000) // the older detection finishes now
  const text = JSON.stringify(await pane.drawn())
  expect(text).toContain('"○ off · project"')
  expect(text).not.toContain('● on · global')
})

// ── Action failure paths ─────────────────────────────────────────────────

const statusRuns = (runs: Run[]) => runs.filter(r => r.argv.join(' ').startsWith('gentle-ai review mode status')).length

test('an action that exits non-zero says so, and detection runs again', async ($, on) => {
  ggaOutcome = 2
  try {
    const { clock, runs, toasts } = await start($, on, () => 'Run it')
    const before = statusRuns(runs)
    await (await mountPane($)).press({ key: 'gga-install' })
    await clock.settle()
    const gga = runs.find(r => r.argv[0] === 'gga')
    expect((gga?.init as { timeoutMs?: number } | undefined)?.timeoutMs).toBe(ACTION_TIMEOUT_MS)
    expect(toasts).toContain('failed (exit 2)')
    expect(toasts).not.toContain('gga hook installed')
    expect(statusRuns(runs)).toBe(before + 1)
  } finally {
    resetFixture()
  }
})

test('an action that cannot run says so, and detection runs again', async ($, on) => {
  ggaOutcome = new Error('timed out')
  try {
    const { clock, runs, toasts } = await start($, on, () => 'Run it')
    const before = statusRuns(runs)
    await (await mountPane($)).press({ key: 'gga-install' })
    await clock.settle()
    expect(runs.some(r => r.argv[0] === 'gga')).toBe(true)
    expect(toasts).toContain('failed (could not run)')
    expect(statusRuns(runs)).toBe(before + 1)
  } finally {
    resetFixture()
  }
})

const upgradeRuns = (runs: Run[]) => runs.filter(r => r.argv.join(' ').startsWith('gentle-ai upgrade'))

test('[upgrade] asks with the versions, then runs `gentle-ai upgrade engram` untracked and with its timeout', async ($, on) => {
  const { clock, runs, toasts, asks: questions } = await start($, on, () => 'Run it')
  const before = statusRuns(runs)
  await (await mountPane($)).press({ key: 'gentle-upgrade-engram' })
  await clock.settle()
  expect(questions.length).toBe(1)
  expect(questions[0]).toContain('engram 2.2.1 → 3.3.0')
  expect(questions[0]).toContain('gentle-ai upgrade engram')
  const ran = upgradeRuns(runs)
  expect(ran.length).toBe(1)
  expect(ran[0]?.argv).toEqual(['gentle-ai', 'upgrade', 'engram'])
  expect(ran[0]?.init?.env?.DO_NOT_TRACK).toBe('1')
  expect((ran[0]?.init as { timeoutMs?: number } | undefined)?.timeoutMs).toBe(UPGRADE_TIMEOUT_MS)
  expect(toasts).toEqual(['upgrading engram…', 'engram upgraded'])
  expect(statusRuns(runs)).toBe(before + 1)
})

test('[upgrade] runs nothing on Cancel or a dismissed dialog', async ($, on) => {
  let answer: string | Error = 'Cancel'
  const { runs } = await start($, on, () => answer)
  const pane = await mountPane($)
  await pane.press({ key: 'gentle-upgrade-engram' })
  answer = new Error('dismissed')
  await pane.press({ key: 'gentle-upgrade-engram' })
  expect(upgradeRuns(runs).length).toBe(0)
})

const failedUpgrade = async ($: Engine, on: On, outcome: number | Error, toast: string) => {
  upgradeOutcome = outcome
  try {
    const { clock, runs, toasts } = await start($, on, () => 'Run it')
    const before = statusRuns(runs)
    await (await mountPane($)).press({ key: 'gentle-upgrade-engram' })
    await clock.settle()
    expect(upgradeRuns(runs).length).toBe(1)
    expect(toasts).toContain(toast)
    expect(toasts.some(t => t.includes('upgraded'))).toBe(false)
    expect(statusRuns(runs)).toBe(before + 1)
  } finally {
    resetFixture()
  }
}

test('an upgrade that exits non-zero says so, and detection runs again', ($, on) =>
  failedUpgrade($, on, 1, 'failed (exit 1)'))

test('an upgrade that cannot run says so, and detection runs again', ($, on) =>
  failedUpgrade($, on, new Error('spawn failed'), 'failed (could not run)'))

test('an upgrade killed at its timeout says it timed out, and detection runs again', PERIODIC, ($, on) =>
  upgradeEnds($, on, 'timeout', '', ['upgrading engram…', 'failed (timed out)'], 'gentle-upgrade-engram'))

// Presses `[upgrade]`, answers "Run it", lets the run end and checks every
// toast in order; detection runs again after it.
const upgradeEnds = async (
  $: Engine,
  on: On,
  outcome: number | 'timeout',
  stdout: string,
  expected: string[],
  key: string,
) => {
  upgradeOutcome = outcome
  upgradeStdout = stdout
  try {
    const { clock, runs, toasts } = await start($, on, () => 'Run it')
    const before = statusRuns(runs)
    await (await mountPane($)).press({ key })
    await clock.settle()
    if (outcome === 'timeout') {
      expect(toasts).toEqual(expected.slice(0, 1))
      await clock.advance(UPGRADE_TIMEOUT_MS)
      await clock.settle()
    }
    expect(upgradeRuns(runs).length).toBe(1)
    expect(toasts).toEqual(expected)
    // Waiting out the timeout also reaches the periodic detection (tick 301).
    expect(statusRuns(runs)).toBe(before + (outcome === 'timeout' ? 2 : 1))
  } finally {
    resetFixture()
  }
}

// gga gets an [upgrade] from `gentle-ai update`'s row.
const GGA_BEHIND = '  [UP] gga           installed: 2.8.1       latest: 2.10.1\n'

test('an upgrade gentle-ai skips (gga on Windows) says why, not that it upgraded', async ($, on) => {
  gentleUpdate = GGA_BEHIND
  upgradeStdout = UPGRADE_WINDOWS
  try {
    const { clock, runs, toasts } = await start($, on, () => 'Run it')
    const before = statusRuns(runs)
    await (await mountPane($)).press({ key: 'gentle-upgrade-gga' })
    await clock.settle()
    expect(upgradeRuns(runs).map(r => r.argv)).toEqual([['gentle-ai', 'upgrade', 'gga']])
    expect(toasts.length).toBe(2)
    expect(toasts[0]).toBe('upgrading gga…')
    expect(toasts[1]?.startsWith('gga not upgraded: manual update required')).toBe(true)
    expect(toasts[1]).toContain(GGA_URL)
    expect(toasts).not.toContain('gga upgraded')
    expect(statusRuns(runs)).toBe(before + 1)
  } finally {
    resetFixture()
  }
})

test('an upgrade whose summary counts one success says it upgraded', async ($, on) => {
  gentleUpdate = GGA_BEHIND
  try {
    const { clock, toasts } = await start($, on, () => 'Run it')
    await (await mountPane($)).press({ key: 'gentle-upgrade-gga' })
    await clock.settle()
    expect(toasts).toEqual(['upgrading gga…', 'gga upgraded'])
  } finally {
    resetFixture()
  }
})

test('an upgrade with no summary and exit 0 claims nothing', ($, on) =>
  upgradeEnds($, on, 0, 'done\n', ['upgrading engram…', 'engram: upgrade finished, check the version'], 'gentle-upgrade-engram'))

test('outside a repository, an unreadable cwd runs nothing and says so', async ($, on) => {
  inRepo = false
  try {
    let asked = 0
    const { clock, runs, toasts } = await start($, on, () => {
      asked += 1
      return 'Run it'
    })
    const pane = await mountPane($)
    cwdFailures = 1 // the next `$.session.cwd()`: the action's own
    await pane.press({ key: 'rdd-global-on' })
    await clock.settle()
    expect(toasts).toContain('failed (could not run)')
    expect(asked).toBe(0)
    expect(runs.some(r => r.argv.join(' ').startsWith('gentle-ai review mode enable'))).toBe(false)
  } finally {
    resetFixture()
  }
})

// ── Detection join deadline ──────────────────────────────────────────────

test('a refresh starts a new detection once a joined one outlasts its deadline', PERIODIC, async ($, on) => {
  const offClone = JSON.stringify({ status: { global: 'on', clone_local: 'off', effective: 'off', source: 'clone' } })
  let calls = 0
  // 1: session start; 2: the periodic run at tick 301, which hangs far past
  // the deadline; 3: the ↻ refresh after the deadline.
  const rddStatus = async (clock: MockClock) => {
    calls += 1
    if (calls === 2) {
      await clock.sleep(3_600_000)
      return ON_GLOBAL
    }
    return calls === 1 ? ON_GLOBAL : offClone
  }
  const { clock } = await start($, on, undefined, rddStatus)
  const pane = await mountPane($)
  await clock.advance(300_000) // tick 301: the periodic detection starts and hangs
  expect(calls).toBe(2)

  // Within the deadline a refresh joins the run under way.
  await pane.press({ key: 'gentle-refresh' })
  await clock.settle()
  expect(calls).toBe(2)

  await clock.advance(GENTLE_JOIN_DEADLINE_MS)
  await pane.press({ key: 'gentle-refresh' })
  await clock.settle()
  expect(calls).toBe(3)
  await clock.advance(1000) // the next tick's rows write redraws the Pane
  expect(JSON.stringify(await pane.drawn())).toContain('"○ off · project"')
})

// ── Rules file ───────────────────────────────────────────────────────────

test('an unsafe RULES_FILE: the row names AGENTS.md, the file actually checked, and says why', async ($, on) => {
  ggaFile = 'PROVIDER="claude"\nRULES_FILE="../../outside.md"\n'
  try {
    const { exists, fills } = await start($, on)
    const pane = await mountPane($)
    const text = JSON.stringify(await pane.drawn())
    expect(exists).toContain(`${ROOT}/AGENTS.md`)
    expect(exists.some(p => p.includes('outside.md'))).toBe(false)
    expect(text).toContain('AGENTS.md')
    expect(text).not.toContain('outside.md')
    expect(text).toContain('RULES_FILE ignored')
    await pane.press({ key: 'gga-rules' })
    expect(fills[0]?.text).toBe(rulesPrompt('AGENTS.md'))
  } finally {
    resetFixture()
  }
})

test('a safe RULES_FILE is the file checked and shown, with no note', async ($, on) => {
  ggaFile = 'RULES_FILE="docs/REVIEW.md"\n'
  try {
    const { exists } = await start($, on)
    const text = JSON.stringify(await (await mountPane($)).drawn())
    expect(exists).toContain(`${ROOT}/docs/REVIEW.md`)
    expect(text).toContain('docs/REVIEW.md')
    expect(text).not.toContain('RULES_FILE ignored')
  } finally {
    resetFixture()
  }
})

// ── Detection without Homebrew ───────────────────────────────────────────

test('without brew, engram shows the version `engram version` prints', async ($, on) => {
  brewMissing = true
  engramVersion = 'engram 3.4.0\n'
  try {
    const { runs } = await start($, on)
    const tree = await (await mountPane($)).drawn()
    expect(cellsOf(tree, 'engram')).toEqual(['engram', '3.4.0', '?'])
    const run = runs.find(r => r.argv.join(' ') === 'engram version')
    expect((run?.init as { timeoutMs?: number } | undefined)?.timeoutMs).toBe(5_000)
  } finally {
    resetFixture()
  }
})

test('without brew, a gga on PATH is installed (never run), not ✗', async ($, on) => {
  brewMissing = true
  pathLookup = { 'which gga': '/home/myuser/.local/bin/gga\n' }
  try {
    const { runs } = await start($, on)
    const tree = await (await mountPane($)).drawn()
    expect(cellsOf(tree, 'gga')).toEqual(['gga', 'installed', '?'])
    expect(headingsOf(tree)).toEqual(HEADINGS)
    expect(runs.some(r => r.argv[0] === 'gga')).toBe(false)
  } finally {
    resetFixture()
  }
})

test('without brew or which, `where gga` finds gga as on Windows', async ($, on) => {
  brewMissing = true
  pathLookup = { 'where gga': 'C:\\Users\\myuser\\bin\\gga\r\n' }
  try {
    await start($, on)
    const tree = await (await mountPane($)).drawn()
    expect(cellsOf(tree, 'gga')).toEqual(['gga', 'installed', '?'])
  } finally {
    resetFixture()
  }
})

test('without brew, tools found nowhere stay ✗', async ($, on) => {
  brewMissing = true
  pathLookup = { 'which gga': '' }
  try {
    await start($, on)
    const tree = await (await mountPane($)).drawn()
    expect(cellsOf(tree, 'gga')).toEqual(['gga', '—', '✗'])
    expect(cellsOf(tree, 'engram')).toEqual(['engram', '—', '✗'])
  } finally {
    resetFixture()
  }
})

test('the global gga config falls back to USERPROFILE when HOME is unset', async ($, on) => {
  envVars = { USERPROFILE: 'C:/Users/myuser' }
  try {
    const { reads } = await start($, on)
    // The engine resolves a non-POSIX path against the cwd on this host.
    expect(reads.some(p => p.endsWith('C:/Users/myuser/.config/gga/config'))).toBe(true)
  } finally {
    resetFixture()
  }
})

// ── Update status from `gentle-ai update` ────────────────────────────────

// The fixture's own versions (brew list, `gentle-ai --version`): gentle-ai
// 4.0.0 has 4.2.0 out, engram 2.2.1 and gga 2.10.1 are current.
const FIXTURE_UPDATE =
  '  ⠋ Checking for updates...\r  ⠙ Checking for updates...\r' +
  'Update Check\n============\n\n' +
  '  \u001b[33m[UP]\u001b[0m gentle-ai     installed: 4.0.0       latest: 4.2.0       brew upgrade --formula gentle-ai\n' +
  '  [ok] engram        installed: 2.2.1       latest: 2.2.1\n' +
  '  [ok] gga           installed: 2.10.1      latest: 2.10.1\n\n1 update(s) available.\n'

test('gentle-ai update decides the update status over a stale brew tap, and brew outdated is skipped', async ($, on) => {
  gentleUpdate = FIXTURE_UPDATE
  try {
    const { runs } = await start($, on)
    const tree = await (await mountPane($)).drawn()
    expect(cellsOf(tree, 'gentle-ai')).toEqual(['gentle-ai', '4.0.0', '↑ 4.2.0', '[upgrade]'])
    // brew's tap would call engram outdated; gentle-ai update says it is current.
    expect(cellsOf(tree, 'engram')).toEqual(['engram', '2.2.1', '✓'])
    expect(cellsOf(tree, 'gga')).toEqual(['gga', '2.10.1', '✓'])
    expect(runs.some(r => r.argv.join(' ').startsWith('brew outdated'))).toBe(false)
  } finally {
    resetFixture()
  }
})

test('without brew, gentle-ai update gives engram and gga their versions and ✓, no ?', async ($, on) => {
  brewMissing = true
  gentleUpdate = UPDATE_TABLE
  try {
    const { runs } = await start($, on)
    const tree = await (await mountPane($)).drawn()
    expect(cellsOf(tree, 'gentle-ai')).toEqual(['gentle-ai', '4.0.0', '↑ 4.2.0', '[upgrade]'])
    expect(cellsOf(tree, 'engram')).toEqual(['engram', '3.4.0', '✓'])
    expect(cellsOf(tree, 'gga')).toEqual(['gga', '2.10.1', '✓'])
    expect(runs.some(r => r.argv[0] === 'gga')).toBe(false)
  } finally {
    resetFixture()
  }
})

test('when gentle-ai update fails, brew outdated decides as before', async ($, on) => {
  gentleUpdate = new Error('network unreachable')
  try {
    const { runs } = await start($, on)
    const tree = await (await mountPane($)).drawn()
    expect(cellsOf(tree, 'gentle-ai')).toEqual(['gentle-ai', '4.0.0', '✓'])
    expect(cellsOf(tree, 'engram')).toEqual(['engram', '2.2.1', '↑ 3.3.0', '[upgrade]'])
    expect(runs.some(r => r.argv.join(' ').startsWith('brew outdated'))).toBe(true)
  } finally {
    resetFixture()
  }
})

test('gentle-ai update runs with DO_NOT_TRACK=1 and its own timeout', async ($, on) => {
  gentleUpdate = FIXTURE_UPDATE
  try {
    const { runs } = await start($, on)
    const run = runs.find(r => r.argv.join(' ') === 'gentle-ai update')
    expect(run?.argv).toEqual(['gentle-ai', 'update'])
    expect(run?.init?.env?.DO_NOT_TRACK).toBe('1')
    expect((run?.init as { timeoutMs?: number } | undefined)?.timeoutMs).toBe(UPDATE_TIMEOUT_MS)
  } finally {
    resetFixture()
  }
})

test('the join deadline outlasts the slowest detection: every probe at its timeout', () => {
  // brew list, brew outdated and gentle-ai update; seven other commands.
  const worst = 2 * BREW_TIMEOUT_MS + UPDATE_TIMEOUT_MS + 7 * CMD_TIMEOUT_MS
  expect(GENTLE_JOIN_DEADLINE_MS).toBeGreaterThan(worst)
})
