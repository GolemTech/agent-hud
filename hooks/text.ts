// Defence in depth for text from outside the plugin (files, tool inputs, the
// agent list, MCP tool names, command output): C0 and C1 control characters
// are removed where that text enters, so no escape sequence, newline or bell
// reaches the screen. Pure, so both `register.tsx` and `gentle.ts` import it.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
export const clean = (s: string): string => s.replace(CONTROL, '')
