import { execFileSync } from 'node:child_process'
import { appendFileSync, statSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
if (file === undefined || process.env.DSH_DASHI_EDITOR_TRACE === undefined) process.exit(2)
writeFileSync(process.env.DSH_DASHI_EDITOR_TRACE, JSON.stringify({
  file,
  mode: statSync(file).mode & 0o777,
  terminalMode: execFileSync('stty', ['-g'], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] }).trim(),
}))
appendFileSync(file, ' from editor')
