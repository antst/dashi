# Stdio MCP server stderr inherits the host terminal

## Body

- Queued (not yet posted): DSH Discussion: @deepseek-ai/dsh-mcp-client spawns stdio MCP servers with stderr inherited (transport.ts:31-39 passes no stderr option; the MCP SDK defaults to 'inherit', stdio.js:48-75), so server logs write straight to the host terminal and corrupt any TUI frame; suggest piping stderr into DSH's logger or a diagnostics channel. Nearest existing thread: Discussion 4465 (silent stdio spawn failures); related 1241, 5129; third-party reproduction ccch1mneyyy/dsh-TUI issue 17 (W-057).

Target: DSH Discussion (plain)
