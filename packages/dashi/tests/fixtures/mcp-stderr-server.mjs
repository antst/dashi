const marker = 'W057_MCP_STDERR_LIVE'
let buffer = ''
let scheduled = false

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  for (;;) {
    const end = buffer.indexOf('\n')
    if (end === -1) break
    const line = buffer.slice(0, end)
    buffer = buffer.slice(end + 1)
    if (line === '') continue
    const message = JSON.parse(line)
    if (message.method === 'initialize') {
      reply(message.id, {
        capabilities: { tools: {} },
        protocolVersion: message.params.protocolVersion,
        serverInfo: { name: 'w057-fixture', version: '1.0.0' },
      })
    } else if (message.method === 'tools/list') {
      reply(message.id, { tools: [] })
      if (!scheduled) {
        scheduled = true
        setTimeout(() => { process.stderr.write(`${marker}\n`) }, 2_000)
      }
    }
  }
})
