import { createServer, connect } from 'node:net'

export async function startLoopbackForward({ targetHost, targetPort }) {
  const sockets = new Set()
  const server = createServer((downstream) => {
    sockets.add(downstream)
    downstream.once('close', () => sockets.delete(downstream))
    const upstream = connect({ host: targetHost, port: targetPort })
    sockets.add(upstream)
    upstream.once('close', () => sockets.delete(upstream))
    downstream.on('error', () => upstream.destroy())
    upstream.on('error', () => downstream.destroy())
    downstream.pipe(upstream)
    upstream.pipe(downstream)
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address !== 'object') {
    server.close()
    throw new Error('loopback forward did not publish a TCP address')
  }
  let closed = false
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      if (closed) return
      closed = true
      for (const socket of sockets) socket.destroy()
      await new Promise((resolveClose, reject) => {
        server.close(error => error === undefined ? resolveClose() : reject(error))
      })
    },
  }
}
