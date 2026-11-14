import { realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolvePackage } from '../resolve-package.mjs'

export const name = 'dashi-runtime-observer'
export const inject = ['appReady', 'pluginInventory', 'pluginPackages', 'fileUploads', 'sessionController', 'tuiRoot']

// Read only DSH's active composition. Inactive disk copies and lock records are not an oracle.
export function apply(ctx) {
  let observed = false
  const observe = agent => {
    if (agent === undefined || observed) return
    observed = true
    void (async () => {
      const inventory = await ctx.pluginInventory.list()
      const active = inventory.entries.filter(entry => entry.enabled && entry.fiberPhase === 'active')
      const resolution = ctx.pluginPackages.resolution
      if (resolution?.profileDir === undefined) throw new Error('Runtime has no published profile resolution')
      const installation = resolution.entries.filter(entry => entry.name === '@deepseek-ai/dsh' && entry.scope === 'installation')
      if (installation.length !== 1) throw new Error('Runtime must select exactly one installed DSH CLI')
      const cli = resolvePackage('@deepseek-ai/dsh', installation[0].declarer)
      const profileManifest = join(resolution.profileDir, 'package.json')
      const profileRootImporter = pathToFileURL(realpathSync(profileManifest)).href
      const app = resolvePackage('@antst/dashi-app', profileManifest)
      // DSH owns interception-layer peers; these are reported selections, not physical-file discoveries.
      const reportedPackage = (name, importer) => {
        const parent = pathToFileURL(realpathSync(importer)).href
        const pkg = ctx.pluginPackages.packageOf(name, parent)
        if (!pkg) throw new Error(`DSH-reported selection missing: ${name} from ${parent}`)
        return { evidence: 'DSH-reported selection', importer: parent,
          name: pkg.name, version: pkg.version, dir: pkg.dir, manifest: pkg.manifest, manifestPath: pkg.manifestPath }
      }
      const packages = {
        '@deepseek-ai/dsh': cli,
        '@deepseek-ai/dsh-base': resolvePackage('@deepseek-ai/dsh-base', cli.manifestPath),
        '@antst/dashi-app': app,
        ...Object.fromEntries(['@antst/dashi', '@antst/dsh-file-uploads-none', '@antst/roller', '@sessionbus/dsh']
          .map(name => [name, resolvePackage(name, app.manifestPath)])),
      }
      const importers = ['@antst/dashi', '@antst/dashi-app', '@antst/dsh-file-uploads-none', '@sessionbus/dsh']
      const peers = {}
      for (const importer of importers) {
        const pkg = packages[importer]
        peers[importer] = Object.fromEntries(Object.keys(pkg.manifest.peerDependencies ?? {})
          .filter(name => name.startsWith('@deepseek-ai/') || name === 'zod')
          .map(name => [name, reportedPackage(name, pkg.manifestPath)]))
      }
      const kit = resolvePackage('@sessionbus/kit', packages['@sessionbus/dsh'].manifestPath)
      const domain = resolvePackage('@deepseek-ai/dsh-storage-domain', packages['@deepseek-ai/dsh-base'].manifestPath)
      const companions = Object.fromEntries(['@deepseek-ai/cordis', '@deepseek-ai/schemastery']
        .map(name => [name, resolvePackage(name, cli.manifestPath)]))
      companions.zod = resolvePackage('zod', domain.manifestPath)
      // These are public selection metadata plus consumed behavior, NOT a hidden-provider census.
      const unknown = 'dashi-runtime-unknown-receipt'
      const unresolved = ctx.fileUploads.resolve(agent, unknown) === undefined
      const beforeSeq = agent.session.seq
      let promptError
      try {
        await ctx.sessionController.prompt({ sessionId: agent.id, requestId: 'dashi-runtime-receipt-proof',
          mode: 'queue', content: [{ type: 'file', receiptId: unknown }] }, new AbortController().signal)
      } catch (error) { promptError = error.code }
      writeFileSync(process.env.DASHI_RUNTIME_RECORD, JSON.stringify({
        packages, peers, kit, active, companions, resolution: resolution.entries, profileRootImporter,
        noUpload: { unresolved, promptError, beforeSeq, afterSeq: agent.session.seq },
        fileUploadsRegistered: ctx.get('fileUploads') !== undefined,
      }))
    })().catch(error => {
      process.stderr.write(`dashi runtime observer failed: ${error.stack ?? error}\n`)
      ctx.appExit?.(1)
    })
  }
  ctx.on('tui/root-changed', (_previous, current) => { observe(current) })
  ctx.effect(() => ctx.appReady.onReady(() => { observe(ctx.tuiRoot.current()) }), 'runtime observer')
}
