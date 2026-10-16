import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  CLAUDE_UPDATE_EVERY_TICKS,
  CLAUDE_UPDATE_TIMEOUT_MS,
  CLAUDE_UPDATE_RUN_TIMEOUT_MS,
  CLAUDE_UPDATE_URL,
  channelFrom,
  claudeUpdateOnDisk,
  claudeUpdateQuestion,
  claudeUpdateToast,
  newerVersion,
  parseDistTags,
} from './claude-update'

test('the check asks the npm registry for the dist-tags, hourly, with a timeout', () => {
  expect(CLAUDE_UPDATE_URL).toBe('https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags')
  expect(CLAUDE_UPDATE_EVERY_TICKS).toBe(3600)
  expect(CLAUDE_UPDATE_TIMEOUT_MS).toBe(10_000)
})

test('parseDistTags keeps latest and stable when they are x.y.z versions', () => {
  expect(parseDistTags('{"stable":"2.1.292","latest":"2.1.301","next":"2.1.301"}')).toEqual({
    latest: '2.1.301',
    stable: '2.1.292',
  })
  expect(parseDistTags('{"latest":"2.1.301"}')).toEqual({ latest: '2.1.301' })
})

test('parseDistTags drops anything that is not an x.y.z version', () => {
  expect(parseDistTags('{"latest":"2.1.301-beta.1","stable":"2.1.292"}')).toEqual({ stable: '2.1.292' })
})

test('parseDistTags is null when no tag is a usable x.y.z version', () => {
  expect(parseDistTags('{}')).toBeNull()
  expect(parseDistTags('{"latest":"2.1.301-beta.1","stable":3}')).toBeNull()
  expect(parseDistTags('{"latest":"\\u001b[31m2.1.301"}')).toBeNull()
  expect(parseDistTags('{"latest":"v2.1.301"}')).toBeNull()
})

test('parseDistTags is null for text that is not a JSON object', () => {
  expect(parseDistTags('')).toBeNull()
  expect(parseDistTags('<html>rate limited</html>')).toBeNull()
  expect(parseDistTags('null')).toBeNull()
  expect(parseDistTags('["2.1.301"]')).toBeNull()
  expect(parseDistTags('"2.1.301"')).toBeNull()
})

test('channelFrom: the first settings file that sets autoUpdatesChannel wins', () => {
  expect(channelFrom('{"autoUpdatesChannel":"stable"}', '{"autoUpdatesChannel":"latest"}')).toBe('stable')
  expect(channelFrom(null, '{"theme":"dark"}', '{"autoUpdatesChannel":"stable"}')).toBe('stable')
  expect(channelFrom(undefined, 'not json', '{"autoUpdatesChannel":"stable"}')).toBe('stable')
  expect(channelFrom('{"autoUpdatesChannel":"latest"}', '{"autoUpdatesChannel":"stable"}')).toBe('latest')
})

test('channelFrom: missing or unknown means latest', () => {
  expect(channelFrom()).toBe('latest')
  expect(channelFrom(null, undefined, '')).toBe('latest')
  expect(channelFrom('{"autoUpdatesChannel":"nightly"}')).toBe('latest')
  expect(channelFrom('{"autoUpdatesChannel":3}', '{"autoUpdatesChannel":"stable"}')).toBe('stable')
  expect(channelFrom('[]', 'null')).toBe('latest')
})

test('newerVersion: the candidate when its x.y.z is strictly greater, compared as numbers', () => {
  expect(newerVersion('2.1.296', '2.1.301')).toBe('2.1.301')
  expect(newerVersion('2.1.296', '2.1.1000')).toBe('2.1.1000')
  expect(newerVersion('2.1.296', '2.2.0')).toBe('2.2.0')
  expect(newerVersion('2.1.296', '3.0.0')).toBe('3.0.0')
  expect(newerVersion('2.1.301', '2.1.301')).toBeNull()
  expect(newerVersion('2.1.301', '2.1.292')).toBeNull()
  expect(newerVersion('2.2.0', '2.1.999')).toBeNull()
})

test('newerVersion reads a prerelease or decorated running version by its core', () => {
  expect(newerVersion('2.1.296-dev.20260920.t101500.sha1a2b3c4', '2.1.301')).toBe('2.1.301')
  expect(newerVersion('2.1.301-dev', '2.1.301')).toBeNull()
  expect(newerVersion('v2.1.296 (Claude Code)', '2.1.301')).toBe('2.1.301')
})

test('newerVersion is null when either side is unknown or unreadable', () => {
  expect(newerVersion(null, '2.1.301')).toBeNull()
  expect(newerVersion('2.1.296', undefined)).toBeNull()
  expect(newerVersion('garbage', '2.1.301')).toBeNull()
  expect(newerVersion('2.1.296', '2.1')).toBeNull()
  expect(newerVersion('2.1.296', '2.1.301-beta')).toBeNull()
})

// ── `claude update` from the footer: its outcome ─────────────────────────

// A no-op run on a machine with two installs (captured 2026-10-16).
const UP_TO_DATE_TWO_INSTALLS = `Current version: 2.1.301
Checking for updates to latest version...

Warning: Multiple installations found
- npm-global at /home/myuser/.npm-global/bin/claude
- native at /home/myuser/.local/bin/claude (currently running)

Warning: Running native installation but config install method is 'global'
Fix: Run claude install to update configuration

Claude Code is up to date (2.1.301)
`
const UPDATED = `Current version: 2.1.296
Checking for updates to latest version...
Successfully updated from 2.1.296 to version 2.1.301
`
const MULTIPLE = 'multiple installations found, see claude doctor'

test('the update runs for up to five minutes and asks naming both versions and the command', () => {
  expect(CLAUDE_UPDATE_RUN_TIMEOUT_MS).toBe(300_000)
  const q = claudeUpdateQuestion('2.1.296', '2.1.301')
  expect(q).toContain('2.1.296 → 2.1.301')
  expect(q).toContain('`claude update`')
  expect(q).toContain('keeps 2.1.296 until you restart it')
})

test('claudeUpdateToast: an update names the new version and the restart', () => {
  expect(claudeUpdateToast(0, UPDATED, '2.1.296')).toBe(
    'Claude Code updated to 2.1.301 — restart it (/exit, then claude --resume)',
  )
  expect(claudeUpdateToast(0, 'Claude Code has been updated to v2.1.301.', '2.1.296')).toBe(
    'Claude Code updated to 2.1.301 — restart it (/exit, then claude --resume)',
  )
  expect(claudeUpdateToast(0, 'SUCCESSFULLY UPDATED: 2.1.301', '2.1.296')).toBe(
    'Claude Code updated to 2.1.301 — restart it (/exit, then claude --resume)',
  )
})

test('claudeUpdateToast: the multiple installations warning adds a hint', () => {
  const both = `Warning: Multiple installations found\n${UPDATED}`
  expect(claudeUpdateToast(0, both, '2.1.296')).toBe(
    `Claude Code updated to 2.1.301 — restart it (/exit, then claude --resume) — ${MULTIPLE}`,
  )
  expect(claudeUpdateToast(0, UP_TO_DATE_TWO_INSTALLS, '2.1.301')).toBe(
    `claude update found nothing newer (2.1.301) — ${MULTIPLE}`,
  )
})

test('claudeUpdateToast: up to date with a newer version than the session runs means restart', () => {
  expect(claudeUpdateToast(0, UP_TO_DATE_TWO_INSTALLS, '2.1.296')).toBe(
    `Claude Code 2.1.301 is already installed — restart to use it (this session runs 2.1.296) — ${MULTIPLE}`,
  )
  expect(claudeUpdateToast(0, 'Claude Code is up to date (2.1.301)', '2.1.296')).toBe(
    'Claude Code 2.1.301 is already installed — restart to use it (this session runs 2.1.296)',
  )
})

test('claudeUpdateToast: up to date with nothing newer says so', () => {
  expect(claudeUpdateToast(0, 'Claude Code is up to date (2.1.296)', '2.1.296')).toBe(
    'claude update found nothing newer (2.1.296)',
  )
})

test('claudeUpdateToast: a non-zero exit is a failure naming its last line', () => {
  expect(claudeUpdateToast(1, 'Checking...\nError: EACCES permission denied\n\n', '2.1.296')).toBe(
    'failed (Error: EACCES permission denied)',
  )
  expect(claudeUpdateToast(2, '  \n', '2.1.296')).toBe('failed (exit 2)')
  expect(claudeUpdateToast(1, '\u001b[31mError: no network\u001b[0m', '2.1.296')).toBe(
    'failed (Error: no network)',
  )
  expect(claudeUpdateToast(1, UPDATED, '2.1.296')).toBe('failed (Successfully updated from 2.1.296 to version 2.1.301)')
  const long = claudeUpdateToast(1, `Error: ${'x'.repeat(200)}`, '2.1.296')
  expect(long.length).toBeLessThanOrEqual(100)
  expect(long.endsWith('…)')).toBe(true)
})

test('claudeUpdateToast: an exit 0 it cannot read claims nothing', () => {
  expect(claudeUpdateToast(0, '', '2.1.296')).toBe('claude update finished — restart and check the version')
  expect(claudeUpdateToast(0, 'Checking for updates to latest version...', '2.1.296')).toBe(
    'claude update finished — restart and check the version',
  )
})

test('claudeUpdateOnDisk: the version a restart would run, only when it is on disk', () => {
  expect(claudeUpdateOnDisk(0, UPDATED, '2.1.296')).toBe('2.1.301')
  expect(claudeUpdateOnDisk(0, UP_TO_DATE_TWO_INSTALLS, '2.1.296')).toBe('2.1.301')
  expect(claudeUpdateOnDisk(0, UP_TO_DATE_TWO_INSTALLS, '2.1.301')).toBeNull()
  expect(claudeUpdateOnDisk(1, UPDATED, '2.1.296')).toBeNull()
  expect(claudeUpdateOnDisk(0, '', '2.1.296')).toBeNull()
})

// ── Wiring: the check at session start and its footer mark ───────────────

const HOME = '/home/myuser'
const CWD = `${HOME}/code/update-proj`
const DIST_TAGS = '{"stable":"2.1.292","latest":"2.1.301","next":"2.1.301"}'

type Fetch = { url: string }
type Answer = { status: number; text: string } | 'reject' | { lateMs: number; text?: string }

// The engine's bottom for the poller and the Pane: Claude Code 2.1.296, the
// registry answering `answer`, and settings files from `files` (path → text).
const answerEngine = (
  on: On,
  opts: {
    answer?: Answer
    answers?: Answer[]
    env?: Record<string, string>
    files?: Record<string, string>
    /** What `claude update` answers; a rejection when 'reject'. */
    update?: { stdout: string; stderr?: string; exitCode?: number; lateMs?: number } | 'timeout'
    /** The AskUserQuestion answer; an Error is a dismissed dialog. */
    ask?: string | Error
  } = {},
) => {
  const fetches: Fetch[] = []
  const runs: { argv: string[]; timeoutMs?: number }[] = []
  const asks: { question: string; header?: string; options: string[] }[] = []
  const toasts: string[] = []
  const clock = mock.clock(on)
  mock.env(on, { HOME, ...opts.env })
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () =>
    ({ value: [{ id: 'hud', title: 'hud', isShown: true, isFocused: false, isPlaced: true }] }) as never,
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.id', () => ({ value: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }) as never)
  on('session.root', () => ({ value: CWD }) as never)
  on('session.cwd', () => ({ value: CWD }) as never)
  on('session.repo', () => ({ value: null }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.version', () => ({ value: { version: '2.1.296', base: '2.1.296' } }) as never)
  on('session.usage', () => ({ value: { startedAt: 0 } }) as never)
  on('tool.list', () => ({ value: [] }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('fs.read', (_$, e) => {
    const text = opts.files?.[(e as { path: string }).path]
    if (text === undefined) throw new Error('no such file')
    return { value: text } as never
  })
  on('fs.exists', () => ({ value: false }) as never)
  on('process.run', async (_$, e) => {
    const run = e as { argv: string[]; init?: { timeoutMs?: number } }
    if (run.argv[0] !== 'claude') return { value: { stdout: '+0000\n', stderr: '', exitCode: 0 } } as never
    runs.push({ argv: run.argv, timeoutMs: run.init?.timeoutMs })
    const u = opts.update ?? { stdout: '' }
    if (u === 'timeout') {
      await clock.sleep(run.init?.timeoutMs ?? 0)
      throw new Error('timed out')
    }
    if (u.lateMs) await clock.sleep(u.lateMs)
    return { value: { stdout: u.stdout, stderr: u.stderr ?? '', exitCode: u.exitCode ?? 0 } } as never
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const a = opts.ask ?? 'Run it'
    if (a instanceof Error) throw a
    const q = (e as unknown as { questions: { question: string; header?: string; options: { label: string }[] }[] })
      .questions[0]
    asks.push({ question: q?.question ?? '', header: q?.header, options: (q?.options ?? []).map(o => o.label) })
    return { result: { questions: [], answers: { [q?.question ?? '']: a } } } as never
  })
  on('ui.toast', (_$, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('http.fetch', async (_$, e) => {
    fetches.push({ url: (e as Fetch).url })
    const answer = opts.answers?.[fetches.length - 1] ?? opts.answer ?? { status: 200, text: DIST_TAGS }
    if (answer === 'reject') throw new Error('network down')
    if ('lateMs' in answer) {
      await clock.sleep(answer.lateMs)
      return { value: { status: 200, ok: true, headers: {}, text: answer.text ?? DIST_TAGS } } as never
    }
    const ok = answer.status >= 200 && answer.status < 300
    return { value: { status: answer.status, ok, headers: {}, text: answer.text } } as never
  })
  return { clock, fetches, runs, asks, toasts }
}

const mountPane = ($: Engine) =>
  $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'hud',
    props: { title: 'Agent HUD', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })

const footerText = async ($: Engine) => {
  const pane = await $.ui.mount({
    plugin: 'agent-hud',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'hud',
    props: { title: 'Agent HUD', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })
  return JSON.stringify(await pane.drawn())
}

const start = ($: Engine) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)

test('a newer release on the latest channel shows ↑ and its version in the footer', async ($, on) => {
  const { clock, fetches } = answerEngine(on)
  await start($)
  await clock.settle()
  expect(fetches.map(f => f.url)).toEqual([CLAUDE_UPDATE_URL])
  const text = await footerText($)
  expect(text).toContain('2.1.296')
  expect(text).toContain(' ↑ 2.1.301')
})

test('on the stable channel, a stable release no newer than the running one shows no ↑', async ($, on) => {
  const { clock } = answerEngine(on, {
    files: { [`${HOME}/.claude/settings.json`]: '{"autoUpdatesChannel":"stable"}' },
  })
  await start($)
  await clock.settle()
  const text = await footerText($)
  expect(text).toContain('2.1.296')
  expect(text).not.toContain('↑')
})

test('a project setting wins over the user one for the channel', async ($, on) => {
  const { clock } = answerEngine(on, {
    files: {
      [`${CWD}/.claude/settings.local.json`]: '{"autoUpdatesChannel":"latest"}',
      [`${HOME}/.claude/settings.json`]: '{"autoUpdatesChannel":"stable"}',
    },
  })
  await start($)
  await clock.settle()
  expect(await footerText($)).toContain(' ↑ 2.1.301')
})

for (const [name, answer] of [
  ['a rejected fetch', 'reject'],
  ['a non-2xx answer', { status: 503, text: DIST_TAGS }],
  ['an answer that is not JSON', { status: 200, text: '<html>busy</html>' }],
] as const) {
  test(`${name} shows no ↑ and leaves the footer as it was`, async ($, on) => {
    const { clock } = answerEngine(on, { answer })
    await start($)
    await clock.settle()
    const text = await footerText($)
    expect(text).toContain('2.1.296')
    expect(text).not.toContain('↑')
  })
}

test('a check that ends after a newer one does not overwrite its answer', async ($, on) => {
  const { clock, fetches } = answerEngine(on, {
    answers: [{ lateMs: 5000, text: '{"latest":"2.1.301"}' }, { status: 200, text: '{"latest":"2.1.310"}' }],
  })
  await start($)
  await start($)
  await clock.advance(6000)
  expect(fetches.length).toBe(2)
  const text = await footerText($)
  expect(text).toContain(' ↑ 2.1.310')
  expect(text).not.toContain('2.1.301')
})

test('an answer with no usable tag for the channel keeps the last known update', { timeoutMs: 60_000 }, async ($, on) => {
  const { clock } = answerEngine(on, {
    answers: [{ status: 200, text: DIST_TAGS }, { status: 200, text: '{"stable":"2.1.292"}' }],
  })
  await start($)
  await clock.settle()
  const pane = await mountPane($)
  expect(JSON.stringify(await pane.drawn())).toContain(' ↑ 2.1.301')
  await clock.advance(CLAUDE_UPDATE_EVERY_TICKS * 1000)
  expect(JSON.stringify(await pane.drawn())).toContain(' ↑ 2.1.301')
})

test('an answer that comes after the timeout is ignored', async ($, on) => {
  const { clock } = answerEngine(on, { answer: { lateMs: CLAUDE_UPDATE_TIMEOUT_MS + 5000 } })
  await start($)
  await clock.advance(CLAUDE_UPDATE_TIMEOUT_MS + 10_000)
  const text = await footerText($)
  expect(text).toContain('2.1.296')
  expect(text).not.toContain('↑')
})

test('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC skips the check: no request at all', async ($, on) => {
  const { clock, fetches } = answerEngine(on, { env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } })
  await start($)
  await clock.settle()
  expect(fetches).toEqual([])
  expect(await footerText($)).not.toContain('↑')
})

// An hour of ticks: slow under the kit, so it gets a longer budget.
test('the check runs again only once the interval has passed', { timeoutMs: 60_000 }, async ($, on) => {
  const { clock, fetches } = answerEngine(on)
  await start($)
  await clock.settle()
  expect(fetches.length).toBe(1)
  await clock.advance((CLAUDE_UPDATE_EVERY_TICKS - 2) * 1000)
  expect(fetches.length).toBe(1)
  await clock.advance(2000)
  expect(fetches.length).toBe(2)
})

// ── Wiring: the footer's [update] button ─────────────────────────────────

const UPDATE_KEY = '"key":"claude-update"'

test('the footer draws [update] only beside a newer release', async ($, on) => {
  const { clock } = answerEngine(on)
  await start($)
  await clock.settle()
  const text = await footerText($)
  expect(text).toContain(UPDATE_KEY)
  expect(text).toContain('[update]')
})

test('no newer release, no [update]', async ($, on) => {
  const { clock } = answerEngine(on, { answer: { status: 200, text: '{"latest":"2.1.296"}' } })
  await start($)
  await clock.settle()
  const text = await footerText($)
  expect(text).toContain('2.1.296')
  expect(text).not.toContain(UPDATE_KEY)
})

for (const [name, stdout, onDisk] of [
  ['an update', UPDATED, '2.1.301'],
  ['an up to date answer newer than the session', UP_TO_DATE_TWO_INSTALLS, '2.1.301'],
] as const) {
  test(`[update] asks, runs claude update and toasts the outcome: ${name}`, async ($, on) => {
    const { clock, runs, asks, toasts } = answerEngine(on, { update: { stdout } })
    await start($)
    await clock.settle()
    const pane = await mountPane($)
    await pane.drawn()
    await pane.press({ key: 'claude-update' })
    await clock.settle()
    expect(asks.length).toBe(1)
    expect(asks[0]!.header).toBe('Claude Code')
    expect(asks[0]!.options).toEqual(['Run it', 'Cancel'])
    expect(asks[0]!.question).toBe(claudeUpdateQuestion('2.1.296', '2.1.301'))
    expect(runs).toEqual([{ argv: ['claude', 'update'], timeoutMs: CLAUDE_UPDATE_RUN_TIMEOUT_MS }])
    expect(toasts.slice(-2)).toEqual(['updating Claude Code…', claudeUpdateToast(0, stdout, '2.1.296')])
    // A newer version is on disk now: the footer says restart, no button.
    await clock.advance(1000)
    const text = JSON.stringify(await pane.drawn())
    expect(text).toContain(` ↑ ${onDisk} restart`)
    expect(text).not.toContain(UPDATE_KEY)
  })
}

test('a session start drops the restart hint', async ($, on) => {
  const { clock } = answerEngine(on, { update: { stdout: UPDATED } })
  await start($)
  await clock.settle()
  const pane = await mountPane($)
  await pane.drawn()
  await pane.press({ key: 'claude-update' })
  await clock.settle()
  await start($)
  await clock.advance(1000)
  const text = JSON.stringify(await pane.drawn())
  expect(text).not.toContain('restart')
  expect(text).toContain(UPDATE_KEY)
})

test('an update that finds nothing newer keeps the button', async ($, on) => {
  const { clock, toasts } = answerEngine(on, { update: { stdout: 'Claude Code is up to date (2.1.296)' } })
  await start($)
  await clock.settle()
  const pane = await mountPane($)
  await pane.drawn()
  await pane.press({ key: 'claude-update' })
  await clock.advance(1000)
  expect(toasts.at(-1)).toBe('claude update found nothing newer (2.1.296)')
  const text = JSON.stringify(await pane.drawn())
  expect(text).toContain(UPDATE_KEY)
  expect(text).not.toContain('restart')
})

test('a rejected run at the timeout is failed (timed out)', async ($, on) => {
  const { clock, toasts } = answerEngine(on, { update: 'timeout' })
  await start($)
  await clock.settle()
  const pane = await mountPane($)
  await pane.drawn()
  void pane.press({ key: 'claude-update' })
  await clock.advance(CLAUDE_UPDATE_RUN_TIMEOUT_MS + 1000)
  expect(toasts.at(-1)).toBe('failed (timed out)')
})

test('a press while an update runs asks nothing and runs nothing; once it ends a press works again', async ($, on) => {
  const { clock, runs, asks, toasts } = answerEngine(on, {
    update: { stdout: 'Claude Code is up to date (2.1.296)', lateMs: 10_000 },
  })
  await start($)
  await clock.settle()
  const pane = await mountPane($)
  await pane.drawn()
  await pane.press({ key: 'claude-update' })
  await clock.settle()
  expect(runs.length).toBe(1)
  expect(toasts.at(-1)).toBe('updating Claude Code…')
  await pane.press({ key: 'claude-update' })
  await clock.settle()
  expect(asks.length).toBe(1)
  expect(runs.length).toBe(1)
  expect(toasts.at(-1)).toBe('Claude Code update already running')
  await clock.advance(11_000)
  expect(toasts).toContain('claude update found nothing newer (2.1.296)')
  await pane.drawn()
  await pane.press({ key: 'claude-update' })
  await clock.settle()
  expect(asks.length).toBe(2)
  expect(runs.length).toBe(2)
  await clock.advance(11_000) // lets the second run end inside the test
})

test('a session start while an update runs keeps it the only run', async ($, on) => {
  const { clock, runs, toasts } = answerEngine(on, {
    update: { stdout: 'Claude Code is up to date (2.1.296)', lateMs: 10_000 },
  })
  await start($)
  await clock.settle()
  const pane = await mountPane($)
  await pane.drawn()
  await pane.press({ key: 'claude-update' })
  await clock.settle()
  expect(runs.length).toBe(1)
  await start($) // e.g. /clear: the first run is still under way
  await clock.settle()
  await pane.drawn()
  await pane.press({ key: 'claude-update' })
  await clock.settle()
  expect(runs.length).toBe(1)
  expect(toasts.at(-1)).toBe('Claude Code update already running')
  await clock.advance(11_000) // lets the run end inside the test
})

for (const [name, ask] of [
  ['Cancel', 'Cancel'],
  ['a dismissed dialog', new Error('dismissed')],
] as const) {
  test(`${name} runs nothing`, async ($, on) => {
    const { clock, runs, toasts } = answerEngine(on, { update: { stdout: UPDATED }, ask })
    await start($)
    await clock.settle()
    const pane = await mountPane($)
    await pane.drawn()
    await pane.press({ key: 'claude-update' })
    await clock.settle()
    expect(runs).toEqual([])
    expect(toasts).not.toContain('updating Claude Code…')
  })
}

test('in demo mode [update] only toasts', async ($, on) => {
  const { clock, runs, asks, toasts } = answerEngine(on, {
    answer: { status: 200, text: '{"latest":"2.1.296"}' },
    update: { stdout: UPDATED },
  })
  await start($)
  await clock.settle()
  await $.command.run({ command: 'hud-demo', args: '' } as never)
  await clock.advance(1000)
  const pane = await mountPane($)
  expect(JSON.stringify(await pane.drawn())).toContain(UPDATE_KEY)
  await pane.press({ key: 'claude-update' })
  await clock.settle()
  expect(asks).toEqual([])
  expect(runs).toEqual([])
  expect(toasts.at(-1)).toBe('demo mode')
})
