import { createTerminalShell } from '../../lib/application.js'
import { createRenderer } from '../../lib/renderer.js'

let renders = 0
const shell = createTerminalShell({
  createView(bindings) {
    const renderer = createRenderer({ ...bindings, inline: false })
    const render = renderer.render
    return {
      ...renderer,
      render(force) {
        renders++
        if (renders > 1) throw new Error('fixture redraw failure')
        render(force)
      },
    }
  },
  cwd: process.cwd(),
  exit: code => { setTimeout(() => { process.exit(code) }, 0) },
  inline: false,
})

shell.start()
