// room-logic.js
//
// Pure, environment-free room state machine for the fbwg-rooms Durable
// Object. Every function here is a plain function of (state, ..., now) that
// returns a new-ish {state, effects} result. There is no Date.now(), no
// fetch, no WebSocket, no storage access anywhere in this file -- all of
// that I/O lives in worker/src/index.js, which is a thin adapter over this
// module. That split is what makes this file testable under `node --test`
// without spinning up a Worker.
//
// state shape:
//   {
//      createdAt: number,
//      players: {
//         p1: null | Player,
//         p2: null | Player
//      },
//      conn: {
//         [socketId]: ConnMeta
//      }
//   }
//
// Player:
//   { id, name, char, connected, socketId, lastSeen }
//
// ConnMeta (per physical socket, keyed by an opaque socketId string chosen
// by the caller/adapter):
//   { playerId, invalidFrames, rlWindowStart, rlCount, rlViolatedWindow, rlViolations }
//
// Effects are plain descriptors the adapter turns into real I/O:
//   { type: 'send', to: 'sender'|'p1'|'p2'|'both', msg: {...} }
//   { type: 'close', to: 'sender'|'p1'|'p2', code, reason }

'use strict'

const NAME_RE = /^[a-zA-Z0-9_-]{1,16}$/
const MAX_FRAME_BYTES = 1024
const GRACE_MS = 60 * 1000
const RATE_WINDOW_MS = 1000
const RATE_LIMIT_PER_WINDOW = 40
const RATE_VIOLATION_CLOSE_THRESHOLD = 3
const MAX_INVALID_FRAMES = 10
const KNOWN_TYPES = ['hello', 'claim', 'relay', 'ping']

function createState (now) {
   return {
      createdAt: now,
      players: { p1: null, p2: null },
      conn: {}
   }
}

function otherId (id) {
   return id === 'p1' ? 'p2' : 'p1'
}

function playerInfo (player) {
   if (!player) return null
   return { name: player.name, char: player.char }
}

function byteLength (str) {
   return new TextEncoder().encode(str).length
}

function isPlainObject (v) {
   return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function newConnMeta () {
   return {
      playerId: null,
      invalidFrames: 0,
      rlWindowStart: null,
      rlCount: 0,
      rlViolatedWindow: false,
      rlViolations: 0
   }
}

// -- connection lifecycle ----------------------------------------------

function connectSocket (state, socketId, now) {
   state.conn[socketId] = newConnMeta()
   return { state, effects: [] }
}

function disconnectSocket (state, socketId, now) {
   const conn = state.conn[socketId]
   if (!conn) return { state, effects: [] }
   const playerId = conn.playerId
   delete state.conn[socketId]
   if (!playerId) return { state, effects: [] }

   const player = state.players[playerId]
   // Stale close (e.g. a reconnect already replaced this socket) -- ignore.
   if (!player || player.socketId !== socketId) return { state, effects: [] }

   player.connected = false
   player.socketId = null
   player.lastSeen = now

   const effects = []
   const otherPid = otherId(playerId)
   const other = state.players[otherPid]
   if (other && other.connected) {
      effects.push({ type: 'send', to: otherPid, msg: { t: 'peer-left' } })
   }
   return { state, effects }
}

// -- invalid frame bookkeeping -------------------------------------------

function invalidFrame (state, socketId) {
   const conn = state.conn[socketId]
   if (!conn) return { state, effects: [] }
   conn.invalidFrames += 1
   if (conn.invalidFrames >= MAX_INVALID_FRAMES) {
      return {
         state,
         effects: [{ type: 'close', to: 'sender', code: 4002, reason: 'INVALID' }]
      }
   }
   return { state, effects: [] }
}

// -- rate limiting ---------------------------------------------------------
//
// Simple fixed-window counter per socket. A window is RATE_WINDOW_MS wide;
// once more than RATE_LIMIT_PER_WINDOW messages land in a window, the
// excess is dropped and the window is flagged as violated. When a window
// rolls over, three consecutive violated windows trigger a close(4008) on
// the first message of the next window.

function applyRateLimit (conn, now) {
   if (conn.rlWindowStart === null || now - conn.rlWindowStart >= RATE_WINDOW_MS) {
      if (conn.rlWindowStart !== null) {
         conn.rlViolations = conn.rlViolatedWindow ? conn.rlViolations + 1 : 0
      }
      conn.rlWindowStart = now
      conn.rlCount = 0
      conn.rlViolatedWindow = false
      if (conn.rlViolations >= RATE_VIOLATION_CLOSE_THRESHOLD) {
         conn.rlViolations = 0
         return { closeCode: 4008 }
      }
   }
   conn.rlCount += 1
   if (conn.rlCount > RATE_LIMIT_PER_WINDOW) {
      conn.rlViolatedWindow = true
      return { dropped: true }
   }
   return {}
}

// -- message dispatch -------------------------------------------------------

function handleMessage (state, socketId, raw, now) {
   const conn = state.conn[socketId]
   if (!conn) return { state, effects: [] }

   const rl = applyRateLimit(conn, now)
   if (rl.closeCode) {
      return {
         state,
         effects: [{ type: 'close', to: 'sender', code: rl.closeCode, reason: 'RATE_LIMIT' }]
      }
   }
   if (rl.dropped) {
      return { state, effects: [] }
   }

   if (byteLength(raw) > MAX_FRAME_BYTES) {
      return invalidFrame(state, socketId)
   }

   let msg
   try {
      msg = JSON.parse(raw)
   } catch (e) {
      return invalidFrame(state, socketId)
   }

   if (!isPlainObject(msg) || typeof msg.t !== 'string' || KNOWN_TYPES.indexOf(msg.t) === -1) {
      return invalidFrame(state, socketId)
   }

   // Structurally valid frame -- reset the consecutive invalid-frame count.
   conn.invalidFrames = 0

   if (!conn.playerId && msg.t !== 'hello') {
      // Gameplay message before hello: dropped, per spec.
      return { state, effects: [] }
   }

   switch (msg.t) {
      case 'hello': return handleHello(state, socketId, msg, now)
      case 'claim': return handleClaim(state, socketId, msg, now)
      case 'relay': return handleRelay(state, socketId, msg, now)
      case 'ping': return handlePing(state, socketId, now)
      default: return { state, effects: [] }
   }
}

function handleHello (state, socketId, msg, now) {
   const name = msg && msg.name
   if (typeof name !== 'string' || !NAME_RE.test(name)) {
      return invalidFrame(state, socketId)
   }

   const conn = state.conn[socketId]
   if (!conn) return { state, effects: [] }
   if (conn.playerId) {
      // Already said hello on this socket -- ignore duplicates.
      return { state, effects: [] }
   }

   const p1 = state.players.p1
   const p2 = state.players.p2
   const graceOk = (p) => !!p && !p.connected && (now - p.lastSeen) < GRACE_MS
   const occupied = (p) => !!p && (p.connected || graceOk(p))

   if (graceOk(p1) && p1.name === name) return reconnectPlayer(state, 'p1', socketId, now, name)
   if (graceOk(p2) && p2.name === name) return reconnectPlayer(state, 'p2', socketId, now, name)

   if (!occupied(p1)) return assignSlot(state, 'p1', socketId, name, now)
   if (!occupied(p2)) return assignSlot(state, 'p2', socketId, name, now)

   return {
      state,
      effects: [
         { type: 'send', to: 'sender', msg: { t: 'error', code: 'FULL' } },
         { type: 'close', to: 'sender', code: 4001, reason: 'FULL' }
      ]
   }
}

function reconnectPlayer (state, id, socketId, now, name) {
   const player = state.players[id]
   player.connected = true
   player.socketId = socketId
   player.lastSeen = now

   const conn = state.conn[socketId]
   conn.playerId = id

   const otherPid = otherId(id)
   const other = state.players[otherPid]

   const effects = [
      { type: 'send', to: 'sender', msg: { t: 'welcome', playerId: id, host: id === 'p1', peer: playerInfo(other) } }
   ]
   if (other && other.connected) {
      effects.push({ type: 'send', to: otherPid, msg: { t: 'peer-rejoined', name } })
   }
   return { state, effects }
}

function assignSlot (state, id, socketId, name, now) {
   state.players[id] = { id, name, char: null, connected: true, socketId, lastSeen: now }

   const conn = state.conn[socketId]
   conn.playerId = id

   const otherPid = otherId(id)
   const other = state.players[otherPid]

   const effects = [
      { type: 'send', to: 'sender', msg: { t: 'welcome', playerId: id, host: id === 'p1', peer: playerInfo(other) } }
   ]
   if (other && other.connected) {
      effects.push({ type: 'send', to: otherPid, msg: { t: 'peer-joined', name } })
   }
   return { state, effects }
}

function handleClaim (state, socketId, msg, now) {
   const conn = state.conn[socketId]
   if (!conn || !conn.playerId) return { state, effects: [] }

   const char = msg && msg.char
   if (char !== 'fire' && char !== 'water') {
      return invalidFrame(state, socketId)
   }

   const id = conn.playerId
   const player = state.players[id]
   const other = state.players[otherId(id)]

   if (other && other.char === char) {
      return { state, effects: [{ type: 'send', to: 'sender', msg: { t: 'error', code: 'TAKEN' } }] }
   }

   player.char = char
   const effects = [{ type: 'send', to: 'both', msg: { t: 'claimed', playerId: id, char } }]

   const p1 = state.players.p1
   const p2 = state.players.p2
   if (p1 && p1.char && p2 && p2.char) {
      effects.push({ type: 'send', to: 'both', msg: { t: 'start', hostId: 'p1' } })
   }
   return { state, effects }
}

function handleRelay (state, socketId, msg, now) {
   const conn = state.conn[socketId]
   if (!conn || !conn.playerId) return { state, effects: [] }

   const otherPid = otherId(conn.playerId)
   const other = state.players[otherPid]
   if (!other || !other.connected) return { state, effects: [] }

   return { state, effects: [{ type: 'send', to: otherPid, msg: { t: 'relay', d: msg.d } }] }
}

function handlePing (state, socketId, now) {
   return { state, effects: [{ type: 'send', to: 'sender', msg: { t: 'pong', now } }] }
}

module.exports = {
   NAME_RE,
   MAX_FRAME_BYTES,
   GRACE_MS,
   RATE_WINDOW_MS,
   RATE_LIMIT_PER_WINDOW,
   RATE_VIOLATION_CLOSE_THRESHOLD,
   MAX_INVALID_FRAMES,
   KNOWN_TYPES,
   createState,
   connectSocket,
   disconnectSocket,
   handleMessage,
   byteLength
}
