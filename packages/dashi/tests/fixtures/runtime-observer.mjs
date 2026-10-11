import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export const name = 'dashi-runtime-observer'
export const inject = ['appReady', 'pluginInventory', 'pluginPackages', 'fileUploads']

// Read only DSH's active composition. Inactive disk copies and lock records are not an oracle.
export function apply(ctx) {
  ctx.effect(() => ctx.appReady.onReady(() => {
    void (async () => {
      const inventory = await ctx.pluginInventory.list()
      const active = inventory.entries.filter(entry => entry.enabled && entry.fiberPhase === 'active')
      const packageOf = (name, parent = ctx.baseUrl) => {
        const pkg = ctx.pluginPackages.packageOf(name, parent)
        if (!pkg) throw new Error(`Runtime package missing: ${name} from ${parent}`)
        return { name: pkg.name, version: pkg.version, dir: pkg.dir, manifest: pkg.manifest, manifestPath: pkg.manifestPath }
      }
      const cli = packageOf('@deepseek-ai/dsh')
      const fromCli = createRequire(realpathSync(cli.manifestPath))
      const { createRuntimeResolution, loadProfileDirectory, resolveProfileDir } = await import(
        pathToFileURL(fromCli.resolve('@deepseek-ai/dsh-app-boot')).href)
      const profileDir = resolveProfileDir('dashi')
      const profileRootImporter = pathToFileURL(`${profileDir}/package.json`).href
      const names = [
        '@deepseek-ai/dsh', '@deepseek-ai/dsh-base', '@antst/dashi-app',
        '@antst/dashi', '@antst/dsh-file-uploads-none', '@antst/roller', '@sessionbus/dsh',
      ]
      // Bundle rows mount from the PROFILE ROOT, not the bundle's dependency importer.
      const packages = Object.fromEntries(names.map(name => [name, packageOf(name, profileRootImporter)]))
      const dashi = packages['@antst/dashi']
      dashi.entryHash = createHash('sha256').update(readFileSync(`${dashi.dir}/${dashi.manifest.main}`)).digest('hex')
      const importers = ['@antst/dashi', '@antst/dashi-app', '@antst/dsh-file-uploads-none', '@sessionbus/dsh']
      const peers = {}
      for (const importer of importers) {
        const pkg = packages[importer]
        const url = pathToFileURL(`${pkg.dir}/index.js`).href
        peers[importer] = Object.fromEntries(Object.keys(pkg.manifest.peerDependencies ?? {})
          .filter(name => name.startsWith('@deepseek-ai/'))
          .map(name => [name, packageOf(name, url)]))
      }
      const kit = packageOf('@sessionbus/kit', pathToFileURL(`${packages['@sessionbus/dsh'].dir}/plugin.cjs`).href)
      const resolution = await createRuntimeResolution({
        installAnchor: cli.manifestPath,
        profile: loadProfileDirectory('dashi', profileDir, cli.manifestPath),
      })
      // Cordis exposes the active providing fiber, so correlate the service with its mounted row.
      const provider = ctx.reflect._getImpl('fileUploads')
      writeFileSync(process.env.DASHI_RUNTIME_RECORD, JSON.stringify({
        packages, peers, kit, active, resolution: resolution.entries, profileRootImporter,
        fileUploadsProvider: provider === undefined ? null : {
          name: provider.name, fiber: provider.fiber.name,
          importer: provider.fiber.ctx.baseUrl,
          package: packageOf('@antst/dsh-file-uploads-none', profileRootImporter),
        },
        fileUploadsRegistered: ctx.get('fileUploads') !== undefined,
      }))
    })().catch(error => {
      process.stderr.write(`dashi runtime observer failed: ${error.stack ?? error}\n`)
      ctx.appExit?.(1)
    })
  }), 'runtime observer')
}

