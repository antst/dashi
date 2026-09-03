import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const packageDir = join(root, 'packages', 'dashi-launcher')
const launcher = join(packageDir, 'bin', 'dashi.js')
const temporary: string[] = []

function fakePath(source: string, interpreter = '/bin/sh'): string {
  const directory = mkdtempSync(join(tmpdir(), 'dashi-launcher-'))
  temporary.push(directory)
  const executable = join(directory, 'dsh')
  writeFileSync(executable, `#!${interpreter}\n${source}\n`)
  chmodSync(executable, 0o755)
  return directory
}

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('dashi launcher', () => {
  it('ships only the zero-dependency launcher surface', () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
      dependencies?: unknown
    }
    expect(manifest.dependencies).toBeUndefined()
    expect(readFileSync(launcher, 'utf8').trimEnd().split('\n')).toHaveLength(23)
    const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: packageDir, encoding: 'utf8', timeout: 30_000,
    })) as Array<{ files: Array<{ path: string }> }>
    const files = packed[0]?.files.map(file => file.path).sort()
    expect(files).toEqual(['README.md', 'bin/dashi.js', 'package.json'])
    process.stdout.write(`launcher pack: ${files?.join(', ')}\n`)
  })

  it('prepends the native profile and propagates a nonzero exit exactly', () => {
    const directory = fakePath('printf "%s\\n" "$@"\nexit 42')
    const result = spawnSync(process.execPath, [launcher, '--fullscreen'], {
      encoding: 'utf8', env: { ...process.env, PATH: directory },
    })
    expect(result.stdout).toBe('--profile\ndashi\n--fullscreen\n')
    expect(result.status).toBe(42)
  })

  it('prints one install hint when dsh is absent from PATH', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dashi-launcher-empty-'))
    temporary.push(directory)
    const result = spawnSync(process.execPath, [launcher], {
      encoding: 'utf8', env: { ...process.env, PATH: directory },
    })
    expect(result.status).toBe(127)
    expect(result.stderr).toBe(
      "dashi: dsh not found; install it with 'npm install --global @deepseek-ai/dsh'\n",
    )
  })

  it('forwards termination signals to dsh', async () => {
    const directory = fakePath(
      "process.once('SIGTERM', () => { process.stdout.write('DASHI_SIGNAL\\n', () => { process.exit(23) }) })\nprocess.stdout.write('READY\\n')\nsetInterval(() => {}, 60_000)",
      process.execPath,
    )
    const child = spawn(process.execPath, [launcher], {
      env: { ...process.env, PATH: `${directory}:/usr/bin:/bin` }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', data => { output += String(data) })
    const observed = (text: string): Promise<void> => new Promise(resolveObserved => {
      const check = (): void => {
        if (!output.includes(text)) return
        child.stdout.off('data', check)
        resolveObserved()
      }
      child.stdout.on('data', check)
      check()
    })
    const closed = new Promise<number | null>(resolveClose => { child.on('close', resolveClose) })
    try {
      await observed('READY')
      const forwarded = observed('DASHI_SIGNAL')
      child.kill('SIGTERM')
      await forwarded
      expect(await closed).toBe(23)
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  }, 15_000)
})
