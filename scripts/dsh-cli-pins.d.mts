export function resolvedPiAiVersion(cliManifestPath: string): string
export function deriveCliPins(dependencies: Record<string, string>): Record<string, string>
export function assertPinnedGraph(lockfile: string, pins: Record<string, string>): void
