import { describe, expect, it, vi } from 'vitest'
import { ScheduleId, ScheduleInputError, type ScheduleCatalogEntry, type ScheduleListRequest, type ScheduleListResult } from '@deepseek-ai/dsh-schedule'
import { SessionId } from '@deepseek-ai/dsh-session'
import { runLoop } from '../src/loop.js'

const id = SessionId('current'), signal = new AbortController().signal
const task = (n: number, owner = id): ScheduleCatalogEntry => ({
  id: ScheduleId(`schedule-${String(n)}`), kind: 'every', title: 'native', prompt: 'check', everySeconds: 60,
  scheduledAt: '2026-11-13T12:00:00Z', target: { kind: 'session', sessionId: owner },
  involvedSessionIds: [owner], status: 'active', updatedAt: '2026-11-13T11:59:00Z',
})
function service() {
  return { create: vi.fn(async () => task(1)), list: vi.fn<(_request?: ScheduleListRequest) => Promise<ScheduleListResult>>(),
    view: vi.fn(async () => task(1)), edit: vi.fn(async () => ({ id: ScheduleId('schedule-1'), deleted: true as const })) }
}

describe('native session-fenced loops', () => {
  it('uses typed every timing and an explicit current target', async () => {
    const native = service()
    await expect(runLoop(native, id, '1m check', signal)).resolves.toEqual({ kind: 'success', text: 'scheduled schedule-1 · every 1m · check' })
    expect(native.create).toHaveBeenCalledExactlyOnceWith({ title: 'check', prompt: 'check',
      timing: { kind: 'every', every_seconds: 60 }, target: { kind: 'session', sessionId: id } }, id, signal)
  })
  it('reads every native page and shows only the current target', async () => {
    const native = service()
    native.list.mockImplementation(async ({ offset = 0, limit = 500 } = {}) => ({
      offset, limit, total: 701, shown: offset === 0 ? 500 : 201,
      items: Array.from({ length: offset === 0 ? 500 : 201 }, (_, n) => task(offset + n, n === 0 ? id : SessionId('foreign'))),
    }))
    await expect(runLoop(native, id, '', signal)).resolves.toEqual({ kind: 'success', text: 'schedule-0 · every 1m · check\nschedule-500 · every 1m · check' })
    expect(native.list.mock.calls).toEqual([[{ active: true, limit: 500, offset: 0 }], [{ active: true, limit: 500, offset: 500 }]])
  })
  it('cannot stop another target and fences deletion against a concurrent retarget', async () => {
    const native = service()
    native.view.mockResolvedValueOnce(task(1, SessionId('foreign')))
    await expect(runLoop(native, id, 'stop schedule-1', signal)).resolves.toEqual({ kind: 'error', text: 'schedule schedule-1 not found in this session' })
    expect(native.edit).not.toHaveBeenCalled()
    await expect(runLoop(native, id, 'stop schedule-1', signal)).resolves.toEqual({ kind: 'success', text: 'stopped schedule-1' })
    expect(native.edit).toHaveBeenCalledExactlyOnceWith({ id: ScheduleId('schedule-1'), action: 'delete', expectedUpdatedAt: task(1).updatedAt }, id, signal)
  })
  it('does not retry a native retarget conflict or hide an unknown-state storage failure', async () => {
    const native = service()
    native.edit.mockResolvedValueOnce({ code: 'schedule_conflict' } as never)
    await expect(runLoop(native, id, 'stop schedule-1', signal)).resolves.toEqual({ kind: 'error', text: 'schedule schedule-1 changed; list loops again' })
    expect(native.edit).toHaveBeenCalledTimes(1)
    const error = Object.assign(new Error('native domain quarantined'), { code: 'unknown-state' })
    native.list.mockRejectedValueOnce(error)
    await expect(runLoop(native, id, '', signal)).rejects.toBe(error)
    expect(native.list).toHaveBeenCalledTimes(1)
  })
  it('keeps native input errors and fails by name if paging cannot advance', async () => {
    const native = service()
    native.create.mockRejectedValueOnce(new ScheduleInputError('frequency_too_high', 'native frequency limit'))
    await expect(runLoop(native, id, '0m check', signal)).resolves.toEqual({ kind: 'error', text: 'native frequency limit' })
    native.list.mockResolvedValue({ items: [], offset: 0, shown: 0, limit: 500, total: 1 })
    await expect(runLoop(native, id, '', signal)).rejects.toThrow('DSH schedule list did not advance')
    expect(native.list).toHaveBeenCalledTimes(1)
  })
})
