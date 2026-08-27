#!/bin/sh
set -eu

exec node - <<'NODE'
const http = require('node:http')
const { spawn } = require('node:child_process')

const child = spawn(
  'dsh',
  ['web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)

let output = ''
let settled = false
let probing = false
const deadline = setTimeout(
  () => finish(false, 'DSH loopback boot timed out before the pack route became ready'),
  15000,
)

function finish(ok, message) {
  if (settled) return
  settled = true
  clearTimeout(deadline)
  const force = setTimeout(() => child.kill('SIGKILL'), 6000)
  child.once('close', () => {
    clearTimeout(force)
    console.log(message)
    process.exit(ok ? 0 : 2)
  })
  if (!child.kill('SIGTERM')) {
    clearTimeout(force)
    console.log(message)
    process.exit(ok ? 0 : 2)
  }
}

function inspect(chunk) {
  output = (output + chunk.toString('utf8')).slice(-8192)
  if (probing || settled) return
  const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/)
  if (!match) return
  probing = true
  const request = http.get(
    `http://127.0.0.1:${match[1]}/api/gas-city/v1/connections`,
    { timeout: 3000 },
    (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body = (body + chunk).slice(0, 65536) })
      response.on('end', () => {
        let valid = false
        let unavailable = []
        try {
          const parsed = JSON.parse(body)
          valid = response.statusCode === 200 && Array.isArray(parsed.connections)
          if (valid && process.env.GC_REQUIRE_AVAILABLE_CONNECTIONS === '1') {
            unavailable = parsed.connections.filter(connection => connection?.available !== true)
            valid = unavailable.length === 0
          }
        } catch {}
        const unavailableSummary = unavailable.map(connection => {
          const label = typeof connection?.label === 'string' ? connection.label : 'unnamed connection'
          const diagnostic = typeof connection?.diagnostic === 'string' ? connection.diagnostic : 'unavailable'
          return `${label.replace(/[\r\n]/g, ' ')}: ${diagnostic.replace(/[\r\n]/g, ' ')}`.slice(0, 500)
        }).join('; ')
        finish(
          valid,
          valid
            ? 'DSH loopback boot and pack route probe succeeded'
            : unavailable.length > 0
              ? `DSH pack route reported unavailable connections: ${unavailableSummary}`
            : 'DSH booted, but the pack connections route did not return its JSON contract',
        )
      })
    },
  )
  request.on('timeout', () => request.destroy(new Error('probe timeout')))
  request.on('error', () => finish(false, 'DSH pack route probe failed'))
}

child.stdout.on('data', inspect)
child.stderr.on('data', inspect)
child.on('error', () => finish(false, 'could not start dsh web for the loopback probe'))
child.on('close', (code) => {
  if (!settled) {
    finish(false, `dsh web exited before the pack route probe (status ${code})`)
  }
})
NODE
