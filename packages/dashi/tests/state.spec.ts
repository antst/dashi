import { describe, expect, it } from 'vitest'
import { initialViewState, reduce, TURN_BELL_THRESHOLD_MS } from '../src/state.js'

describe('view-state reducer', () => {
  it('clears a draft before arming or exiting', () => {
    const base = { ...initialViewState('/work', false), composer: 'draft' }
    const [cleared, clearEffects] = reduce(base, { type: 'ctrl-c' })
    expect(cleared).toEqual({ ...base, composer: '' })
    expect(clearEffects).toEqual([{ type: 'set-composer', text: '' }, { type: 'redraw', force: false }])

    const [armed, armEffects] = reduce(cleared, { type: 'ctrl-c' })
    expect(armed.exitArmed).toBe(true)
    expect(armEffects).toEqual([{ type: 'exit-timer', armed: true }, { type: 'redraw', force: false }])
    expect(reduce(armed, { type: 'ctrl-c' })[1]).toEqual([{ type: 'exit' }])
  })

  it('disarms the exit chord on subsequent input', () => {
    const base = initialViewState('/work', false, {
      cwd: '/work', id: 'session-1', model: 'm', status: 'idle',
    })
    const [armed] = reduce(base, { type: 'ctrl-d' })
    const [next, effects] = reduce(armed, { type: 'composer-changed', text: 'x' })
    expect(next).toEqual({ ...armed, composer: 'x', exitArmed: false })
    expect(effects).toEqual([{ type: 'redraw', force: false }])
  })

  it('arms Ctrl+D once and shares the arm with Ctrl+C', () => {
    const base = initialViewState('/work', false, {
      cwd: '/work', id: 'session-1', model: 'm', status: 'idle',
    })
    const [armed, effects] = reduce(base, { type: 'ctrl-d' })
    expect(armed.exitArmed).toBe(true)
    expect(effects).toEqual([{ type: 'exit-timer', armed: true }, { type: 'redraw', force: false }])
    expect(reduce(armed, { type: 'ctrl-d' })[1]).toEqual([{ type: 'exit' }])
    const [mixed] = reduce(base, { type: 'ctrl-c' })
    expect(reduce(mixed, { type: 'ctrl-d' })[1]).toEqual([{ type: 'exit' }])
  })

  it('disarms through the timer action and re-arms after expiry', () => {
    const base = initialViewState('/work', false, {
      cwd: '/work', id: 'session-1', model: 'm', status: 'idle',
    })
    const [armed] = reduce(base, { type: 'ctrl-d' })
    const [expired, effects] = reduce(armed, { type: 'disarm-exit' })
    expect(expired.exitArmed).toBe(false)
    expect(effects).toEqual([{ type: 'exit-timer', armed: false }, { type: 'redraw', force: false }])
    expect(reduce(expired, { type: 'ctrl-d' })[1]).toEqual([
      { type: 'exit-timer', armed: true }, { type: 'redraw', force: false },
    ])
  })

  it('keeps Ctrl+D behavior outside an idle empty composer', () => {
    const idle = initialViewState('/work', false, {
      cwd: '/work', id: 'session-1', model: 'm', status: 'idle',
    })
    const draft = { ...idle, composer: 'keep me' }
    expect(reduce(draft, { type: 'ctrl-d' })).toEqual([draft, []])
    const running = initialViewState('/work', false, {
      cwd: '/work', id: 'session-1', model: 'm', status: 'running',
    })
    expect(reduce(running, { type: 'ctrl-d' })[1]).toEqual([{ type: 'exit' }])
  })

  it('interrupts a running root without clearing its draft', () => {
    const base = {
      ...initialViewState('/work', false, { cwd: '/work', id: 'session-1', model: 'm', status: 'running' }),
      composer: 'keep me',
    }
    const [next, effects] = reduce(base, { type: 'ctrl-c' })
    expect(next).toBe(base)
    expect(effects).toEqual([{ type: 'interrupt' }])
    expect(reduce(base, { type: 'escape' })[1]).toEqual([{ type: 'interrupt' }])
  })

  it('requests clipboard image paste only when the composer owns input', () => {
    const base = initialViewState('/work', false)
    expect(reduce(base, { type: 'clipboard-paste' })[1]).toEqual([{ type: 'clipboard-image' }])
    const [covered] = reduce(base, { type: 'help' })
    expect(reduce(covered, { type: 'clipboard-paste' })[1]).toEqual([])
  })

  it('cycles one global card mode and toggles the running send mode', () => {
    const base = initialViewState('/work', false, {
      cwd: '/work', id: 'session-1', model: 'm', status: 'running',
    })
    const [expanded] = reduce(base, { type: 'toggle-tool-mode' })
    const [hidden] = reduce(expanded, { type: 'toggle-tool-mode' })
    const [collapsed] = reduce(hidden, { type: 'toggle-tool-mode' })
    expect([expanded.toolMode, hidden.toolMode, collapsed.toolMode]).toEqual(['expanded', 'hidden', 'collapsed'])

    const [queued] = reduce(base, { type: 'toggle-send-mode' })
    expect(queued.sendMode).toBe('next-turn')
    expect(reduce({ ...queued, composer: 'later' }, { type: 'submit' })[1]).toContainEqual({
      type: 'submit', attachments: [], mode: 'next-turn', text: 'later',
    })
  })

  it('answers a question batch including custom text from the sole FIFO head', () => {
    const base = initialViewState('/work', false)
    const decision = {
      answers: [], cursor: 0, custom: '', id: 'q1', index: 0, kind: 'question' as const,
      owner: { id: 'session-1' }, selected: [],
      questions: [
        { id: 'manager', multiSelect: false, options: [{ label: 'pnpm' }, { label: 'npm' }], question: 'Which?' },
        { id: 'why', multiSelect: false, options: [], question: 'Why?' },
      ],
    }
    const [asked] = reduce(base, { type: 'decision-enqueued', decision })
    const [second, firstEffects] = reduce(asked, { type: 'decision-submit' })
    expect(firstEffects).toContainEqual({ type: 'set-composer', text: '' })
    const [drafted] = reduce(second, { type: 'composer-changed', text: 'fast installs' })
    const [answered, effects] = reduce(drafted, { type: 'decision-submit' })
    expect(answered.decisions).toEqual([])
    expect(effects).toContainEqual({
      type: 'settle-decision', id: 'q1', answer: { answers: [
        { id: 'manager', selected: ['pnpm'] },
        { id: 'why', selected: [], custom: 'fast installs' },
      ] },
    })
  })

  it('rings once for a new running decision and for a completed long turn', () => {
    const running = initialViewState('/work', false, {
      cwd: '/work', id: 'session-1', model: 'm', status: 'running',
    })
    const decision = {
      cursor: 0, id: 'approval', kind: 'approval' as const, owner: { id: 'session-1' },
      prompt: 'Allow?', toolName: 'bash',
    }
    const [asked, effects] = reduce(running, { type: 'decision-enqueued', decision })
    expect(effects.filter(effect => effect.type === 'bell')).toHaveLength(1)
    expect(reduce(asked, { type: 'decision-enqueued', decision })[1]).toEqual([])
    expect(reduce(running, {
      type: 'turn-ended', durationMs: TURN_BELL_THRESHOLD_MS - 1, rootId: 'session-1',
    })[1]).toEqual([])
    expect(reduce(running, {
      type: 'turn-ended', durationMs: TURN_BELL_THRESHOLD_MS, rootId: 'session-1',
    })[1]).toEqual([{ type: 'bell' }])
  })

  it('inserts a completion without submitting it', () => {
    const base = { ...initialViewState('/work', false), composer: '/sta' }
    expect(reduce(base, { type: 'request-completion', caret: 4 })[1]).toEqual([{
      type: 'complete', query: '/sta', caret: 4,
    }])
    const [listed] = reduce(base, {
      type: 'completion-ready', query: '/sta', options: [
        { group: 'Commands', label: '/status', value: { kind: 'insert', text: '/status ' } },
      ],
    })
    const [inserted, effects] = reduce(listed, { type: 'overlay-submit' })
    expect(inserted.composer).toBe('/status ')
    expect(inserted.overlay).toBeUndefined()
    expect(effects).toEqual([
      { type: 'set-composer', text: '/status ' }, { type: 'redraw', force: false },
    ])
    expect(effects.some(effect => effect.type === 'submit')).toBe(false)
  })

  it('attaches an image completion and submits an image-only draft', () => {
    const rooted = initialViewState('/work', false, {
      cwd: '/work', id: 'current', model: 'm', status: 'idle',
    })
    const source = '@shot'
    const [listed] = reduce({ ...rooted, composer: source }, {
      type: 'completion-ready', query: source, options: [{
        group: 'Files', label: 'shot.png', value: {
          kind: 'attach', path: 'shot.png', source, text: '',
        },
      }],
    })
    const [loading, effects] = reduce(listed, { type: 'overlay-submit' })
    expect(effects).toContainEqual({ type: 'attach', path: 'shot.png', source, text: '' })
    const attachment = {
      bytes: 3, data: Uint8Array.of(1, 2, 3), mediaType: 'image/png' as const,
      name: 'shot.png', path: '/work/shot.png',
    }
    const [attached] = reduce(loading, { type: 'attachment-added', attachment, source, text: '' })
    expect(attached.attachments).toEqual([attachment])
    const [submitted, submitEffects] = reduce(attached, { type: 'submit' })
    expect(submitted.attachments).toEqual([])
    expect(submitEffects).toContainEqual({
      type: 'submit', attachments: [attachment], mode: 'next-turn', text: '',
    })
  })

  it('stashes, swaps, and restores text, cursor, and attachments in process state', () => {
    const attachment = {
      bytes: 3, data: Uint8Array.of(1, 2, 3), mediaType: 'image/png' as const,
      name: 'shot.png', path: '/work/shot.png',
    }
    const base = {
      ...initialViewState('/work', false), attachments: [attachment], composer: 'first\ndraft',
    }
    const cursor = { col: 2, line: 1 }
    const [stashed] = reduce(base, { type: 'stash-toggle', cursor })
    expect(stashed).toMatchObject({ attachments: [], composer: '', stash: {
      attachments: [attachment], composer: 'first\ndraft', cursor,
    } })
    const [restored, effects] = reduce(stashed, { type: 'stash-toggle', cursor: { col: 0, line: 0 } })
    expect(restored.attachments).toEqual([attachment])
    expect(restored.composer).toBe('first\ndraft')
    expect(restored.stash).toBeUndefined()
    expect(effects).toContainEqual({ type: 'set-composer', text: 'first\ndraft', cursor })
  })

  it('requires confirmation before activating a never-approval preset', () => {
    const base = initialViewState('/work', false)
    const [picker] = reduce(base, { type: 'open-overlay', overlay: {
      cursor: 0,
      kind: 'list',
      options: [{
        confirmDetail: ['Sandbox: danger-full-access', 'Approval: never'],
        danger: true,
        label: 'danger-full-access',
        value: { kind: 'permission', preset: 'danger-full-access' },
      }],
      purpose: 'permission',
      title: 'Permission preset',
    } })
    const [confirm, firstEffects] = reduce(picker, { type: 'overlay-submit' })
    expect(confirm.overlay).toMatchObject({ kind: 'confirm', cursor: 1 })
    expect(firstEffects).toEqual([{ type: 'redraw', force: false }])
    const [cancelled, cancelEffects] = reduce(confirm, { type: 'overlay-submit' })
    expect(cancelled.overlay).toBeUndefined()
    expect(cancelEffects.some(effect => effect.type === 'activate-overlay')).toBe(false)
  })

  it('lets a decision preempt a picker and ignores stale root updates', () => {
    const rooted = initialViewState('/work', false, {
      cwd: '/work', id: 'current', model: 'old', status: 'idle',
    })
    const [picked] = reduce(rooted, { type: 'open-overlay', overlay: {
      cursor: 0, kind: 'list', options: [], purpose: 'resume', title: 'Resume session',
    } })
    const [deciding] = reduce(picked, { type: 'decision-enqueued', decision: {
      cursor: 0, id: 'approval', kind: 'approval', owner: { id: 'current' },
      prompt: 'Allow?', toolName: 'bash',
    } })
    expect(deciding.overlay).toBeUndefined()
    const [unchanged] = reduce(deciding, {
      type: 'root-model', model: 'stale', provider: 'fixture', rootId: 'previous',
    })
    expect(unchanged.root?.model).toBe('old')
  })

  it('recalls current prompts without submitting and restores the draft', () => {
    const base = {
      ...initialViewState('/work', false, {
        cwd: '/work', id: 'current', model: 'm', status: 'idle' as const,
      }, [], ['one', 'two']),
      composer: 'draft',
    }
    const [two, firstEffects] = reduce(base, { type: 'recall-move', offset: -1 })
    expect(two.composer).toBe('two')
    expect(firstEffects).toContainEqual({ type: 'set-composer', text: 'two' })
    expect(firstEffects.some(effect => effect.type === 'submit')).toBe(false)
    const [one] = reduce(two, { type: 'recall-move', offset: -1 })
    expect(one.composer).toBe('one')
    const [backToTwo] = reduce(one, { type: 'recall-move', offset: 1 })
    const [draft] = reduce(backToTwo, { type: 'recall-move', offset: 1 })
    expect(draft.composer).toBe('draft')
    expect(draft.recall).toBeUndefined()
  })

  it('opens rewind when empty and clears a draft into recall on double Escape', () => {
    const idle = initialViewState('/work', false, {
      cwd: '/work', id: 'current', model: 'm', status: 'idle',
    })
    const [armed, firstEffects] = reduce(idle, { type: 'escape' })
    expect(armed.rewindArmed).toBe(true)
    expect(firstEffects).toEqual([{ type: 'redraw', force: false }])
    expect(reduce(armed, { type: 'escape' })[1]).toContainEqual({
      type: 'activate-overlay', value: { kind: 'open-rewind' },
    })

    const running = { ...idle, root: { ...idle.root!, status: 'running' as const } }
    expect(reduce(running, { type: 'escape' })[1]).toEqual([{ type: 'interrupt' }])
    const [draftArmed] = reduce({ ...idle, attachments: [{ name: 'a' } as never], composer: 'draft' }, { type: 'escape' })
    const [cleared, clearEffects] = reduce(draftArmed, { type: 'escape' })
    expect(cleared).toMatchObject({ attachments: [], composer: '', prompts: ['draft'], rewindArmed: false })
    expect(clearEffects).toContainEqual({ type: 'set-composer', text: '' })
    const [recalled] = reduce(cleared, { type: 'recall-move', offset: -1 })
    expect(recalled.composer).toBe('draft')
  })

  it('requests same-cwd search without changing or submitting the composer', () => {
    const base = {
      ...initialViewState('/work', false, {
        cwd: '/work', id: 'current', model: 'm', status: 'idle' as const,
      }),
      composer: 'needle',
    }
    const [next, effects] = reduce(base, { type: 'request-search' })
    expect(next).toBe(base)
    expect(effects).toEqual([{ type: 'search', query: 'needle', rootId: 'current' }])
  })

  it('pages through loaded history and requests older controller pages only at the boundary', () => {
    const cells = Array.from({ length: 20 }, (_, index) => ({
      key: String(index), kind: 'assistant' as const, text: `answer ${String(index)}`,
    }))
    const base = initialViewState('/work', false, {
      cwd: '/work', id: 'current', model: 'm', status: 'idle',
    }, cells, [], true)
    const [first, firstEffects] = reduce(base, { type: 'scroll', direction: 'page-up' })
    expect(first.scrollOffset).toBe(8)
    expect(firstEffects).not.toContainEqual({ type: 'load-history', rootId: 'current' })
    const [second] = reduce(first, { type: 'scroll', direction: 'page-up' })
    const [edge, edgeEffects] = reduce(second, { type: 'scroll', direction: 'page-up' })
    expect(edge.scrollOffset).toBe(19)
    expect(edgeEffects).toContainEqual({ type: 'load-history', rootId: 'current' })

    const older = Array.from({ length: 10 }, (_, index) => ({
      key: `old-${String(index)}`, kind: 'user' as const, text: `prompt ${String(index)}`,
    }))
    const [paged] = reduce(edge, {
      type: 'history-page', cells: [...older, ...cells], hasMore: false, rootId: 'current',
    })
    expect(paged.scrollOffset).toBe(29)
    expect(paged.historyHasMore).toBe(false)

    const [wheel] = reduce(base, { type: 'scroll', direction: 'page-up', lines: 3 })
    expect(wheel.scrollOffset).toBe(3)
  })

  it('holds the viewport and counts output until Ctrl+End follows the tail', () => {
    const cells = Array.from({ length: 12 }, (_, index) => ({
      key: String(index), kind: 'assistant' as const, text: `answer ${String(index)}`,
    }))
    const base = { ...initialViewState('/work', false), cells, scrollOffset: 8 }
    const [updated] = reduce(base, { type: 'transcript-changed', cells: [
      ...cells, { key: '12', kind: 'assistant', text: 'new answer' },
    ] })
    expect(updated.scrollOffset).toBe(9)
    expect(updated.newOutput).toBe(1)
    const [streamed] = reduce(updated, { type: 'transcript-changed', cells: updated.cells })
    expect(streamed.newOutput).toBe(2)
    const [tail] = reduce(streamed, { type: 'scroll', direction: 'end' })
    expect(tail.scrollOffset).toBe(0)
    expect(tail.newOutput).toBe(0)
  })

  it('searches loaded transcript cells while preserving the composer draft', () => {
    const base = {
      ...initialViewState('/work', false), composer: 'draft', cells: [
        { key: 'a', kind: 'assistant' as const, text: 'first needle' },
        { key: 'b', kind: 'tool' as const, text: 'tool', tool: {
          card: 'generic' as const, title: 'Inspect', body: 'second needle',
        } },
      ],
    }
    const [opened, effects] = reduce(base, { type: 'search-open', scope: 'transcript' })
    expect(effects).toContainEqual({ type: 'set-composer', text: '' })
    const [matched] = reduce(opened, { type: 'composer-changed', text: 'needle' })
    expect(matched.search).toMatchObject({ cursor: 0, matches: [0, 1], query: 'needle' })
    const [next] = reduce(matched, { type: 'search-move', offset: 1 })
    expect(next.search?.cursor).toBe(1)
    const [closed, closeEffects] = reduce(next, { type: 'search-close' })
    expect(closed.composer).toBe('draft')
    expect(closeEffects).toContainEqual({ type: 'set-composer', text: 'draft' })
  })

  it('copies either the selected history cell or latest completed assistant text', () => {
    const cells = [
      { key: 'done', kind: 'assistant' as const, text: 'completed answer' },
      { key: 'live', kind: 'assistant' as const, pending: true, text: 'still streaming' },
    ]
    const base = { ...initialViewState('/work', false), cells }
    expect(reduce(base, { selection: 1, type: 'copy-assistant' })[1]).toEqual([
      { type: 'copy', text: 'completed answer' },
    ])
    expect(reduce(base, { selection: 2, type: 'copy-assistant' })[1]).toEqual([])
    const [history] = reduce(base, { type: 'open-history' })
    expect(reduce(history, { type: 'history-copy' })[1]).toEqual([
      { type: 'copy', text: 'still streaming' },
    ])
  })

  it('opens one activity details overlay over DSH job and subagent rows', () => {
    const base = initialViewState('/work', false, {
      cwd: '/work', id: 'current', model: 'm', status: 'idle',
      jobs: [{ id: 'job-1', kind: 'bash', label: 'build', startedAt: 1, status: 'running' }],
      subagents: [{ id: 'child', label: 'research', mode: 'continuable', state: 'inactive' }],
    })
    const [opened] = reduce(base, { type: 'open-details' })
    expect(opened.overlay).toEqual({ cursor: 0, expanded: false, kind: 'details' })
    const [moved] = reduce(opened, { type: 'overlay-move', offset: 1 })
    expect(moved.overlay).toEqual({ cursor: 1, expanded: false, kind: 'details' })
    const [expanded] = reduce(moved, { type: 'overlay-submit' })
    expect(expanded.overlay).toEqual({ cursor: 1, expanded: true, kind: 'details' })
  })

  it('replaces controller presentation facts and can remove unavailable context pressure', () => {
    const base = initialViewState('/work', false, {
      contextPercent: 80, cwd: '/work', id: 'current', model: 'm', status: 'idle',
      jobs: [], subagents: [],
    })
    const [jobs] = reduce(base, { type: 'root-presentation', rootId: 'current', jobs: [{
      id: 'job-1', kind: 'bash', label: 'build', startedAt: 1, status: 'completed', finishedAt: 2,
    }] })
    expect(jobs.root).toMatchObject({ contextPercent: 80, jobs: [{ id: 'job-1' }] })
    const [cleared] = reduce(jobs, { type: 'root-presentation', contextPercent: null, rootId: 'current' })
    expect(cleared.root).not.toHaveProperty('contextPercent')
  })
})
