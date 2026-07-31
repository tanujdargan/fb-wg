// index.js
//
// Cloudflare Worker entry point + the Room Durable Object. This file is a
// thin I/O adapter: all game-room decisions (who is p1/p2, claim conflicts,
// relay routing, reconnect grace) live in the pure state machine in
// ./room-logic.js. This file only does HTTP routing, WebSocket plumbing
// (Hibernation API), storage, and the idle alarm.

import * as roomLogic from './room-logic.js'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const IDLE_MS = 30 * 60 * 1000

function generateCode () {
   const bytes = new Uint8Array(5)
   crypto.getRandomValues(bytes)
   let code = ''
   for (let i = 0; i < 5; i++) {
      code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
   }
   return code
}

function checkOrigin (request, env) {
   const origin = request.headers.get('Origin')
   if (!origin) return true
   let url
   try {
      url = new URL(origin)
   } catch (e) {
      return false
   }
   const hostname = url.hostname
   if (hostname === 'localhost' || hostname === '127.0.0.1') return true
   if (env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN) return true
   return false
}

export default {
   async fetch (request, env, ctx) {
      const url = new URL(request.url)

      if (request.method === 'POST' && url.pathname === '/rooms') {
         const code = generateCode()
         return new Response(JSON.stringify({ code }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
         })
      }

      const wsMatch = url.pathname.match(/^\/rooms\/([A-Za-z0-9]{1,16})\/ws$/)
      if (request.method === 'GET' && wsMatch) {
         if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('Expected websocket', { status: 426 })
         }
         if (!checkOrigin(request, env)) {
            return new Response('Forbidden origin', { status: 403 })
         }
         const code = wsMatch[1]
         const id = env.ROOMS.idFromName(code)
         const stub = env.ROOMS.get(id)
         return stub.fetch(request)
      }

      return new Response('Not found', { status: 404 })
   }
}

export class Room {
   constructor (state, env) {
      this.state = state
      this.env = env
   }

   async fetch (request) {
      if (request.headers.get('Upgrade') !== 'websocket') {
         return new Response('Expected websocket', { status: 426 })
      }

      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]

      const socketId = crypto.randomUUID()
      this.state.acceptWebSocket(server, [socketId])
      server.serializeAttachment({ socketId })

      const now = Date.now()
      const room = await this.loadState(now)
      const result = roomLogic.connectSocket(room, socketId, now)
      await this.saveState(result.state)
      await this.state.storage.setAlarm(now + IDLE_MS)

      return new Response(null, { status: 101, webSocket: client })
   }

   async webSocketMessage (ws, message) {
      const now = Date.now()
      const attachment = ws.deserializeAttachment() || {}
      const socketId = attachment.socketId
      if (!socketId) return

      const raw = typeof message === 'string' ? message : bufferToString(message)
      const room = await this.loadState(now)
      const result = roomLogic.handleMessage(room, socketId, raw, now)
      await this.saveState(result.state)
      this.applyEffects(result.state, result.effects, ws)
      await this.state.storage.setAlarm(now + IDLE_MS)
   }

   async webSocketClose (ws, code, reason, wasClean) {
      const now = Date.now()
      const attachment = ws.deserializeAttachment() || {}
      const socketId = attachment.socketId
      if (!socketId) return

      const room = await this.loadState(now)
      const result = roomLogic.disconnectSocket(room, socketId, now)
      await this.saveState(result.state)
      this.applyEffects(result.state, result.effects, ws)
   }

   async webSocketError (ws, error) {
      await this.webSocketClose(ws, 1011, 'error', false)
   }

   async alarm () {
      const sockets = this.state.getWebSockets()
      for (const ws of sockets) {
         try {
            ws.close(4000, 'IDLE')
         } catch (e) {
            // socket may already be closed -- ignore.
         }
      }
      await this.state.storage.deleteAll()
   }

   async loadState (now) {
      const stored = await this.state.storage.get('room')
      return stored || roomLogic.createState(now)
   }

   async saveState (state) {
      await this.state.storage.put('room', state)
   }

   applyEffects (state, effects, senderWs) {
      for (const effect of effects || []) {
         const targets = this.resolveTargets(effect.to, state, senderWs)
         if (effect.type === 'send') {
            const body = JSON.stringify(effect.msg)
            for (const target of targets) {
               try {
                  target.send(body)
               } catch (e) {
                  // best-effort delivery -- a socket may have gone away.
               }
            }
         } else if (effect.type === 'close') {
            for (const target of targets) {
               try {
                  target.close(effect.code, effect.reason)
               } catch (e) {
                  // already closed -- ignore.
               }
            }
         }
      }
   }

   resolveTargets (to, state, senderWs) {
      if (to === 'sender') {
         return senderWs ? [senderWs] : []
      }
      if (to === 'both') {
         return [
            ...this.resolveTargets('p1', state, senderWs),
            ...this.resolveTargets('p2', state, senderWs)
         ]
      }
      if (to === 'p1' || to === 'p2') {
         const player = state.players[to]
         if (!player || !player.socketId) return []
         return this.state.getWebSockets(player.socketId)
      }
      return []
   }
}

function bufferToString (buf) {
   return new TextDecoder().decode(buf)
}
