export type AgentRow = {
  id: string
  type: string
  description: string
  status: string
  elapsedMs: number
  done: boolean
  /** Context tokens of the agent's latest finished turn; absent until one ends. */
  tokens?: number
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type TodoItem = {
  id: string
  content: string
  activeForm?: string
  status: TodoStatus
}

declare module 'claude-code' {
  interface PluginState {
    'agent-hud': {
      rows: AgentRow[]
      collapsed: {
        session: boolean
        context: boolean
        mcp: boolean
        subagents: boolean
        todos: boolean
      }
      todos: TodoItem[]
    }
  }
}
