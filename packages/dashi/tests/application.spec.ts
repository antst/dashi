import { describe, expect, it } from 'vitest'
import { createTerminalShell } from '../src/application.js'
import type { Renderer } from '../src/renderer.js'

function fakeRenderer(log: string[], failRedraw = false): Renderer {
  let renders = 0
  return {
    bell: () => { log.push('bell') },
    copy: () => 'ok',
    discardSecretComposer: () => { log.push('discard') },
    drainInput: async () => { log.push('drain') },
    materializedCells: () => 0,
    render: force => {
      renders++
      log.push(`render:${force}`)
      if (failRedraw && renders > 1) throw new Error('redraw exploded')
    },
    setComposer: text => { log.push(`composer:${text}`) },
    start: () => { log.push('start') },
    stop: preserve => { log.push(`stop:${preserve}`) },
  }
}

describe('terminal application', () => {
  it('runs effects in order and exits on the second empty Ctrl+C', async () => {
    const log: string[] = []
    const exits: number[] = []
    const shell = createTerminalShell({
      createView: () => fakeRenderer(log), cwd: '/work', exit: code => { exits.push(code) }, inline: false,
    })
    shell.start()
    shell.dispatch({ type: 'ctrl-c' })
    shell.dispatch({ type: 'ctrl-c' })
    await shell.whenIdle()
    expect(exits).toEqual([0])
    await shell.dispose()
    expect(log).toEqual(['start', 'render:true', 'render:false', 'drain', 'stop:true', 'discard'])
  })

  it('prints a diagnostic before releasing the terminal when an effect throws', async () => {
    const log: string[] = []
    const exits: number[] = []
    const shell = createTerminalShell({
      createView: () => fakeRenderer(log, true), cwd: '/work', exit: code => { exits.push(code) }, inline: false,
      writeError: message => { log.push(`error:${message.includes('redraw exploded')}`) },
    })
    shell.start()
    shell.dispatch({ type: 'redraw' })
    await shell.whenIdle()
    expect(exits).toEqual([1])
    expect(log).toEqual([
      'start', 'render:true', 'render:true', 'discard', 'error:true', 'drain', 'stop:true',
    ])
  })

  it('uses the same failure path for a host stream error', async () => {
    const log: string[] = []
    const exits: number[] = []
    const shell = createTerminalShell({
      createView: () => fakeRenderer(log), cwd: '/work', exit: code => { exits.push(code) }, inline: false,
      writeError: message => { log.push(`error:${message.includes('broken pipe')}`) },
    })
    shell.start()
    await shell.fail(Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))
    expect(exits).toEqual([1])
    expect(log).toEqual(['start', 'render:true', 'discard', 'error:true', 'drain', 'stop:true'])
  })

  it('releases the terminal when backend cleanup also fails', async () => {
    const log: string[] = []
    const exits: number[] = []
    const shell = createTerminalShell({
      beforeExit: async () => { throw new Error('flush exploded') },
      createView: () => fakeRenderer(log, true),
      cwd: '/work',
      exit: code => { exits.push(code) },
      inline: false,
      writeError: message => { log.push(message.includes('cleanup failure') ? 'cleanup-error' : 'effect-error') },
    })
    shell.start()
    shell.dispatch({ type: 'redraw' })
    await shell.whenIdle()
    expect(exits).toEqual([1])
    expect(log).toEqual([
      'start', 'render:true', 'render:true', 'discard', 'effect-error', 'cleanup-error', 'drain', 'stop:true',
    ])
  })

  it('owns pending decision promises in the effect runner and removes them after settlement', async () => {
    const shell = createTerminalShell({
      createView: () => fakeRenderer([]), cwd: '/work', exit: () => {}, inline: false,
    })
    shell.start()
    const result = shell.requestDecision({
      cursor: 0, id: 'approval-1', kind: 'approval', owner: { id: 'session-1' },
      prompt: 'Run outside the sandbox?', toolName: 'bash',
    })
    shell.dispatch({ type: 'decision-number', number: 2 })
    shell.dispatch({ type: 'decision-submit' })
    await shell.whenIdle()
    await expect(result).resolves.toBe('rejected')
    expect(shell.readState().decisions).toEqual([])
    await shell.dispose()
  })

  it('writes bell effects once and suppresses them in accessible mode', async () => {
    const audible: string[] = []
    const audibleShell = createTerminalShell({
      createView: () => fakeRenderer(audible), cwd: '/work', exit: () => {}, inline: false,
    })
    audibleShell.dispatch({ type: 'turn-ended', durationMs: 10_000, rootId: 'session-1' })
    audibleShell.dispatch({ type: 'root-bound', cells: [], hasMore: false, prompts: [], root: {
      cwd: '/work', id: 'session-1', model: 'm', status: 'idle',
    } })
    audibleShell.dispatch({ type: 'turn-ended', durationMs: 10_000, rootId: 'session-1' })
    await audibleShell.whenIdle()
    expect(audible.filter(item => item === 'bell')).toHaveLength(1)
    await audibleShell.dispose()

    const accessible: string[] = []
    const accessibleShell = createTerminalShell({
      accessible: true, createView: () => fakeRenderer(accessible), cwd: '/work', exit: () => {}, inline: true,
    })
    accessibleShell.dispatch({ type: 'root-bound', cells: [], hasMore: false, prompts: [], root: {
      cwd: '/work', id: 'session-1', model: 'm', status: 'idle',
    } })
    accessibleShell.dispatch({ type: 'turn-ended', durationMs: 10_000, rootId: 'session-1' })
    await accessibleShell.whenIdle()
    expect(accessible).not.toContain('bell')
    await accessibleShell.dispose()
  })

  it('rejects pending questions when the terminal is lost', async () => {
    const shell = createTerminalShell({
      createView: () => fakeRenderer([]), cwd: '/work', exit: () => {}, inline: false,
    })
    shell.start()
    const result = shell.requestDecision({
      answers: [], cursor: 0, custom: '', id: 'question-1', index: 0, kind: 'question',
      owner: { id: 'session-1' }, questions: [{
        id: 'why', multiSelect: false, options: [], question: 'Why?',
      }], selected: [],
    })
    await shell.dispose()
    await expect(result).rejects.toMatchObject({ name: 'UserQuestionError', code: 'ASK_CANCELLED' })
  })

  it('uses the cooked-terminal handoff while an external editor replaces text', async () => {
    const log: string[] = []
    const shell = createTerminalShell({
      createView: () => fakeRenderer(log), cwd: '/work', exit: () => {}, inline: false,
      externalEdit: async (text, cwd) => {
        log.push(`edit:${cwd}:${text}`)
        return `${text} edited`
      },
    })
    shell.start()
    shell.dispatch({ type: 'composer-changed', text: 'draft' })
    shell.dispatch({ type: 'external-edit' })
    await shell.whenIdle()
    expect(shell.readState().composer).toBe('draft edited')
    expect(log.join('|')).toBe([
      'start', 'render:true', 'render:false', 'drain', 'stop:true', 'edit:/work:draft',
      'start', 'render:true', 'composer:draft edited', 'render:false',
    ].join('|'))
    await shell.dispose()
  })
})
