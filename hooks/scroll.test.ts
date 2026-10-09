import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { FOOTER_ROWS, HEADER_ROWS } from './layout'
import { projectName } from './register'

// The sticky header and footer: the Pane is drawn at exactly its body's
// height, the sections scroll inside a clipped viewport by the plugin's own
// offset (moved by `ui.scroll`), and the header and footer stay put.

const HOME = '/home/myuser'
const REPO = `${HOME}/code/mono-repo`
const CWD = `${REPO}/pkg/web`
let repoRoot: string | null = REPO

const answerEngine = (on: On) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME })
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () =>
    ({ value: [{ id: 'hud', title: 'hud', isShown: true, isFocused: false, isPlaced: true }] }) as never,
  )
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.id', () => ({ value: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }) as never)
  on('session.root', () => ({ value: CWD }) as never)
  on('session.cwd', () => ({ value: CWD }) as never)
  on('session.repo', () => ({ value: repoRoot ? { root: repoRoot, remote: null } : null }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.version', () => ({ value: { version: '2.1.296', base: '2.1.296' } }) as never)
  on('session.usage', () => ({ value: { startedAt: 0 } }) as never)
  on('tool.list', () => ({ value: [] }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('fs.read', () => {
    throw new Error('no such file')
  })
  on('fs.exists', () => ({ value: false }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }) as never)
  on('process.run', () => ({ value: { stdout: '+0000\n', stderr: '', exitCode: 0 } }) as never)
  // The engine's own move, beneath the plugin's observer: the window moved.
  on('ui.scroll', () => ({}) as never)
  return clock
}

const paneProps = (bodyRows: number, placement = 'dock') =>
  ({ title: 'Agent HUD', isFocused: false, bodyColumns: 60, placement, scroll: { offset: 0, bodyRows } }) as never

const start = async ($: Engine, on: On, demo: boolean) => {
  const clock = answerEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  if (demo) {
    await $.command.run({ command: 'hud-demo', args: '' } as never)
    await clock.advance(6000)
  }
  return clock
}

const mount = ($: Engine, bodyRows: number, placement = 'dock') =>
  $.ui.mount({ plugin: 'agent-hud', surface: 'terminal', component: 'Pane', requestId: 'hud', props: paneProps(bodyRows, placement) })

// A person's wheel or scroll key over the Pane, as the engine raises it.
const scroll = ($: Engine, by: number, bodyRows: number) =>
  $.ui.scroll({ component: 'Pane', requestId: 'hud', offset: 0, by, bodyRows, contentRows: bodyRows, origin: { kind: 'person' } } as never)

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const isNode = (n: unknown): n is Node => typeof n === 'object' && n !== null
const textOf = (n: unknown): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n) : isNode(n) ? (n.children ?? []).map(textOf).join('') : ''
const elements = (n: Node): Node[] => (n.children ?? []).filter(isNode)
const all = (n: unknown, type: string, out: Node[] = []): Node[] => {
  if (!isNode(n)) return out
  if (n.type === type) out.push(n)
  for (const c of n.children ?? []) all(c, type, out)
  return out
}

// The drawn root and its three parts: header, clipped viewport, footer.
const parts = async (pane: { drawn: () => Promise<unknown> }) => {
  const root = (await pane.drawn()) as Node
  const [header, viewport, footer] = elements(root)
  const content = elements(viewport as Node)[0]
  return { root, header: header as Node, viewport: viewport as Node, content: content as Node, footer: footer as Node }
}

const leaveDemo = ($: Engine) => $.command.run({ command: 'hud-demo', args: '' } as never)

test('projectName: the last path segment', () => {
  expect(projectName('/home/myuser/code/mono-repo')).toBe('mono-repo')
  expect(projectName('/home/myuser/code/mono-repo/')).toBe('mono-repo')
  expect(projectName('/')).toBe('/')
  expect(projectName('~/…')).toBe('…')
})

test('the Pane is drawn at its body height: header, clipped viewport, footer', async ($, on) => {
  await start($, on, true)
  try {
    const p = await parts(await mount($, 24))
    expect(p.root.props?.height).toBe(24)
    expect(elements(p.root).length).toBe(3)
    expect(p.viewport.props?.overflow).toBe('hidden')
    expect(p.viewport.props?.height).toBe(24 - HEADER_ROWS - FOOTER_ROWS)
    expect(p.content.props?.marginTop).toBe(0)
    // The header names the project and keeps the hide button.
    expect(textOf(p.header)).toContain('api')
    expect(all(p.header, 'Button').length).toBe(1)
    expect(textOf(p.viewport)).not.toContain('📂')
    // The footer is last and holds the version.
    expect(textOf(p.footer)).toContain('2.1.296')
    expect(textOf(p.viewport)).not.toContain('2.1.296')
  } finally {
    await leaveDemo($)
  }
})

test('a scroll moves the content behind the sticky header and footer, clamped to the end', async ($, on) => {
  await start($, on, true)
  try {
    const pane = await mount($, 24)
    await scroll($, 3, 24)
    expect((await parts(pane)).content.props?.marginTop).toBe(-3)

    // Far past the end: the last offset leaves the bottom margin.
    await scroll($, 10_000, 24)
    const end = Number((await parts(pane)).content.props?.marginTop)
    expect(end).toBeLessThan(-3)
    await scroll($, 5, 24)
    expect((await parts(pane)).content.props?.marginTop).toBe(end)

    // Back past the top: offset 0.
    await scroll($, -10_000, 24)
    const top = await parts(pane)
    expect(top.content.props?.marginTop).toBe(0)
    expect(textOf(top.footer)).toContain('2.1.296')
    expect(textOf(top.header)).toContain('api')
  } finally {
    await leaveDemo($)
  }
})

test('a taller pane shrinks the end offset; a collapsed section clamps it', async ($, on) => {
  await start($, on, true)
  try {
    const pane = await mount($, 24)
    await scroll($, 10_000, 24)
    const short = Number((await parts(pane)).content.props?.marginTop)
    await pane.redraw(paneProps(40))
    const tall = Number((await parts(pane)).content.props?.marginTop)
    expect(tall).toBeGreaterThan(short)
    // Collapse every section: the content fits, so it is drawn from the top.
    for (const id of ['session', 'context', 'mcp', 'subagents', 'todos', 'gentle'])
      await pane.press({ key: `toggle-${id}` } as never)
    expect((await parts(pane)).content.props?.marginTop).toBe(0)
    for (const id of ['session', 'context', 'mcp', 'subagents', 'todos', 'gentle'])
      await pane.press({ key: `toggle-${id}` } as never)
  } finally {
    await leaveDemo($)
  }
})

test('content that fits never scrolls', async ($, on) => {
  await start($, on, false)
  const pane = await mount($, 200)
  await scroll($, 5, 200)
  expect((await parts(pane)).content.props?.marginTop).toBe(0)
})

test('the header names the repository root', async ($, on) => {
  await start($, on, false)
  expect(textOf((await parts(await mount($, 40))).header)).toContain('mono-repo')
})

test('outside a repository, the header names the working directory', async ($, on) => {
  repoRoot = null
  try {
    await start($, on, false)
    const header = textOf((await parts(await mount($, 40))).header)
    expect(header).toContain('web')
    expect(header).not.toContain('mono-repo')
  } finally {
    repoRoot = REPO
  }
})

test('privacy mode masks the project name in the header', async ($, on) => {
  await start($, on, false)
  const pane = await mount($, 40)
  await $.command.run({ command: 'hud-private', args: '' } as never)
  try {
    const header = textOf((await parts(pane)).header)
    expect(header).toContain('…')
    expect(header).not.toContain('mono-repo')
  } finally {
    await $.command.run({ command: 'hud-private', args: '' } as never)
  }
})

test('an inline Pane keeps the plain flow: no fixed height, no viewport', async ($, on) => {
  await start($, on, false)
  const root = (await (await mount($, 24, 'inline')).drawn()) as Node
  expect(root.props?.height).toBe(undefined)
  expect(all(root, 'Box').some(b => b.props?.overflow === 'hidden')).toBe(false)
  expect(textOf(root)).toContain('mono-repo')
  expect(textOf(root)).toContain('2.1.296')
})
