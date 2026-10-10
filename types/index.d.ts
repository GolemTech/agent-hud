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
        gentle: boolean
      }
      todos: TodoItem[]
      /** Privacy mode (`/hud-private`): identity fields masked. */
      private: boolean
      /** The Pane's own scroll offset, in rows, under the sticky header. */
      scroll: number
      /** The `/hud-theme` name (`hooks/themes.ts`); an unknown one draws as `default`. */
      theme: string
      /** The `/hud-theme` picker block is open at the top of the Pane. */
      picker: boolean
      /** The theme the picker's focus ring rests on, drawn over `theme`; null when none. */
      preview: string | null
    }
  }
}
