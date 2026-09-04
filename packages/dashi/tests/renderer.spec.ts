import { readFileSync } from 'node:fs'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { decodeStorageRecord, type SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { createTerminalShell } from '../src/application.js'
import { sessionOverlay } from '../src/catalogs.js'
import { VERSION_LINE } from '../src/help.js'
import { createRenderer, type Renderer } from '../src/renderer.js'
import { historyInputs } from '../src/rewind.js'
import { foldCells } from '../src/transcript.js'
import { inputHistoryEvents } from './fixtures/input-history.js'
import { testCeiling } from './test-budget.js'

function codeBlockCells() {
  const lines = readFileSync(new URL('./fixtures/code-block-session.jsonl', import.meta.url), 'utf8').trim().split('\n')
  const events = lines.flatMap((line, index) => index === 0 ? [] : decodeStorageRecord(JSON.parse(line)))
  return foldCells(events as SessionEvent[])
}

function percentile95(samples: readonly number[]): number {
  return [...samples].sort((left, right) => left - right)[Math.floor(samples.length * 0.95)] ?? Infinity
}

function report(name: string, value: number, unit: string): void {
  process.stdout.write(`performance: ${name} ${value.toFixed(2)} ${unit}\n`)
}

class ScreenTerminal {
  readonly screen: HeadlessTerminal
  output = ''
  private input: (data: string) => void = () => {}
  private pending = Promise.resolve()

  constructor(readonly columns: number, readonly rows: number) {
    this.screen = new HeadlessTerminal({ allowProposedApi: true, cols: columns, rows })
  }

  get kittyProtocolActive(): boolean { return false }
  start(onInput: (data: string) => void): void { this.input = onInput }
  stop(): void { this.input = () => {} }
  drainInput(): Promise<void> { return Promise.resolve() }
  write(data: string): void {
    this.output += data
    this.pending = this.pending.then(() => new Promise<void>(resolve => { this.screen.write(data, resolve) }))
  }
  moveBy(lines: number): void { this.write(lines < 0 ? `\u001B[${-lines}A` : `\u001B[${lines}B`) }
  hideCursor(): void { this.write('\u001B[?25l') }
  showCursor(): void { this.write('\u001B[?25h') }
  clearLine(): void { this.write('\u001B[2K') }
  clearFromCursor(): void { this.write('\u001B[0J') }
  clearScreen(): void { this.write('\u001B[2J\u001B[H') }
  setTitle(): void {}
  setProgress(): void {}
  send(data: string): void { this.input(data) }
  async flush(): Promise<void> {
    await new Promise(resolve => { setTimeout(resolve, 30) })
    await this.pending
  }
  lines(): string[] {
    const buffer = this.screen.buffer.active
    return Array.from({ length: this.rows }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? '')
  }
}

describe('terminal renderer', () => {
  it('renders recalled command and shell input from a mixed durable log', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
      initialCells: foldCells(inputHistoryEvents),
      initialPrompts: historyInputs(inputHistoryEvents),
      initialRoot: { cwd: '/work', id: 'session', model: 'recorded', status: 'idle' },
    })
    shell.start()
    terminal.send('\u001B[A')
    await shell.whenIdle()
    terminal.send('\u001B[A')
    await shell.whenIdle(); await terminal.flush()
    expect(shell.readState().composer).toBe("!printf 'ok value'")
    expect(terminal.lines().join('\n')).toContain("!printf 'ok value'")
    await shell.dispose()
  })

  for (const inline of [false, true]) {
    for (const columns of [48, 80, 160]) {
      for (const rows of [8, 24]) {
        it(`renders ${inline ? 'inline' : 'alternate'} at ${columns}x${rows}`, async () => {
          const terminal = new ScreenTerminal(columns, rows)
          const shell = createTerminalShell({
            createView: bindings => createRenderer({ ...bindings, inline, terminal }),
            cwd: '/work/example', exit: () => {}, inline,
          })
          shell.start()
          await terminal.flush()
          const text = terminal.lines().join('\n')
          expect(text).toContain('dashi')
          expect(text).toContain('no session')
          expect(text).toContain('/work/example')
          expect(text).toContain('Ctrl+J newline')
          expect(text).toContain('─')
          await shell.dispose()
        })
      }
    }
  }

  const hudCases = [
    {
      label: 'with activity',
      status: 'gpt-5.6-terra · high · workspace-write · ctx 42k/200k 21% · cache 71% · 48k tok · 1 agents · 1 jobs · dashi · dtui/develop',
      widths: ['gpt-5.6-terra · high · workspace-write · ctx 42k/200k 21% · cache 71% · 48k tok…', 'gpt-5.6-terra · high · workspace-write · ctx 42k/200k 21% · cache 71% · 48k tok · 1 agents · 1 jobs · dashi · dtui/deve…'],
    },
    {
      label: 'without activity',
      status: 'gpt-5.6-terra · workspace-write · ctx 42k/200k 21% · cache 71% · 48k tok · dtui/develop',
      widths: ['gpt-5.6-terra · workspace-write · ctx 42k/200k 21% · cache 71% · 48k tok · dtui…', 'gpt-5.6-terra · workspace-write · ctx 42k/200k 21% · cache 71% · 48k tok · dtui/develop'],
    },
  ] as const
  for (const hud of hudCases) {
    for (const [index, columns] of [80, 120].entries()) {
      it(`renders the HUD ${hud.label} at ${String(columns)} columns`, async () => {
        const terminal = new ScreenTerminal(columns, 24)
        const shell = createTerminalShell({
          createView: bindings => createRenderer({ ...bindings, inline: false, statusLine: () => hud.status, terminal }),
          cwd: '/work', exit: () => {}, inline: false,
          initialRoot: { cwd: '/work', id: 'session', model: 'recorded', status: 'idle' },
        })
        shell.start()
        await terminal.flush()
        const lines = terminal.lines()
        const statusIndex = lines.findIndex(value => value.includes('gpt-5.6-terra'))
        expect(statusIndex).toBeGreaterThan(-1)
        expect(lines[statusIndex]?.trimEnd()).toBe(hud.widths[index])
        expect(lines[statusIndex + 1]?.trimStart()).toMatch(/^─/u)
        expect(lines.join('\n')).toContain('idle · Enter send · cards collapsed')
        expect(lines.join('\n')).not.toContain('idle · recorded')
        terminal.send('\u0004')
        await shell.whenIdle(); await terminal.flush()
        expect(terminal.lines().join('\n')).not.toContain('gpt-5.6-terra')
        expect(terminal.lines().join('\n')).toContain('Ctrl+C or Ctrl+D again to exit')
        await shell.dispose()
      })
    }
  }

  it('omits the persistent status in accessible mode', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      accessible: true,
      createView: bindings => createRenderer({
        ...bindings, accessible: true, inline: true, statusLine: () => 'model hidden', terminal,
      }),
      cwd: '/work', exit: () => {}, inline: true,
      initialRoot: { cwd: '/work', id: 'session', model: 'recorded', status: 'idle' },
    })
    shell.start()
    await terminal.flush()
    expect(terminal.lines().join('\n')).not.toContain('model hidden')
    expect(terminal.lines().join('\n')).toContain('idle · recorded · Enter send · cards collapsed')
    await shell.dispose()
  })

  it('accepts ordinary input, Ctrl+J, and a multiline bracketed paste', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
    })
    shell.start()
    terminal.send('hello')
    terminal.send('\n')
    terminal.send('\u001B[200~one\ntwo\u001B[201~')
    await shell.whenIdle()
    expect(shell.readState().composer).toBe('hello\none\ntwo')
    await shell.dispose()
  })

  it('opens and narrows live completion, executes with Enter, and inserts with Tab', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const completed: Array<[string, number]> = []
    const submitted: string[] = []
    const shell = createTerminalShell({
      complete: async (query, caret) => {
        completed.push([query, caret])
        if (query.startsWith('/')) return [
          { group: 'Commands' as const, label: '/compact', submitOnEnter: true, value: { kind: 'insert' as const, text: '/compact ' } },
          { group: 'Commands' as const, label: '/copy', submitOnEnter: true, value: { kind: 'insert' as const, text: '/copy ' } },
        ].filter(option => option.label.includes(query.slice(1)))
        if (query.includes('@')) return [{
          group: 'Files', label: 'src/index.ts', value: { kind: 'insert', text: 'see @src/index.ts ' },
        }]
        return []
      },
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
      initialRoot: { cwd: '/work', id: 'session', model: 'recorded', status: 'idle' },
      submit: text => { submitted.push(text) },
    })
    shell.start()
    terminal.send('/')
    await shell.whenIdle(); await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('/compact')
    terminal.send('omp')
    await shell.whenIdle()
    expect(shell.readState().overlay).toMatchObject({
      kind: 'list', options: [{ label: '/compact' }], purpose: 'completion',
    })
    terminal.send('\r')
    await shell.whenIdle()
    expect(submitted).toEqual(['/compact'])
    terminal.send('see @')
    await shell.whenIdle(); await terminal.flush()
    expect(completed).toContainEqual(['see @', 5])
    expect(terminal.lines().join('\n')).toContain('src/index.ts')
    terminal.send('\t')
    await shell.whenIdle()
    expect(shell.readState().composer).toBe('see @src/index.ts ')
    expect(submitted).toEqual(['/compact'])
    await shell.dispose()
  })

  it('renders pending commands with elapsed status and no spinner in accessible mode', async () => {
    const startedAt = Date.now() - 2_000
    for (const accessible of [false, true]) {
      const terminal = new ScreenTerminal(80, 24)
      const shell = createTerminalShell({
        accessible,
        createView: bindings => createRenderer({ ...bindings, accessible, inline: false, terminal }),
        cwd: '/work', exit: () => {}, inline: false,
        initialCells: [{ key: 'command:slow', kind: 'command', pending: true, startedAt, text: '/compact' }],
        initialRoot: { cwd: '/work', id: 'session', model: 'recorded', status: 'idle' },
      })
      shell.start()
      await terminal.flush()
      const screen = terminal.lines().join('\n')
      expect(screen).toMatch(/running \/compact · \d+s/u)
      expect(screen).toMatch(accessible ? /\[running\] \/compact · \d+s/u : /[\u2800-\u28ff] \/compact · \d+s/u)
      if (accessible) expect(terminal.output).not.toMatch(/[\u2800-\u28ff]/u)
      await shell.dispose()
    }
  })

  it('uses accessible status words when TERM is dumb', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({
        ...bindings, inline: true, terminal, terminalType: 'dumb',
      }),
      cwd: '/work', exit: () => {}, inline: true,
      initialCells: [{ key: 'command:dumb', kind: 'command', pending: true, text: '/compact' }],
      initialRoot: { cwd: '/work', id: 'session', model: 'recorded', status: 'idle' },
    })
    shell.start()
    await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('[running] /compact')
    expect(terminal.output).not.toMatch(/[\u2800-\u28ff]/u)
    await shell.dispose()
  })

  it('keeps bracketed text paste in the editor and uses literal Ctrl+V for a clipboard image', async () => {
    const terminal = new ScreenTerminal(80, 24)
    let reads = 0
    const attachment = {
      bytes: 3, data: Uint8Array.of(1, 2, 3), mediaType: 'image/png' as const,
      name: 'clipboard.png', path: 'clipboard',
    }
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
      pasteImage: async () => { reads++; return attachment },
    })
    shell.start()
    terminal.send('\u001B[200~pasted text\u001B[201~')
    await shell.whenIdle()
    expect(reads).toBe(0)
    expect(shell.readState().composer).toBe('pasted text')
    const decision = shell.requestDecision({
      cursor: 0, id: 'paste-blocked', kind: 'approval', owner: { id: 'session' },
      prompt: 'Allow?', toolName: 'bash',
    })
    terminal.send('\u001B[200~hidden change\u001B[201~')
    terminal.send('\u001B')
    await shell.whenIdle()
    await expect(decision).resolves.toBe('cancelled')
    expect(shell.readState().composer).toBe('pasted text')
    terminal.send('\u0016')
    await shell.whenIdle()
    expect(reads).toBe(1)
    expect(shell.readState().attachments).toEqual([attachment])
    expect(shell.readState().composer).toBe('pasted text')
    await shell.dispose()
  })

  it('inserts newlines for distinct Shift+Enter and Alt+Enter sequences', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
    })
    shell.start()
    terminal.send('one')
    terminal.send('\u001B[13;2u')
    terminal.send('two')
    terminal.send('\u001B[13;3u')
    terminal.send('three')
    await shell.whenIdle()
    expect(shell.readState().composer).toBe('one\ntwo\nthree')
    await shell.dispose()
  })

  it('renders inspectable image chips, removes the last, and restores the stashed cursor and image', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const attachment = {
      bytes: 3, data: Uint8Array.of(1, 2, 3), mediaType: 'image/png' as const,
      name: 'shot.png', path: '/work/screens/shot.png',
    }
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, initialAttachments: [attachment], inline: false,
    })
    shell.start()
    terminal.send('ab')
    terminal.send('\u001B[D')
    terminal.send('\u0013')
    await shell.whenIdle()
    expect(shell.readState()).toMatchObject({ attachments: [], composer: '' })
    terminal.send('\u0013')
    await shell.whenIdle()
    terminal.send('X')
    await shell.whenIdle()
    expect(shell.readState()).toMatchObject({ attachments: [attachment], composer: 'aXb' })
    await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('shot.png · image/png · 3 B · /work/screens/shot.png')
    shell.dispatch({ type: 'composer-set', text: '' })
    await shell.whenIdle()
    terminal.send('\u007F')
    await shell.whenIdle()
    expect(shell.readState().attachments).toEqual([])
    await shell.dispose()
  })

  it('keeps question-mark input ordinary and reserves F1 for help', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
    })
    shell.start()
    terminal.send('?explain this')
    await shell.whenIdle()
    expect(shell.readState().composer).toBe('?explain this')
    expect(shell.readState().overlay).toBeUndefined()

    terminal.send('\u001BOP')
    await shell.whenIdle()
    await terminal.flush()
    expect(shell.readState().composer).toBe('?explain this')
    expect(shell.readState().overlay).toMatchObject({ kind: 'info', title: 'Help' })
    const help = terminal.lines().join('\n')
    expect(help).toContain(VERSION_LINE)
    expect(help).toContain('Shift+Tab permission')
    expect(help).toContain('/plugins /plugin')
    expect(help).toContain('↓ 4 more')
    terminal.send('\u001B[6~')
    await shell.whenIdle(); await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('--permission PRESET')
    await shell.dispose()
  })

  it('truncates list titles and rows to the terminal width', async () => {
    const terminal = new ScreenTerminal(32, 12)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
    })
    shell.start()
    shell.dispatch({ type: 'open-overlay', overlay: {
      cursor: 0, kind: 'list', purpose: 'rewind',
      title: `TITLE_HEAD ${'x'.repeat(40)} TITLE_TAIL`,
      options: [{
        label: `ROW_HEAD ${'x'.repeat(40)} ROW_TAIL`, value: { kind: 'open-rewind' },
      }],
    } })
    await terminal.flush()
    const screen = terminal.lines().join('\n')
    expect(screen).toContain('TITLE_HEAD')
    expect(screen).toContain('ROW_HEAD')
    expect(screen).not.toContain('TITLE_TAIL')
    expect(screen).not.toContain('ROW_TAIL')
    await shell.dispose()
  })

  for (const inline of [false, true]) {
    it(`windows tall overlays at 24 rows in ${inline ? 'inline' : 'alternate'} mode`, async () => {
      const terminal = new ScreenTerminal(80, 24)
      const shell = createTerminalShell({
        createView: bindings => createRenderer({ ...bindings, inline, terminal }),
        cwd: '/work', exit: () => {}, inline,
      })
      shell.start()
      const options = Array.from({ length: 60 }, (_, index) => ({
        label: `List row ${String(index)}`,
        value: { kind: 'model' as const, model: String(index), provider: 'fixture' },
      }))
      for (const [cursor, above, below] of [[0, undefined, 41], [30, 21, 21], [59, 41, undefined]] as const) {
        shell.dispatch({ type: 'open-overlay', overlay: {
          cursor, kind: 'list', options, purpose: 'model', title: 'Tall list',
        } })
        await shell.whenIdle(); await terminal.flush()
        const screen = terminal.lines().join('\n')
        expect(screen).toContain(`List row ${String(cursor)}`)
        if (above === undefined) expect(screen).not.toMatch(/↑ \d+ more/u)
        else expect(screen).toContain(`↑ ${String(above)} more`)
        if (below === undefined) expect(screen).not.toMatch(/↓ \d+ more/u)
        else expect(screen).toContain(`↓ ${String(below)} more`)
      }

      shell.dispatch({ type: 'open-overlay', overlay: {
        kind: 'info', lines: Array.from({ length: 60 }, (_, index) => `Info row ${String(index)}`), title: 'Tall info',
      } })
      await shell.whenIdle(); await terminal.flush()
      expect(terminal.lines().join('\n')).toContain('↓ 42 more')
      terminal.send('\u001B[6~')
      await shell.whenIdle(); await terminal.flush()
      expect(shell.readState().overlay).toMatchObject({ kind: 'info', scrollOffset: 8 })
      for (let row = 0; row < 60; row++) terminal.send('\u001B[B')
      await shell.whenIdle(); await terminal.flush()
      const end = terminal.lines().join('\n')
      expect(shell.readState().overlay).toMatchObject({ kind: 'info', scrollOffset: 42 })
      expect(end).toContain('↑ 42 more')
      expect(end).toContain('Info row 59')
      expect(end).toContain('PageUp/PageDown')
      terminal.send('\u001B[5~')
      await shell.whenIdle()
      expect(shell.readState().overlay).toMatchObject({ kind: 'info', scrollOffset: 34 })
      terminal.send('\u001B[6~')
      await shell.whenIdle()
      expect(shell.readState().overlay).toMatchObject({ kind: 'info', scrollOffset: 42 })
      await shell.dispose()
    })
  }

  it('cycles presenter-backed cards through collapsed, expanded, and hidden modes', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
      initialCells: [{
        key: 'tool:diff', kind: 'tool', pending: false, text: 'Edit special.ts',
        tool: { card: 'diff', title: 'Edit special.ts', diffs: [{
          added: 1, lines: ['  before', '- old', '+ new', '  after'], path: 'special.ts', removed: 1,
        }] },
      }],
    })
    shell.start()
    await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('special.ts +1 -1')
    expect(terminal.lines().join('\n')).not.toContain('+ new')

    terminal.send('\u000F')
    await shell.whenIdle()
    await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('+ new')

    terminal.send('\u000F')
    await shell.whenIdle()
    await terminal.flush()
    expect(terminal.lines().join('\n')).not.toContain('Edit special.ts')
    expect(shell.readState().toolMode).toBe('hidden')
    await shell.dispose()
  })

  it('expands collapsed context through Ctrl+O and history', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
      initialCells: [{
        collapsed: true, detail: 'instructions · Workspace instructions · 3 lines',
        key: 'context', kind: 'context', text: 'Workspace instructions\nCONTEXT_BODY_HIDDEN\nlast',
      }],
    })
    shell.start()
    await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('Context · instructions · Workspace instructions · 3 lines')
    expect(terminal.lines().join('\n')).not.toContain('CONTEXT_BODY_HIDDEN')

    terminal.send('\u000F')
    await shell.whenIdle(); await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('CONTEXT_BODY_HIDDEN')
    terminal.send('\u000F\u000F')
    await shell.whenIdle()
    shell.dispatch({ type: 'open-history' })
    shell.dispatch({ type: 'overlay-submit' })
    await shell.whenIdle(); await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('CONTEXT_BODY_HIDDEN')
    await shell.dispose()
  })

  it('sanitizes hostile presenter text before it reaches the terminal', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
      initialCells: [{
        key: 'tool:hostile', kind: 'tool', pending: false, text: 'fallback',
        tool: {
          card: 'generic',
          title: '\u001B]0;stolen title\u0007\u009B2Jhostile\u0007',
          body: 'safe\u0000body',
        },
      }],
    })
    shell.start()
    terminal.send('\u000F')
    await shell.whenIdle()
    await terminal.flush()
    const screen = terminal.lines().join('\n')
    expect(screen).toContain('dashi')
    expect(screen).toContain('hostile')
    expect(screen).toContain('safe body')
    expect(terminal.output).not.toContain('\u001B]0;stolen title')
    expect(terminal.output).not.toContain('\u009B2J')
    await shell.dispose()
  })

  it('lets the decision head own input focus', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
    })
    shell.start()
    const answer = shell.requestDecision({
      cursor: 0, id: 'approval', kind: 'approval', owner: { id: 'session-1' },
      prompt: 'Run command outside the workspace?', toolName: 'bash',
    })
    await shell.whenIdle()
    await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('Allow once')
    terminal.send('\u000F')
    await shell.whenIdle()
    expect(shell.readState().toolMode).toBe('collapsed')
    terminal.send('\u001B[B')
    terminal.send('\r')
    await shell.whenIdle()
    await expect(answer).resolves.toBe('rejected')
    await shell.dispose()
  })

  it('restores a composer draft after an approval preempts it', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
    })
    shell.start()
    terminal.send('draft survives')
    await shell.whenIdle()
    const answer = shell.requestDecision({
      cursor: 0, id: 'approval-with-draft', kind: 'approval', owner: { id: 'session-1' },
      prompt: 'Allow this call?', toolName: 'bash',
    })
    await shell.whenIdle()
    terminal.send('\r')
    await shell.whenIdle()
    await expect(answer).resolves.toBe('allowed-once')
    expect(shell.readState().composer).toBe('draft survives')
    await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('draft survives')
    await shell.dispose()
  })

  for (const columns of [48, 80]) {
    it(`renders completion and every Phase A picker at ${columns} columns`, async () => {
      const terminal = new ScreenTerminal(columns, 24)
      const shell = createTerminalShell({
        createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
        cwd: '/work', exit: () => {}, inline: false,
      })
      shell.start()
      shell.dispatch({ type: 'open-overlay', overlay: {
        cursor: 0,
        kind: 'list',
        options: [
          { group: 'Commands', label: '/status', detail: 'Show session facts', value: { kind: 'insert', text: '/status ' } },
          { group: 'Skills', label: '/review', detail: 'Review changes', value: { kind: 'insert', text: '/review ' } },
        ],
        purpose: 'completion',
        title: 'Complete',
      } })
      await shell.whenIdle()
      await terminal.flush()
      expect(terminal.lines().join('\n')).toContain('Commands')
      expect(terminal.lines().join('\n')).toContain('Skills')

      for (const [purpose, title, label, value] of [
        ['resume', 'Resume session', 'Named session', { kind: 'resume', sessionId: 'session-a' }],
        ['model', 'Model', 'Replay · Recorded', { kind: 'model', model: 'recorded', provider: 'replay' }],
        ['permission', 'Permission preset', 'workspace-write', { kind: 'permission', preset: 'workspace-write' }],
      ] as const) {
        shell.dispatch({ type: 'open-overlay', overlay: {
          cursor: 0, kind: 'list', options: [{ label, value }], purpose, title,
        } })
        await shell.whenIdle()
        await terminal.flush()
        const screen = terminal.lines().join('\n')
        expect(screen).toContain(title)
        expect(screen).toContain(label)
      }
      await shell.dispose()
    })
  }

  it('writes sanitized OSC 52 for /copy and history y without a success notice', async () => {
    const terminal = new ScreenTerminal(80, 24)
    let renderer!: Renderer
    const shell = createTerminalShell({
      createView: bindings => {
        renderer = createRenderer({ ...bindings, inline: false, terminal, terminalType: 'xterm-256color' })
        return renderer
      },
      cwd: '/work', exit: () => {}, inline: false,
      initialCells: [
        { key: 'one', kind: 'assistant', text: 'safe\u001B]0;bad\u0007 answer' },
        { key: 'two', kind: 'assistant', pending: true, text: 'not complete' },
      ],
    })
    shell.start()
    const first = terminal.output.length
    shell.dispatch({ selection: 1, type: 'copy-assistant' })
    await shell.whenIdle()
    const firstOutput = terminal.output.slice(first)
    const copied = firstOutput.slice(firstOutput.indexOf('\u001B]52;c;') + 7, firstOutput.indexOf('\u0007'))
    expect(Buffer.from(copied, 'base64').toString()).toBe('safe answer')
    expect(shell.readState().cells.some(cell => cell.kind === 'error')).toBe(false)

    shell.dispatch({ type: 'open-history' })
    await shell.whenIdle()
    await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('History')
    const second = terminal.output.length
    terminal.send('y')
    await shell.whenIdle()
    const secondOutput = terminal.output.slice(second)
    const historyCopy = secondOutput.slice(secondOutput.indexOf('\u001B]52;c;') + 7, secondOutput.indexOf('\u0007'))
    expect(Buffer.from(historyCopy, 'base64').toString()).toBe('not complete')
    terminal.send('/')
    await shell.whenIdle()
    terminal.send('complete')
    await shell.whenIdle()
    await terminal.flush()
    expect(shell.readState().search).toMatchObject({ scope: 'history', query: 'complete' })
    expect(terminal.lines().join('\n')).toContain('Search history')
    const beforeOversize = terminal.output.length
    expect(renderer.copy('x'.repeat(64 * 1024 + 1))).toBe('too-large')
    expect(terminal.output.length).toBe(beforeOversize)
    await shell.dispose()
  })

  it('reports copy unavailable for a dumb terminal even when the terminal is injected', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({
        ...bindings, inline: false, terminal, terminalType: 'dumb',
      }),
      cwd: '/work', exit: () => {}, inline: false,
      initialCells: [{ key: 'one', kind: 'assistant', text: 'do not copy' }],
    })
    shell.start()
    const before = terminal.output.length
    shell.dispatch({ selection: 1, type: 'copy-assistant' })
    await shell.whenIdle()
    expect(terminal.output.slice(before)).not.toContain('\u001B]52;c;')
    expect(shell.readState().cells.at(-1)?.text).toBe('This terminal does not support OSC 52 copy.')
    await shell.dispose()
  })

  for (const inline of [false, true]) {
    it(`renders completed assistant Markdown in ${inline ? 'inline' : 'alternate'} mode at 80 columns`, async () => {
      const terminal = new ScreenTerminal(80, 40)
      const shell = createTerminalShell({
        createView: bindings => createRenderer({ ...bindings, inline, terminal }),
        cwd: '/work', exit: () => {}, inline, initialCells: codeBlockCells(),
      })
      shell.start()
      await terminal.flush()
      const screen = terminal.lines().join('\n')
      expect(screen).toContain('Markdown answer')
      expect(screen).not.toContain('# Markdown answer')
      expect(screen).toContain('Use bold, emphasis, and inline code.')
      expect(screen).not.toContain('**bold**')
      expect(screen).toContain('- first item')
      expect(screen).toContain('```typescript')
      expect(screen).toContain('const first = 1')
      expect(terminal.output).toContain('\u001B[1mbold\u001B[22m')
      expect(terminal.output).toContain('\u001B[3memphasis\u001B[23m')
      expect(terminal.output).toContain('\u001B[33minline code\u001B[0m')
      expect(terminal.output).toContain('\u001B[32mconst first = 1\u001B[0m')
      await shell.dispose()
    })
  }

  for (const accessible of [false, true]) {
    it(`keeps ${accessible ? 'accessible' : 'streaming'} assistant text plain`, async () => {
      const terminal = new ScreenTerminal(80, 24)
      const shell = createTerminalShell({
        accessible,
        createView: bindings => createRenderer({ ...bindings, accessible, inline: true, terminal }),
        cwd: '/work', exit: () => {}, inline: true,
        initialCells: [{ key: 'pending', kind: 'assistant', pending: !accessible, text: '# Raw **source** with `code`' }],
      })
      shell.start()
      await terminal.flush()
      expect(terminal.lines().join('\n')).toContain('# Raw **source** with `code`')
      await shell.dispose()
    })
  }

  it('offers fenced code blocks from a recorded assistant message and copies the selection', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal, terminalType: 'xterm-256color' }),
      cwd: '/work', exit: () => {}, inline: false, initialCells: codeBlockCells(),
    })
    shell.start()
    shell.dispatch({ selection: 'code', type: 'copy-assistant' })
    await shell.whenIdle(); await terminal.flush()
    const screen = terminal.lines().join('\n')
    expect(screen).toContain('Copy code block')
    expect(screen).toContain('typescript · const first = 1')
    expect(screen).toContain('bash · echo second')
    terminal.send('\u001B[B')
    await shell.whenIdle()
    expect(shell.readState().overlay).toMatchObject({ cursor: 1, purpose: 'copy' })
    const before = terminal.output.length
    terminal.send('\r')
    await shell.whenIdle()
    const output = terminal.output.slice(before)
    const encoded = output.slice(output.indexOf('\u001B]52;c;') + 7, output.indexOf('\u0007'))
    expect(Buffer.from(encoded, 'base64').toString()).toBe('echo second\nprintf done')
    await shell.dispose()
  })

  it('searches the loaded transcript, reports counts, and restores the draft', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
      initialCells: [
        { key: 'one', kind: 'user', text: 'needle one' },
        { key: 'two', kind: 'assistant', text: 'needle two' },
      ],
    })
    shell.start()
    terminal.send('keep draft')
    terminal.send('\u0006')
    await shell.whenIdle()
    terminal.send('needle')
    await shell.whenIdle()
    await terminal.flush()
    expect(shell.readState().search?.matches).toEqual([0, 1])
    expect(terminal.lines().join('\n')).toContain('1/2')
    terminal.send('\r')
    await shell.whenIdle()
    expect(shell.readState().search?.cursor).toBe(1)
    terminal.send('\u001B')
    await shell.whenIdle()
    expect(shell.readState().composer).toBe('keep draft')
    await shell.dispose()
  })

  it('opens history for inline PageUp and Ctrl+Home while full screen keeps viewport scrolling', async () => {
    for (const key of ['\u001B[5~', '\u001B[1;5H']) {
      const terminal = new ScreenTerminal(80, 24)
      const shell = createTerminalShell({
        createView: bindings => createRenderer({ ...bindings, inline: true, terminal }),
        cwd: '/work', exit: () => {}, inline: true,
        initialCells: [
          { key: 'one', kind: 'user', text: 'first' },
          { key: 'two', kind: 'assistant', text: 'second' },
        ],
      })
      shell.start()
      terminal.send(key)
      await shell.whenIdle()
      expect(shell.readState().overlay).toMatchObject({ kind: 'history' })
      expect(shell.readState().scrollOffset).toBe(0)
      await shell.dispose()
    }

    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
      initialCells: [
        { key: 'one', kind: 'user', text: 'first' },
        { key: 'two', kind: 'assistant', text: 'second' },
      ],
    })
    shell.start()
    terminal.send('\u001B[5~')
    await shell.whenIdle()
    expect(shell.readState().overlay).toBeUndefined()
    await shell.dispose()
  })

  it('shows a new-output marker while the viewport is away from the tail', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const cells = Array.from({ length: 20 }, (_, index) => ({
      key: String(index), kind: 'assistant' as const, text: `answer ${String(index)}`,
    }))
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false, initialCells: cells,
    })
    shell.start()
    shell.dispatch({ type: 'scroll', direction: 'page-up' })
    shell.dispatch({ type: 'transcript-changed', cells: [
      ...cells, { key: 'new', kind: 'assistant', text: 'new answer' },
    ] })
    await shell.whenIdle()
    await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('↓ 1 new output · Ctrl+End')
    await shell.dispose()
  })

  it('materializes only viewport plus overscan and keeps 200k-cell redraw p95 below 25 ms', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const cells = Array.from({ length: 200_000 }, (_, index) => ({
      key: String(index), kind: 'assistant' as const, text: `answer ${String(index)}`,
    }))
    let renderer!: Renderer
    const shell = createTerminalShell({
      createView: bindings => {
        renderer = createRenderer({ ...bindings, inline: false, terminal })
        return renderer
      },
      cwd: '/work', exit: () => {}, inline: false, initialCells: cells,
    })
    shell.start()
    await shell.whenIdle()
    const heapBefore = process.memoryUsage().heapUsed
    shell.dispatch({ type: 'scroll', direction: 'home' })
    await shell.whenIdle()
    expect(shell.readState().scrollOffset).toBe(199_999)
    expect(renderer.materializedCells()).toBeLessThanOrEqual(32)
    const samples: number[] = []
    for (let index = 0; index < 25; index++) {
      const start = performance.now()
      terminal.send('x')
      await shell.whenIdle()
      samples.push(performance.now() - start)
    }
    const p95 = percentile95(samples)
    const heapDelta = Math.max(0, process.memoryUsage().heapUsed - heapBefore)
    report('composer-200k-p95', p95, 'ms')
    report('paged-200k-heap-delta', heapDelta / (1024 * 1024), 'MiB')
    expect(p95).toBeLessThan(testCeiling(25))
    expect(heapDelta).toBeLessThan(testCeiling(64 * 1024 * 1024))
    await shell.dispose()
  })

  it('keeps normal composer redraw p95 below 16 ms', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
      initialCells: Array.from({ length: 100 }, (_, index) => ({
        key: String(index), kind: 'assistant' as const, text: `answer ${String(index)}`,
      })),
    })
    shell.start()
    const samples: number[] = []
    for (let index = 0; index < 25; index++) {
      const start = performance.now()
      terminal.send('x')
      await shell.whenIdle()
      samples.push(performance.now() - start)
    }
    const p95 = percentile95(samples)
    report('composer-normal-p95', p95, 'ms')
    expect(p95).toBeLessThan(testCeiling(16))
    await shell.dispose()
  })

  it('renders first rows from a warm 1k-session catalog within 150 ms', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
    })
    shell.start()
    const overlay = sessionOverlay(Array.from({ length: 1_000 }, (_, index) => ({
      blank: false,
      cwd: `/work/${String(index)}`,
      running: false,
      sessionId: `session-${String(index).padStart(4, '0')}`,
      updatedAt: index,
      projections: { asOfSeq: 1, values: { title: `Session ${String(index)}` } },
    })) as never, 'none')
    const start = performance.now()
    shell.dispatch({ type: 'open-overlay', overlay })
    await shell.whenIdle()
    await terminal.flush()
    const elapsed = performance.now() - start
    report('warm-1k-session-first-rows', elapsed, 'ms')
    expect(elapsed).toBeLessThan(testCeiling(150))
    expect(terminal.lines().join('\n')).toContain('Session 0')
    await shell.dispose()
  })

  it('renders context and activity rows and opens their shared details overlay', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const now = Date.now()
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
      initialRoot: {
        contextPercent: 42, cwd: '/work', id: 'session', model: 'm', status: 'idle',
        jobs: [{ id: 'bash-1', kind: 'bash', label: 'build', startedAt: now - 2_000, status: 'running' }],
        subagents: [{
          active: { since: now - 3_000, through: now }, elapsedMs: 1_000, id: 'child',
          label: 'research', mode: 'continuable', state: 'running', summary: 'Found the cause', tokens: 20,
        }],
      },
    })
    shell.start()
    await terminal.flush()
    let screen = terminal.lines().join('\n')
    expect(screen).toContain('42% context')
    expect(screen).toContain('Subagent · research · running')
    expect(screen).toContain('Job · build · running')
    terminal.send('\u0002')
    await shell.whenIdle()
    await terminal.flush()
    screen = terminal.lines().join('\n')
    expect(screen).toContain('Activity')
    expect(screen).toContain('Found the cause')
    terminal.send('\r')
    await shell.whenIdle()
    await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('tokens: 20')
    await shell.dispose()
  })

  it('renders plan-review intent through the existing decision overlay', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const shell = createTerminalShell({
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal }),
      cwd: '/work', exit: () => {}, inline: false,
    })
    shell.start()
    const answer = shell.requestDecision({
      answers: [], cursor: 0, custom: '', id: 'plan', index: 0, kind: 'question', owner: { id: 'session' },
      questions: [{
        detail: '# Ship it\n\nUse the existing service.', header: 'ignored', id: 'plan-review',
        intent: { approve: 'Approve', kind: 'plan-review' }, multiSelect: false,
        options: [{ label: 'Approve' }, { label: 'Keep planning' }], question: 'Approve this plan?',
      }], selected: [],
    })
    await shell.whenIdle()
    await terminal.flush()
    const screen = terminal.lines().join('\n')
    expect(screen).toContain('Plan review')
    expect(screen).toContain('# Ship it')
    terminal.send('\r')
    await shell.whenIdle()
    await expect(answer).resolves.toEqual({ answers: [{ id: 'plan-review', selected: ['Approve'] }] })
    await shell.dispose()
  })

  it('announces accessible transcript states, overlays, counts, and selections in reading order', async () => {
    const terminal = new ScreenTerminal(80, 24)
    const now = Date.now()
    const shell = createTerminalShell({
      accessible: true,
      createView: bindings => createRenderer({ ...bindings, accessible: true, inline: true, terminal }),
      cwd: '/work', exit: () => {}, inline: true,
      initialCells: [
        { key: 'tool', kind: 'tool', pending: false, text: 'Read file', tool: { card: 'read', title: 'Read file' } },
        { key: 'todo', kind: 'todo', text: 'Todos\n✓ inspect\n● test\n○ ship' },
        { key: 'outcome', kind: 'outcome', text: 'completed' },
      ],
      initialRoot: {
        cwd: '/work', id: 'session', model: 'recorded', status: 'idle',
        jobs: [{ id: 'job', kind: 'bash', label: 'tests', startedAt: now, status: 'running' }],
      },
    })
    shell.start()
    await terminal.flush()
    let screen = terminal.lines().join('\n')
    expect(screen).toContain('[done] Read file')
    expect(screen).toContain('[done] inspect')
    expect(screen).toContain('[active] test')
    expect(screen).toContain('[pending] ship')
    expect(screen).toContain('[done] completed')

    shell.dispatch({ type: 'open-overlay', overlay: {
      cursor: 0, kind: 'list', options: [
        { label: 'Recorded', value: { kind: 'model', model: 'recorded', provider: 'replay' } },
        { label: 'Other', value: { kind: 'model', model: 'other', provider: 'replay' } },
      ], purpose: 'model', title: 'Model',
    } })
    await shell.whenIdle(); await terminal.flush()
    screen = terminal.lines().join('\n')
    expect(screen).toContain('Model · 2 items · selected 1: Recorded')
    shell.dispatch({ type: 'overlay-close' })

    shell.dispatch({ type: 'open-history' })
    await shell.whenIdle(); await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('History · 3 items · selected 3: outcome · completed')
    shell.dispatch({ type: 'overlay-close' })

    shell.dispatch({ type: 'open-details' })
    await shell.whenIdle(); await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('Activity · 1 item · selected 1: Job · tests · running')
    shell.dispatch({ type: 'overlay-close' })

    shell.dispatch({ type: 'search-open', scope: 'transcript' })
    await shell.whenIdle()
    shell.dispatch({ type: 'composer-changed', text: 'completed' })
    await shell.whenIdle(); await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('Search transcript · 1 item · selected 1: match 1')
    shell.dispatch({ type: 'search-close' })

    const answer = shell.requestDecision({
      cursor: 0, id: 'approval-accessible', kind: 'approval', owner: { id: 'session' },
      prompt: 'Run tests?', toolName: 'bash',
    })
    await shell.whenIdle(); await terminal.flush()
    expect(terminal.lines().join('\n')).toContain('Approval · bash · 3 items · selected 1: Allow once')
    shell.dispatch({ type: 'decision-submit' })
    await shell.whenIdle()
    await expect(answer).resolves.toBe('allowed-once')
    expect(terminal.output).not.toMatch(/[\u2800-\u28ff]/u)
    await shell.dispose()
  })
})
