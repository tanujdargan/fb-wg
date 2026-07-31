# fbwg-rooms protocol

This document is the cross-platform contract for the `fbwg-rooms` Cloudflare
Worker (`worker/`), which provides room creation, capacity-2 rooms,
character claiming, and verbatim message relay between two players over
plain WebSockets. It replaces the legacy Express/Socket.IO `server.js`.

## HTTP

### `POST /rooms`

Creates a room code. No body required.

Response `200`:

```json
{ "code": "XXXXX" }
```

`code` is 5 characters drawn from the alphabet
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no `0`, `O`, `1`, `I`), generated with
`crypto.getRandomValues`. There is no server-side registry lookup for
uniqueness -- collisions are statistically negligible, and if a stale room
already has 2 players, a third attempt to join it is rejected with `FULL`
(see below).

### `GET /rooms/:code/ws`

Must be a WebSocket upgrade request (`Upgrade: websocket`). Routed to the
room's Durable Object via `idFromName(code)`. Any other route returns `404`.
The Worker serves no static files.

**Origin check on upgrade:** the request is allowed if the `Origin` header
is absent (native shells have no Origin), or its host is `localhost` /
`127.0.0.1`, or the origin exactly equals `env.ALLOWED_ORIGIN` (if that
binding is set). Otherwise the upgrade is rejected with `403`.

## WebSocket protocol

All frames are JSON text frames. Every message has a `"t"` field naming its
type. Raw frame size is capped at 1024 bytes; anything larger, anything
that doesn't parse as a JSON object, or anything with an unrecognized `"t"`
is silently dropped. After 10 consecutive invalid frames on a socket, the
socket is closed with WebSocket close code **4002**.

The first message on a socket must be `hello`. Any gameplay message
received before `hello` is dropped.

Each socket is rate-limited to 40 messages/second (sliding/fixed window).
Frames beyond the limit are dropped. Three consecutive 1-second windows in
violation of the limit close the socket with code **4008**.

An idle room (no messages on any of its sockets for 30 minutes) has its
sockets closed and its Durable Object storage cleared.

### Client -> server

#### `hello`

First message after connecting.

```json
{ "t": "hello", "name": "Alice" }
```

- `name` must match `/^[a-zA-Z0-9_-]{1,16}$/`. An invalid name is dropped
  (treated as an invalid frame).
- The first socket to say `hello` in a room becomes `p1` (the host); the
  second becomes `p2`.
- **Reconnect grace:** if a player with the same `name` disconnected less
  than 60 seconds ago, the new socket takes over that player's slot,
  keeping its `playerId` and any previously claimed `char`. The peer is
  notified with `peer-rejoined`. After the 60s grace window has elapsed,
  a `hello` with that name is instead treated as a brand-new join (fresh
  `char: null`) into whichever slot is free.
- If the room already has two live players (connected, or disconnected but
  still within their own grace window) and this `hello`'s name does not
  match one of those disconnected players within grace, the server replies
  with an `error` (`FULL`) and then closes the socket with code **4001**.

Server reply, always sent to the connecting socket only:

```json
{
   "t": "welcome",
   "playerId": "p1",
   "host": true,
   "peer": null
}
```

`peer` is `null` if no second player has joined yet, otherwise
`{ "name": "...", "char": "fire" | "water" | null }` describing the other
player.

#### `claim`

```json
{ "t": "claim", "char": "fire" }
```

`char` must be `"fire"` or `"water"`.

- If the peer has already claimed that character, the server replies (to
  the claimant only) with `{ "t": "error", "code": "TAKEN" }`.
- Otherwise the claim succeeds and is broadcast to both players:

  ```json
  { "t": "claimed", "playerId": "p1", "char": "fire" }
  ```

  Once both `p1` and `p2` have claimed a character, the server also
  broadcasts:

  ```json
  { "t": "start", "hostId": "p1" }
  ```

#### `relay`

```json
{ "t": "relay", "d": { "...": "any object, whole frame <= 1KB" } }
```

Forwarded verbatim to the other socket as `{ "t": "relay", "d": ... }`. If
no peer is currently connected, the message is dropped silently.

#### `ping`

```json
{ "t": "ping" }
```

Server replies to the sender only:

```json
{ "t": "pong", "now": 1732300000000 }
```

### Server -> client (unsolicited)

- `{ "t": "peer-joined", "name": "Bob" }` -- sent to the existing player
  when the second player says `hello`.
- `{ "t": "peer-rejoined", "name": "Bob" }` -- sent to the other player
  when a disconnected player reconnects within the grace window.
- `{ "t": "peer-left" }` -- sent to the remaining connected player when the
  other player's socket closes.

### Close codes

| Code | Meaning |
|------|---------|
| 4001 | Room already has two live players (`FULL`) |
| 4002 | 10 consecutive invalid/malformed frames |
| 4008 | Sustained rate-limit abuse (3 consecutive over-limit windows) |
| 4000 | Room idle for 30 minutes; server-initiated close |

## Implementation notes

- `worker/src/room-logic.js` is a pure, environment-free state machine
  (no `Date.now()`, no I/O) operating on a plain state object and taking
  timestamps as parameters. It is unit-tested directly under
  `node --test` (see `tests/room.test.js`).
- `worker/src/index.js` is a thin adapter: HTTP routing, the WebSocket
  Hibernation API (`state.acceptWebSocket`, `webSocketMessage`,
  `webSocketClose`, tags for reaching a given player's socket,
  `serializeAttachment`/`deserializeAttachment` for per-socket identity),
  Durable Object storage, and the idle alarm. It contains no game-room
  decision logic itself -- it only turns `room-logic.js` effects into real
  `send`/`close` calls.
