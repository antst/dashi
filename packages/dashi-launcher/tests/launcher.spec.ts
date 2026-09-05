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

function launcherEnv(path: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: path }
  delete env.AGENTBUS_GROUPS
  delete env.AGENTBUS_LAUNCH_TOKEN
  return { ...env, ...extra }
}

const probe = [
  'printf "ARG:%s\\n" "$@"',
  'printf "GROUPS:%s\\n" "${AGENTBUS_GROUPS-UNSET}"',
  'printf "TOKEN:%s\\n" "${AGENTBUS_LAUNCH_TOKEN-UNSET}"',
  'printf "OTHER:%s\\n" "${DASHI_OTHER-UNSET}"',
].join('\n')

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('dashi launcher', () => {
  it('ships only the zero-dependency launcher surface', () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
      dependencies?: unknown
    }
    expect(manifest.dependencies).toBeUndefined()
    expect(readFileSync(launcher, 'utf8').trimEnd().split('\n')).toHaveLength(40)
    const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: packageDir, encoding: 'utf8', timeout: 30_000,
    })) as Array<{ files: Array<{ path: string }> }>
    const files = packed[0]?.files.map(file => file.path).sort()
    expect(files).toEqual(['README.md', 'bin/dashi.js', 'package.json'])
    process.stdout.write(`launcher pack: ${files?.join(', ')}\n`)
  }, 30_000)

  it('uses the interactive profile, preserves env, and leaves groups absent by default', () => {
    const directory = fakePath(`${probe}\nexit 42`)
    const result = spawnSync(process.execPath, [launcher, '--fullscreen'], {
      encoding: 'utf8', env: launcherEnv(directory, { DASHI_OTHER: 'kept' }),
    })
    expect(result.stdout).toBe([
      'ARG:--profile', 'ARG:dashi', 'ARG:--fullscreen',
      'GROUPS:UNSET', 'TOKEN:UNSET', 'OTHER:kept', '',
    ].join('\n'))
    expect(result.status).toBe(42)
  })

  it('uses the agentbus profile when the launch token is set', () => {
    const directory = fakePath(probe)
    const result = spawnSync(process.execPath, [launcher, '--resume'], {
      encoding: 'utf8', env: launcherEnv(directory, { AGENTBUS_LAUNCH_TOKEN: 'secret-token' }),
    })
    expect(result.stdout).toContain('ARG:--profile\nARG:agentbus\nARG:--resume\n')
    expect(result.stdout).toContain('GROUPS:UNSET\nTOKEN:secret-token\n')
    expect(result.status).toBe(0)
  })

  it('collects repeatable group forms and forwards only the remaining arguments', () => {
    const directory = fakePath(probe)
    const result = spawnSync(process.execPath, [
      launcher, '--model', 'm', '-g', 'one, two', '--group', 'three', '-g=four, five', '--verbose',
    ], { encoding: 'utf8', env: launcherEnv(directory) })
    expect(result.stdout).toContain('ARG:--profile\nARG:dashi\nARG:--model\nARG:m\nARG:--verbose\n')
    expect(result.stdout).toContain('GROUPS:["one","two","three","four","five"]\n')
    expect(result.status).toBe(0)
  })

  it.each([
    ['missing value', ['-g']],
    ['empty value', ['--group', '']],
    ['empty comma entry', ['-g=one,,two']],
  ])('rejects %s without spawning dsh', (_label, args) => {
    const directory = fakePath('printf BAD')
    const result = spawnSync(process.execPath, [launcher, ...args], {
      encoding: 'utf8', env: launcherEnv(directory),
    })
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('dashi: -g/--group requires nonempty comma-separated names\n')
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
