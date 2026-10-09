import type { AgentRow, TodoItem, TodoStatus } from '../types'

// A fixed sample session behind `/hud-demo`, for README recordings and
// screenshots: no model calls, no personal data. Pure: everything derives from
// the time since demo mode was switched on, so frames progress on the poller's
// redraws and tests are deterministic.

export type DemoModel = { model: string; effort?: string | number }
export type DemoMeter = { label: string; percent: number; note: string }
export type DemoServer = { name: string; connected: boolean }
export type DemoAgent = AgentRow & DemoModel

export type DemoSnapshot = {
  session: {
    title: string
    id: string
    account: string
    model: DemoModel
    branch: string
    cwd: string
    home: string
  }
  contextPercent: number
  meters: DemoMeter[]
  footer: string
  servers: DemoServer[]
  agents: DemoAgent[]
  todos: TodoItem[]
}

const SESSION: DemoSnapshot['session'] = {
  title: 'checkout-refactor',
  id: '3f9c2a1e-8b7d-4c21-9f0e-5a6b7c8d9e0f',
  account: 'you@Acme',
  model: { model: 'claude-opus-5-5', effort: 'high' },
  branch: 'feat/checkout-v2',
  cwd: '/home/you/code/shop/api',
  home: '/home/you',
}

const CONTEXT_PERCENT = 42

const METERS: DemoMeter[] = [
  { label: 'ctx', percent: CONTEXT_PERCENT, note: ' · 1M' },
  { label: '5h', percent: 18, note: ' ↻ 2h40m (14:10)' },
  { label: '7d', percent: 9, note: ' ↻ 5d6h (Wed 12:30)' },
]

const FOOTER = '420,118 tokens · $3.42 spent'

// Connected first, as `mcpServers` orders them.
const SERVERS: DemoServer[] = [
  { name: 'github', connected: true },
  { name: 'context7', connected: true },
  { name: 'linear', connected: true },
  { name: 'sentry', connected: false },
]

type AgentScript = {
  id: string
  type: string
  description: string
  model: string
  effort: string
  start: number
  end: number
  outcome: 'completed' | 'failed'
  tokens: number
}

const AGENTS: AgentScript[] = [
  {
    id: 'A1',
    type: 'Explore',
    description: 'Map the checkout flow',
    model: 'claude-haiku-5-5',
    effort: 'low',
    start: 0,
    end: 5000,
    outcome: 'completed',
    tokens: 12_400,
  },
  {
    id: 'A2',
    type: 'general-purpose',
    description: 'Write payment service tests',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    start: 0,
    end: 9000,
    outcome: 'completed',
    tokens: 31_800,
  },
  {
    id: 'A3',
    type: 'code-reviewer',
    description: 'Review API changes',
    model: 'claude-opus-5-5',
    effort: 'high',
    start: 2000,
    end: 12_000,
    outcome: 'completed',
    tokens: 18_900,
  },
  {
    id: 'A4',
    type: 'Explore',
    description: 'Find flaky tests',
    model: 'claude-haiku-5-5',
    effort: 'low',
    start: 6000,
    end: 10_000,
    outcome: 'failed',
    tokens: 7_200,
  },
]

const TODOS = [
  'Map the current checkout flow',
  'Extract the payment service',
  'Add retries to the payment client',
  'Write payment service tests',
  'Update the API docs',
  'Run the full test suite',
]

// One todo in progress at a time, advancing every TODO_STEP ms; all done after.
const TODO_STEP = 2500

const agentAt = (a: AgentScript, t: number): DemoAgent => {
  const done = t >= a.end
  return {
    id: a.id,
    type: a.type,
    description: a.description,
    status: done ? a.outcome : 'running',
    elapsedMs: (done ? a.end : t) - a.start,
    done,
    tokens: done ? a.tokens : undefined,
    model: a.model,
    effort: a.effort,
  }
}

const todosAt = (t: number): TodoItem[] => {
  const current = Math.floor(Math.max(0, t) / TODO_STEP)
  return TODOS.map((content, i) => {
    const status: TodoStatus = i < current ? 'completed' : i === current ? 'in_progress' : 'pending'
    return { id: `d${i}`, content, status }
  })
}

export const demoSnapshot = (elapsedMs: number): DemoSnapshot => ({
  session: SESSION,
  contextPercent: CONTEXT_PERCENT,
  meters: METERS,
  footer: FOOTER,
  servers: SERVERS,
  agents: AGENTS.filter(a => elapsedMs >= a.start).map(a => agentAt(a, elapsedMs)),
  todos: todosAt(elapsedMs),
})
