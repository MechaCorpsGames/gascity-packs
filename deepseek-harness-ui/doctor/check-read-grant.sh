#!/bin/sh
set -eu

exec node - <<'NODE'
const rawBase = process.env.GC_SUPERVISOR_URL ?? 'http://127.0.0.1:8372'
const bearer = process.env.GC_SUPERVISOR_BEARER

function isLoopback(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
  return hostname.split('.').length === 4 && hostname.startsWith('127.')
}

function options(includeBearer = true) {
  return {
    headers: {
      accept: 'application/json',
      ...(bearer === undefined || !includeBearer ? {} : { authorization: `Bearer ${bearer}` }),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  }
}

try {
  const parsed = new URL(rawBase)
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('invalid URL')
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(parsed.hostname))) {
    throw new Error('remote Supervisor checks require HTTPS')
  }
  const base = parsed.href.replace(/\/+$/, '')
  let city = process.env.GC_SUPERVISOR_CITY
  if (city === undefined || city === '') {
    const citiesResponse = await fetch(`${base}/v0/cities`, options())
    if (!citiesResponse.ok) throw new Error('cities probe failed')
    const cities = await citiesResponse.json()
    city = Array.isArray(cities?.items)
      ? cities.items.find(item => item?.running === true && typeof item?.name === 'string')?.name
      : undefined
  }
  if (city === undefined || city === '') {
    console.log('No running city is available for the direct read-grant diagnostic')
    process.exit(1)
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(city)) throw new Error('invalid city')
  const cityReadUrl = `${base}/v0/city/${encodeURIComponent(city)}/rigs`
  const unauthenticated = bearer === undefined ? undefined : await fetch(cityReadUrl, options(false))
  const unauthenticatedAuthRejected = unauthenticated?.status === 401 || unauthenticated?.status === 403
  await unauthenticated?.body?.cancel()
  const response = await fetch(cityReadUrl, options())
  const body = await response.text()
  if (response.status === 401) {
    let problem
    try { problem = JSON.parse(body) } catch {}
    if (problem?.detail === 'missing X-GC-City-Read grant') {
      console.log('Supervisor direct read-grant hardening requires an authority/minter integration; authority-fronted bearer mode remains supported')
      process.exit(2)
    }
  }
  if (!response.ok) throw new Error('city read probe failed')
  if (bearer === undefined) {
    console.log(`Supervisor city reads succeed without a direct read-grant challenge (direct target ${base})`)
  } else if (unauthenticatedAuthRejected) {
    console.log(`Supervisor bearer-authenticated city read succeeded and front-door behavior observed (direct target ${base})`)
  } else {
    console.log(`Supervisor city read succeeded while presenting a bearer, but the target did not require it; authority fronting was not proven (direct target ${base})`)
  }
} catch {
  console.log('Supervisor direct read-grant diagnostic could not complete')
  process.exit(2)
}
NODE
