// The MCP section's `active` / `all` filter. Pure: no `$` here (see
// CLAUDE.md); `register.tsx` keeps the mode in the `mcpFilter` atom and its
// `$.store` copy.

export type McpFilter = 'all' | 'active'

export const MCP_FILTERS = ['active', 'all'] as const satisfies readonly McpFilter[]
export const DEFAULT_MCP_FILTER: McpFilter = 'all'

export const isMcpFilter = (mode: unknown): mode is McpFilter => mode === 'all' || mode === 'active'

// The servers drawn under `mode`, and how many it leaves out: `active` keeps
// the connected ones only (a server waiting on auth is hidden).
export const filterServers = <S extends { connected: boolean }>(
  servers: readonly S[],
  mode: McpFilter,
): { shown: S[]; hidden: number } => {
  const shown = mode === 'active' ? servers.filter(s => s.connected) : [...servers]
  return { shown, hidden: servers.length - shown.length }
}

// The line drawn when no server is shown: none at all, or all hidden.
export const mcpEmptyText = (hidden: number): string =>
  hidden > 0 ? `no active servers · ${hidden} hidden` : 'none connected'

// The line under a filtered list that left servers out.
export const mcpHiddenText = (hidden: number): string => `${hidden} hidden`

// Rows the section body draws: one per server plus the hidden line, or the
// one empty line.
export const mcpBodyRows = (shown: number, hidden: number): number =>
  shown === 0 ? 1 : shown + (hidden > 0 ? 1 : 0)
