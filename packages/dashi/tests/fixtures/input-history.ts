import type { SessionEvent } from '@deepseek-ai/dsh-session'

export const inputHistoryEvents = [
  { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
  { type: 'user/message', seq: 1, time: 1, surfaceOp: 'append', data: {
    content: [{ type: 'text', text: 'first prompt' }], source: { kind: 'user' },
  } },
  { type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
  { type: 'command/run', seq: 3, time: 3, data: {
    commandId: 'model', name: 'model', args: '', source: { kind: 'user' },
  } },
  { type: 'command/done', seq: 4, time: 4, data: { commandId: 'model', kind: 'success' } },
  { type: 'user/message', seq: 5, time: 5, surfaceOp: 'append', data: {
    content: [{ type: 'text', text: "$ printf 'ok value'\n[stdout]\nok value\n[exit 0]" }],
    source: { form: 'notice', kind: 'plugin', plugin: 'dashi', summary: 'Shell: printf ok value' },
  } },
  { type: 'turn/start', seq: 6, time: 6, data: { turn: 2 } },
  { type: 'turn/end', seq: 7, time: 7, data: { turn: 2, reason: { kind: 'completed' } } },
  { type: 'command/run', seq: 8, time: 8, data: {
    commandId: 'login', name: 'login', source: { kind: 'user' },
  } },
  { type: 'command/done', seq: 9, time: 9, data: { commandId: 'login', kind: 'success' } },
  { type: 'command/run', seq: 10, time: 10, data: {
    commandId: 'permission', name: 'permission', args: ' default', source: { kind: 'user' },
  } },
  { type: 'command/done', seq: 11, time: 11, data: { commandId: 'permission', kind: 'success' } },
] as SessionEvent[]

export const inputHistory = [
  'first prompt', '/model', "!printf 'ok value'", '/permission default',
] as const
