import { isKeyRelease, matchesKey, type TUI, type TuiInputListenerResult } from '@earendil-works/pi-tui'
import { PAGE_CELLS, type ComposerCursor, type UiAction, type ViewState } from './state.js'

export interface InputBindings {
  readonly dispatch: (action: UiAction) => void
  readonly insertNewline?: () => void
  readonly readComposerCursor?: () => ComposerCursor
  readonly readState: () => ViewState
}

export function caretOffset(text: string, cursor: ComposerCursor): number {
  const lines = text.split('\n')
  let offset = 0
  for (let line = 0; line < cursor.line; line++) offset += (lines[line]?.length ?? 0) + 1
  return Math.min(text.length, offset + cursor.col)
}

export function installInput(tui: TUI, bindings: InputBindings): () => void {
  return tui.addInputListener((data): TuiInputListenerResult => {
    if (data.includes('\u001B[200~')) {
      const state = bindings.readState()
      const decision = state.decisions[0]
      const question = decision?.kind === 'question' ? decision.questions[decision.index] : undefined
      const customQuestion = question !== undefined && decision?.kind === 'question'
        && decision.cursor === question.options.length
      const completion = state.overlay?.kind === 'list' && state.overlay.purpose === 'completion'
      return customQuestion || state.search !== undefined || completion
        || decision === undefined && state.overlay === undefined ? undefined : { consume: true }
    }
    if (isKeyRelease(data)) return { consume: true }
    const state = bindings.readState()
    const ctrlC = matchesKey(data, 'ctrl+c')
    const ctrlD = matchesKey(data, 'ctrl+d')
    if ((state.rewindArmed && !matchesKey(data, 'escape')) || (state.exitArmed && !ctrlC && !ctrlD)) {
      bindings.dispatch({ type: 'disarm-exit' })
    }

    if (ctrlC) {
      bindings.dispatch({ type: 'ctrl-c' })
      return { consume: true }
    }
    const decision = bindings.readState().decisions[0]
    if (decision !== undefined) {
      const question = decision.kind === 'question' ? decision.questions[decision.index] : undefined
      const custom = question !== undefined && decision.cursor === question.options.length
      if (matchesKey(data, 'escape')) bindings.dispatch({ type: 'decision-cancel' })
      else if (matchesKey(data, 'up')) bindings.dispatch({ type: 'decision-move', offset: -1 })
      else if (matchesKey(data, 'down')) bindings.dispatch({ type: 'decision-move', offset: 1 })
      else if (matchesKey(data, 'enter')) bindings.dispatch({ type: 'decision-submit' })
      else if (custom) return undefined
      else if (matchesKey(data, 'space')) bindings.dispatch({ type: 'decision-toggle' })
      else {
        for (let number = 1; number <= 9; number++) {
          if (!matchesKey(data, String(number) as '1')) continue
          bindings.dispatch({ type: 'decision-number', number })
          break
        }
      }
      return { consume: true }
    }
    if (matchesKey(data, 'f1')) {
      bindings.dispatch({ type: 'help' })
      return { consume: true }
    }
    const search = bindings.readState().search
    if (search !== undefined) {
      if (matchesKey(data, 'escape')) bindings.dispatch({ type: 'search-close' })
      else if (matchesKey(data, 'enter') || matchesKey(data, 'down')) {
        bindings.dispatch({ type: 'search-move', offset: 1 })
      } else if (matchesKey(data, 'shift+enter') || matchesKey(data, 'up')) {
        bindings.dispatch({ type: 'search-move', offset: -1 })
      } else return undefined
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+f')) {
      bindings.dispatch({ type: 'search-open', scope: 'transcript' })
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+b')) {
      bindings.dispatch({ type: 'open-details' })
      return { consume: true }
    }
    if (matchesKey(data, 'shift+tab')) {
      bindings.dispatch({ type: 'cycle-permission' })
      return { consume: true }
    }
    const overlay = bindings.readState().overlay
    if (overlay !== undefined) {
      if (matchesKey(data, 'escape')) bindings.dispatch({ type: 'overlay-close' })
      else if (overlay.kind === 'history' && matchesKey(data, 'up')) bindings.dispatch({ type: 'history-move', offset: -1 })
      else if (overlay.kind === 'history' && matchesKey(data, 'down')) bindings.dispatch({ type: 'history-move', offset: 1 })
      else if (overlay.kind === 'history' && matchesKey(data, '/')) bindings.dispatch({ type: 'search-open', scope: 'history' })
      else if (overlay.kind === 'history' && matchesKey(data, 'y')) bindings.dispatch({ type: 'history-copy' })
      else if (overlay.kind === 'info' && matchesKey(data, 'pageUp')) bindings.dispatch({ type: 'overlay-move', offset: -PAGE_CELLS })
      else if (overlay.kind === 'info' && matchesKey(data, 'pageDown')) bindings.dispatch({ type: 'overlay-move', offset: PAGE_CELLS })
      else if (matchesKey(data, 'up')) bindings.dispatch({ type: 'overlay-move', offset: -1 })
      else if (matchesKey(data, 'down')) bindings.dispatch({ type: 'overlay-move', offset: 1 })
      else if (matchesKey(data, 'ctrl+o')) bindings.dispatch({ type: 'toggle-tool-mode' })
      else if (matchesKey(data, 'enter')) bindings.dispatch({ type: 'overlay-submit', execute: true })
      else if (matchesKey(data, 'tab')) bindings.dispatch({ type: 'overlay-submit' })
      else if (overlay.kind === 'list' && overlay.purpose === 'completion') {
        bindings.dispatch({ type: 'overlay-close' })
        return undefined
      } else {
        for (let number = 1; number <= 9; number++) {
          if (!matchesKey(data, String(number) as '1')) continue
          bindings.dispatch({ type: 'overlay-number', number })
          break
        }
      }
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+v')) {
      bindings.dispatch({ type: 'clipboard-paste' })
      return { consume: true }
    }
    if (matchesKey(data, 'pageUp')) {
      bindings.dispatch(bindings.readState().inline
        ? { type: 'open-history' }
        : { type: 'scroll', direction: 'page-up' })
      return { consume: true }
    }
    if (matchesKey(data, 'pageDown')) {
      bindings.dispatch({ type: 'scroll', direction: 'page-down' })
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+home')) {
      bindings.dispatch(bindings.readState().inline
        ? { type: 'open-history' }
        : { type: 'scroll', direction: 'home' })
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+end')) {
      bindings.dispatch({ type: 'scroll', direction: 'end' })
      return { consume: true }
    }
    if (matchesKey(data, 'tab')) {
      const state = bindings.readState()
      const cursor = bindings.readComposerCursor?.() ?? { col: state.composer.length, line: 0 }
      bindings.dispatch({ type: 'request-completion', caret: caretOffset(state.composer, cursor) })
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+r')) {
      bindings.dispatch({ type: 'request-search' })
      return { consume: true }
    }
    if (matchesKey(data, 'up') && !bindings.readState().composer.includes('\n')) {
      bindings.dispatch({ type: 'recall-move', offset: -1 })
      return { consume: true }
    }
    if (matchesKey(data, 'down') && bindings.readState().recall !== undefined) {
      bindings.dispatch({ type: 'recall-move', offset: 1 })
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+o')) {
      bindings.dispatch({ type: 'toggle-tool-mode' })
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+t')) {
      bindings.dispatch({ type: 'toggle-send-mode' })
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+s')) {
      const state = bindings.readState()
      bindings.dispatch({
        type: 'stash-toggle', cursor: bindings.readComposerCursor?.() ?? { col: state.composer.length, line: 0 },
      })
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+g')) {
      bindings.dispatch({ type: 'external-edit' })
      return { consume: true }
    }
    if (matchesKey(data, 'backspace')) {
      const state = bindings.readState()
      if (state.composer === '' && state.attachments.length > 0) {
        bindings.dispatch({ type: 'attachment-remove', index: state.attachments.length - 1 })
        return { consume: true }
      }
    }
    if (data === '\n' || matchesKey(data, 'ctrl+j')
      || matchesKey(data, 'shift+enter') || matchesKey(data, 'alt+enter')) {
      bindings.insertNewline?.()
      return { consume: true }
    }
    if (matchesKey(data, 'enter')) {
      bindings.dispatch({ type: 'submit' })
      return { consume: true }
    }
    if (ctrlD && bindings.readState().composer === '') {
      bindings.dispatch({ type: 'ctrl-d' })
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+l')) {
      bindings.dispatch({ type: 'redraw' })
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+z')) {
      bindings.dispatch({ type: 'suspend' })
      return { consume: true }
    }
    if (matchesKey(data, 'escape')) {
      bindings.dispatch({ type: 'escape' })
      return { consume: true }
    }

    if (bindings.readState().exitArmed) bindings.dispatch({ type: 'disarm-exit' })
    return undefined
  })
}
