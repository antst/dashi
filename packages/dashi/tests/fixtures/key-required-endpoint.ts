import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

/** Test transport only: real DSH adapters must authenticate before this endpoint completes a request. */
export async function keyRequiredEndpoint() {
  let key = randomUUID()
  const accepted: { marker: string; path: string }[] = []
  let rejected = 0
  const server = createServer(async (request, response) => {
    if (request.headers['x-api-key'] !== key && request.headers.authorization !== `Bearer ${key}`) {
      rejected++
      response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { type: 'authentication_error', message: 'test endpoint requires its key' } }))
      request.resume()
      return
    }
    let body = ''
    for await (const chunk of request) body += String(chunk)
    const payload = JSON.parse(body) as { messages: { role: string; content: unknown }[] }
    const content = JSON.stringify(payload.messages.filter(message => message.role === 'user').map(message => message.content))
    // DSH may merge adjacent user messages; answer the last explicitly submitted marker.
    const marker = [...content.matchAll(/W127_[A-Z_]+/gu)].at(-1)?.[0] ?? 'W127_COMPLETED'
    accepted.push({ marker, path: request.url ?? '' })
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const frame = (value: object) => response.write(`data: ${JSON.stringify(value)}\n\n`)
    if (request.url?.endsWith('/chat/completions')) {
      const base = { id: 'test-completion', object: 'chat.completion.chunk', model: 'deepseek-chat', created: 0 }
      frame({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: `${marker} completed` }, finish_reason: null }] })
      frame({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
      response.end('data: [DONE]\n\n')
    } else {
      frame({ type: 'message_start', message: { id: 'test-message', type: 'message', role: 'assistant', model: 'deepseek-flash', content: [], usage: { input_tokens: 1, output_tokens: 0 } } })
      frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `${marker} completed` } })
      frame({ type: 'content_block_stop', index: 0 })
      frame({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
      frame({ type: 'message_stop' })
      response.end()
    }
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('endpoint omitted its listening port')
  return {
    url: `http://127.0.0.1:${address.port}`, accepted,
    rejected: () => rejected,
    key: () => key,
    rotate: () => { key = randomUUID() },
    close: () => new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve() }) }),
  }
}
