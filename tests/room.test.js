// tests/room.test.js
//
// Unit tests for the pure room state machine in worker/src/room-logic.js.
// No Worker, no Durable Object, no network -- just plain function calls
// with explicit timestamps, run with `node --test`.

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const room = require('../worker/src/room-logic.js')

function hello (name) {
   return JSON.stringify({ t: 'hello', name })
}

function claim (char) {
   return JSON.stringify({ t: 'claim', char })
}

function relay (d) {
   return JSON.stringify({ t: 'relay', d })
}

function findEffect (effects, pred) {
   return effects.find(pred)
}

test('room creation + first hello makes the joiner host (p1)', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   const res = room.handleMessage(state, 's1', hello('Alice'), 0)
   state = res.state

   const welcome = findEffect(res.effects, (e) => e.type === 'send' && e.msg.t === 'welcome')
   assert.ok(welcome, 'expected a welcome effect')
   assert.equal(welcome.to, 'sender')
   assert.equal(welcome.msg.playerId, 'p1')
   assert.equal(welcome.msg.host, true)
   assert.equal(welcome.msg.peer, null)
   assert.equal(state.players.p1.name, 'Alice')
})

test('second hello notifies the peer and is not host', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   ;({ state } = room.connectSocket(state, 's2', 0))
   state = room.handleMessage(state, 's1', hello('Alice'), 0).state

   const res = room.handleMessage(state, 's2', hello('Bob'), 10)
   state = res.state

   const welcome = findEffect(res.effects, (e) => e.type === 'send' && e.to === 'sender' && e.msg.t === 'welcome')
   assert.equal(welcome.msg.playerId, 'p2')
   assert.equal(welcome.msg.host, false)
   assert.deepEqual(welcome.msg.peer, { name: 'Alice', char: null })

   const notify = findEffect(res.effects, (e) => e.type === 'send' && e.to === 'p1' && e.msg.t === 'peer-joined')
   assert.ok(notify, 'expected peer-joined sent to p1')
   assert.equal(notify.msg.name, 'Bob')
})

test('third connection is rejected as FULL', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   ;({ state } = room.connectSocket(state, 's2', 0))
   ;({ state } = room.connectSocket(state, 's3', 0))
   state = room.handleMessage(state, 's1', hello('Alice'), 0).state
   state = room.handleMessage(state, 's2', hello('Bob'), 0).state

   const res = room.handleMessage(state, 's3', hello('Charlie'), 0)
   const err = findEffect(res.effects, (e) => e.type === 'send' && e.msg.t === 'error')
   assert.ok(err, 'expected an error effect')
   assert.equal(err.msg.code, 'FULL')
   const close = findEffect(res.effects, (e) => e.type === 'close')
   assert.ok(close, 'expected a close effect')
   assert.equal(close.code, 4001)
   assert.equal(close.to, 'sender')
})

test('claim conflict is rejected with TAKEN', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   ;({ state } = room.connectSocket(state, 's2', 0))
   state = room.handleMessage(state, 's1', hello('Alice'), 0).state
   state = room.handleMessage(state, 's2', hello('Bob'), 0).state
   state = room.handleMessage(state, 's1', claim('fire'), 0).state

   const res = room.handleMessage(state, 's2', claim('fire'), 0)
   assert.equal(res.effects.length, 1)
   assert.equal(res.effects[0].type, 'send')
   assert.equal(res.effects[0].to, 'sender')
   assert.equal(res.effects[0].msg.t, 'error')
   assert.equal(res.effects[0].msg.code, 'TAKEN')
})

test('both players claiming triggers start with hostId p1', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   ;({ state } = room.connectSocket(state, 's2', 0))
   state = room.handleMessage(state, 's1', hello('Alice'), 0).state
   state = room.handleMessage(state, 's2', hello('Bob'), 0).state
   state = room.handleMessage(state, 's1', claim('fire'), 0).state

   const res = room.handleMessage(state, 's2', claim('water'), 0)
   const claimed = findEffect(res.effects, (e) => e.msg && e.msg.t === 'claimed')
   assert.ok(claimed)
   assert.equal(claimed.to, 'both')
   const start = findEffect(res.effects, (e) => e.msg && e.msg.t === 'start')
   assert.ok(start, 'expected a start effect once both players have claimed')
   assert.equal(start.to, 'both')
   assert.equal(start.msg.hostId, 'p1')
})

test('relay is routed only to the peer', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   ;({ state } = room.connectSocket(state, 's2', 0))
   state = room.handleMessage(state, 's1', hello('Alice'), 0).state
   state = room.handleMessage(state, 's2', hello('Bob'), 0).state

   const res = room.handleMessage(state, 's1', relay({ x: 1, y: 2 }), 0)
   assert.equal(res.effects.length, 1)
   assert.equal(res.effects[0].type, 'send')
   assert.equal(res.effects[0].to, 'p2')
   assert.deepEqual(res.effects[0].msg, { t: 'relay', d: { x: 1, y: 2 } })
})

test('relay is dropped silently when there is no peer', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   state = room.handleMessage(state, 's1', hello('Alice'), 0).state

   const res = room.handleMessage(state, 's1', relay({ x: 1 }), 0)
   assert.deepEqual(res.effects, [])
})

test('reconnect within grace keeps playerId and char', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   ;({ state } = room.connectSocket(state, 's2', 0))
   state = room.handleMessage(state, 's1', hello('Alice'), 0).state
   state = room.handleMessage(state, 's2', hello('Bob'), 0).state
   state = room.handleMessage(state, 's1', claim('fire'), 0).state

   // Alice drops.
   state = room.disconnectSocket(state, 's1', 1000).state
   assert.equal(state.players.p1.connected, false)

   // Alice reconnects 30s later (well within the 60s grace window) on a new socket.
   ;({ state } = room.connectSocket(state, 's3', 31000))
   const res = room.handleMessage(state, 's3', hello('Alice'), 31000)
   state = res.state

   const welcome = findEffect(res.effects, (e) => e.type === 'send' && e.to === 'sender' && e.msg.t === 'welcome')
   assert.equal(welcome.msg.playerId, 'p1')
   assert.equal(welcome.msg.host, true)
   assert.equal(state.players.p1.connected, true)
   assert.equal(state.players.p1.char, 'fire', 'char should survive the reconnect')
   assert.equal(state.conn.s3.playerId, 'p1')

   const rejoin = findEffect(res.effects, (e) => e.type === 'send' && e.to === 'p2' && e.msg.t === 'peer-rejoined')
   assert.ok(rejoin, 'peer should be told Alice rejoined')
})

test('reconnect after grace has expired is treated as a fresh join', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   ;({ state } = room.connectSocket(state, 's2', 0))
   state = room.handleMessage(state, 's1', hello('Alice'), 0).state
   state = room.handleMessage(state, 's2', hello('Bob'), 0).state
   state = room.handleMessage(state, 's1', claim('fire'), 0).state

   state = room.disconnectSocket(state, 's1', 0).state

   // 61 seconds later -- past the 60s grace window.
   ;({ state } = room.connectSocket(state, 's3', 61001))
   const res = room.handleMessage(state, 's3', hello('Alice'), 61001)
   state = res.state

   const welcome = findEffect(res.effects, (e) => e.type === 'send' && e.to === 'sender' && e.msg.t === 'welcome')
   assert.equal(welcome.msg.playerId, 'p1')
   assert.equal(state.players.p1.char, null, 'a fresh join should not inherit the old char')
   assert.equal(state.players.p1.connected, true)
})

test('invalid name is rejected and does not create a player', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   const res = room.handleMessage(state, 's1', hello('bad name!'), 0)
   assert.deepEqual(res.effects, [])
   assert.equal(res.state.players.p1, null)
   assert.equal(res.state.conn.s1.playerId, null)
   assert.equal(res.state.conn.s1.invalidFrames, 1)
})

test('oversized frame is dropped', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   const bigName = 'a'.repeat(2000)
   const raw = JSON.stringify({ t: 'hello', name: 'Alice', padding: bigName })
   assert.ok(room.byteLength(raw) > room.MAX_FRAME_BYTES)

   const res = room.handleMessage(state, 's1', raw, 0)
   assert.deepEqual(res.effects, [])
   assert.equal(res.state.players.p1, null)
   assert.equal(res.state.conn.s1.invalidFrames, 1)
})

test('10 consecutive invalid frames closes the socket with 4002', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   let res
   for (let i = 0; i < 9; i++) {
      res = room.handleMessage(state, 's1', 'not json', 0)
      state = res.state
      assert.deepEqual(res.effects, [])
   }
   res = room.handleMessage(state, 's1', 'not json', 0)
   const close = findEffect(res.effects, (e) => e.type === 'close')
   assert.ok(close)
   assert.equal(close.code, 4002)
})

test('rate limiter drops frame 41 in a 1s window', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   state = room.handleMessage(state, 's1', hello('Alice'), 0).state

   let lastRes
   for (let i = 0; i < 40; i++) {
      lastRes = room.handleMessage(state, 's1', JSON.stringify({ t: 'ping' }), 1000)
      state = lastRes.state
      const pong = findEffect(lastRes.effects, (e) => e.msg && e.msg.t === 'pong')
      assert.ok(pong, `ping #${i + 1} within the limit should get a pong`)
   }

   // 41st message in the same 1s window should be dropped, not answered.
   const res41 = room.handleMessage(state, 's1', JSON.stringify({ t: 'ping' }), 1000)
   assert.deepEqual(res41.effects, [], 'the 41st message in the window should be dropped')
})

test('sustained rate-limit abuse (3 consecutive violated windows) closes with 4008', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   state = room.handleMessage(state, 's1', hello('Alice'), 0).state

   let res
   // Windows 1..3: hammer each window with 45 pings (> 40) to mark it violated.
   for (let w = 0; w < 3; w++) {
      const base = w * room.RATE_WINDOW_MS
      for (let i = 0; i < 45; i++) {
         res = room.handleMessage(state, 's1', JSON.stringify({ t: 'ping' }), base)
         state = res.state
      }
   }

   // First message of the 4th window should trigger the close.
   res = room.handleMessage(state, 's1', JSON.stringify({ t: 'ping' }), 3 * room.RATE_WINDOW_MS)
   const close = findEffect(res.effects, (e) => e.type === 'close')
   assert.ok(close, 'expected sustained abuse to close the socket')
   assert.equal(close.code, 4008)
})

test('disconnect notifies the connected peer with peer-left', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   ;({ state } = room.connectSocket(state, 's2', 0))
   state = room.handleMessage(state, 's1', hello('Alice'), 0).state
   state = room.handleMessage(state, 's2', hello('Bob'), 0).state

   const res = room.disconnectSocket(state, 's2', 5000)
   const left = findEffect(res.effects, (e) => e.msg && e.msg.t === 'peer-left')
   assert.ok(left)
   assert.equal(left.to, 'p1')
})

test('gameplay message before hello is dropped', () => {
   let state = room.createState(0)
   ;({ state } = room.connectSocket(state, 's1', 0))
   const res = room.handleMessage(state, 's1', claim('fire'), 0)
   assert.deepEqual(res.effects, [])
   assert.equal(res.state.players.p1, null)
})
