// Test transport only: preserve DSH's official-origin listing path, but send its
// authenticated GET to the test's loopback server. Never forward another call.
const endpoint = new URL(process.env.DSH_LISTING_LOOPBACK)
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') {
  throw new Error('listing fixture requires a loopback HTTP endpoint')
}
const nativeFetch = globalThis.fetch
globalThis.fetch = (input, options) => {
  const requested = new URL(input instanceof Request ? input.url : String(input))
  const method = options?.method ?? (input instanceof Request ? input.method : 'GET')
  if (requested.origin !== 'https://api.deepseek.com' || requested.pathname !== '/models' || method !== 'GET') {
    throw new Error('listing fixture refused an unexpected network request')
  }
  return nativeFetch(new URL('/models', endpoint), options)
}
