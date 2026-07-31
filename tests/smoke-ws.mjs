// tests/smoke-ws.mjs
//
// End-to-end smoke test against a running `wrangler dev` instance of the
// fbwg-rooms Worker. Not part of `npm test` (which runs the pure
// room-logic.js unit tests) -- this is a manual/CI-optional check that the
// real HTTP + Durable Object + WebSocket wiring works.
//
// Usage:
//   1. In one terminal: cd worker && npx wrangler dev --local --port 8787
//   2. In another:      node tests/smoke-ws.mjs [http://localhost:8787]

const base = process.argv[2] || 'http://localhost:8787'
const wsBase = base.replace(/^http/, 'ws')

function fail (msg) {
   console.error('FAIL:', msg)
   process.exit(1)
}

// A persistent inbox per socket: messages are buffered as soon as they
// arrive (a single listener attached at connection time), so `next()`
// can be awaited any number of times without a race between one message
// arriving and the next listener being attached.
function attachInbox (ws) {
   const queue = []
   const waiters = []

   ws.addEventListener('message', (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : ev.data.toString()
      const msg = JSON.parse(raw)
      const idx = waiters.findIndex((w) => w.pred(msg))
      if (idx !== -1) {
         const waiter = waiters.splice(idx, 1)[0]
         clearTimeout(waiter.timer)
         waiter.resolve(msg)
         return
      }
      queue.push(msg)
   })

   return {
      next (pred, timeoutMs = 5000) {
         const idx = queue.findIndex(pred)
         if (idx !== -1) {
            return Promise.resolve(queue.splice(idx, 1)[0])
         }
         return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
               const i = waiters.findIndex((w) => w.resolve === resolve)
               if (i !== -1) waiters.splice(i, 1)
               reject(new Error('timeout waiting for message; queue=' + JSON.stringify(queue)))
            }, timeoutMs)
            waiters.push({ pred, resolve, timer })
         })
      }
   }
}

function waitOpen (ws) {
   return new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve)
      ws.addEventListener('error', () => reject(new Error('socket error before open')))
   })
}

async function main () {
   const createRes = await fetch(base + '/rooms', { method: 'POST' })
   if (createRes.status !== 200) fail('POST /rooms returned ' + createRes.status)
   const { code } = await createRes.json()
   if (!/^[A-Z0-9]{5}$/.test(code)) fail('unexpected room code shape: ' + code)
   console.log('room code:', code)

   const wsUrl = `${wsBase}/rooms/${code}/ws`
   const a = new WebSocket(wsUrl)
   const b = new WebSocket(wsUrl)
   const inboxA = attachInbox(a)
   const inboxB = attachInbox(b)

   await waitOpen(a)
   await waitOpen(b)

   a.send(JSON.stringify({ t: 'hello', name: 'Alice' }))
   const welcomeA = await inboxA.next((m) => m.t === 'welcome')
   if (welcomeA.playerId !== 'p1' || welcomeA.host !== true) fail('Alice should be host p1: ' + JSON.stringify(welcomeA))

   b.send(JSON.stringify({ t: 'hello', name: 'Bob' }))
   const welcomeB = await inboxB.next((m) => m.t === 'welcome')
   if (welcomeB.playerId !== 'p2' || welcomeB.host !== false) fail('Bob should be p2, non-host: ' + JSON.stringify(welcomeB))
   await inboxA.next((m) => m.t === 'peer-joined' && m.name === 'Bob')

   a.send(JSON.stringify({ t: 'claim', char: 'fire' }))
   await inboxA.next((m) => m.t === 'claimed' && m.playerId === 'p1')
   b.send(JSON.stringify({ t: 'claim', char: 'water' }))
   const start = await inboxB.next((m) => m.t === 'start')
   if (start.hostId !== 'p1') fail('expected hostId p1 in start message')

   a.send(JSON.stringify({ t: 'relay', d: { x: 42, y: 7 } }))
   const relayed = await inboxB.next((m) => m.t === 'relay')
   if (relayed.d.x !== 42 || relayed.d.y !== 7) fail('relay payload mismatch: ' + JSON.stringify(relayed))

   a.send(JSON.stringify({ t: 'ping' }))
   await inboxA.next((m) => m.t === 'pong')

   a.close()
   b.close()
   console.log('PASS')
}

main().catch((err) => fail(err.stack || String(err)))
