import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  CLAUDE_UPDATE_EVERY_TICKS,
  CLAUDE_UPDATE_TIMEOUT_MS,
  CLAUDE_UPDATE_URL,
  channelFrom,
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
  expect(parseDistTags('{"latest":"2.1.301-beta.1","stable":3}')).toEqual({})
  expect(parseDistTags('{"latest":"\\u001b[31m2.1.301"}')).toEqual({})
  expect(parseDistTags('{"latest":"v2.1.301"}')).toEqual({})
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

// ── Wiring: the check at session start and its footer mark ───────────────

const HOME = '/home/myuser'
const CWD = `${HOME}/code/update-proj`
const DIST_TAGS = '{"stable":"2.1.292","latest":"2.1.301","next":"2.1.301"}'

type Fetch = { url: string }
type Answer = { status: number; text: string } | 'reject' | { lateMs: number }

// The engine's bottom for the poller and the Pane: Claude Code 2.1.296, the
// registry answering `answer`, and settings files from `files` (path → text).
const answerEngine = (
  on: On,
  opts: { answer?: Answer; env?: Record<string, string>; files?: Record<string, string> } = {},
) => {
  const fetches: Fetch[] = []
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
  on('process.run', () => ({ value: { stdout: '+0000\n', stderr: '', exitCode: 0 } }) as never)
  on('http.fetch', async (_$, e) => {
    fetches.push({ url: (e as Fetch).url })
    const answer = opts.answer ?? { status: 200, text: DIST_TAGS }
    if (answer === 'reject') throw new Error('network down')
    if ('lateMs' in answer) {
      await clock.sleep(answer.lateMs)
      return { value: { status: 200, ok: true, headers: {}, text: DIST_TAGS } } as never
    }
    const ok = answer.status >= 200 && answer.status < 300
    return { value: { status: answer.status, ok, headers: {}, text: answer.text } } as never
  })
  return { clock, fetches }
}

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
