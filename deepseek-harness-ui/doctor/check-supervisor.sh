#!/bin/sh
set -eu

exec node - <<'NODE'
const rawBase = process.env.GC_SUPERVISOR_URL ?? 'http://127.0.0.1:8372'
const bearer = process.env.GC_SUPERVISOR_BEARER

const required = {
  '/v0/cities': ['get'],
  '/v0/events/stream': ['get'],
  '/v0/city/{cityName}/events/stream': ['get'],
  '/v0/city/{cityName}/rigs': ['get'],
  '/v0/city/{cityName}/agents': ['get'],
  '/v0/city/{cityName}/providers/public': ['get'],
  '/v0/city/{cityName}/sessions': ['get', 'post'],
  '/v0/city/{cityName}/session/{id}': ['get', 'patch'],
  '/v0/city/{cityName}/session/{id}/transcript': ['get'],
  '/v0/city/{cityName}/session/{id}/pending': ['get'],
  '/v0/city/{cityName}/session/{id}/stream': ['get'],
  '/v0/city/{cityName}/session/{id}/submit': ['post'],
  '/v0/city/{cityName}/session/{id}/respond': ['post'],
  '/v0/city/{cityName}/session/{id}/permission-mode': ['post'],
  '/v0/city/{cityName}/session/{id}/rename': ['post'],
  '/v0/city/{cityName}/session/{id}/stop': ['post'],
  '/v0/city/{cityName}/session/{id}/kill': ['post'],
  '/v0/city/{cityName}/session/{id}/suspend': ['post'],
  '/v0/city/{cityName}/session/{id}/close': ['post'],
  '/v0/city/{cityName}/session/{id}/wake': ['post'],
}

function isLoopback(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
  return hostname.split('.').length === 4 && hostname.startsWith('127.')
}

async function getJson(base, suffix) {
  const response = await fetch(`${base}${suffix}`, {
    headers: {
      accept: 'application/json',
      ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`${suffix} returned ${response.status}`)
  return response.json()
}

try {
  const parsed = new URL(rawBase)
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('invalid URL')
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(parsed.hostname))) {
    throw new Error('remote Supervisor checks require HTTPS')
  }
  const base = parsed.href.replace(/\/+$/, '')
  await getJson(base, '/health')
  const specification = await getJson(base, '/openapi.json')
  if (specification === null || typeof specification !== 'object' || Array.isArray(specification)) {
    throw new Error('OpenAPI document is not an object')
  }
  const paths = specification.paths
  if (paths === null || typeof paths !== 'object' || Array.isArray(paths)) {
    throw new Error('OpenAPI paths are missing')
  }
  for (const [path, methods] of Object.entries(required)) {
    const operations = paths[path]
    if (operations === null || typeof operations !== 'object' || Array.isArray(operations)) {
      throw new Error(`missing ${path}`)
    }
    for (const method of methods) {
      if (operations[method] === undefined) throw new Error(`missing ${method.toUpperCase()} ${path}`)
    }
  }
  console.log('Supervisor health and required OpenAPI capabilities are present')
} catch {
  console.log('Supervisor health or required OpenAPI capability probe failed')
  process.exit(2)
}
NODE
