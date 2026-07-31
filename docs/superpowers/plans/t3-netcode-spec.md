# Task 3 spec: WS transport, host-authoritative sync, interpolation, reconnect, cleanup

Repo: /Users/tanujd/dev/fb-wg. This task wires the client (public/) to the
Worker room server (worker/), then removes the legacy stack. Read
docs/protocol.md first; it is the wire contract. Do not touch
"Game without MP but all levels/", images/, maps/ (root), or worker/src
logic (bug reports go back to the architect instead).

## Objective

Replace the mock-only multiplayer with real networking over the room
server, with the sync model: each client simulates its own character;
the host (p1) additionally simulates the shared world; the guest applies
world snapshots. Remote character renders ~100ms in the past via
interpolation. Reconnects inside the 60s server grace resume the game.

## Files

Create:
- public/js/config.js      server base URL: window.FBWG_SERVER || localStorage.getItem('fbwg_server') || 'http://localhost:8787'; export httpBase and wsBase (http->ws swap)
- public/js/transport-ws.js  implements the Transport interface documented in transport-mock.js, over: POST {httpBase}/rooms -> {code}; WebSocket {wsBase}/rooms/{code}/ws; first frame {"t":"hello","name"}; then claim/relay/ping per docs/protocol.md. Auto-reconnect with 1s/2s/4s/8s backoff up to 60s total, re-sending hello with the same name to resume the slot; emits 'reconnecting'/'reconnected' events in addition to the standard ones.
- public/js/netplay.js     the sync layer, interface below
- tests/netsync.test.js

Edit:
- public/js/main.js  wire lobby create/join to transport-ws (keep mock reachable via ?local=1 query param); char select sends claim; on 'start' run netplay session; pause overlay on peer-left/reconnecting with "Waiting for <name>…"; HUD ping readout updated every 2s via protocol ping/pong RTT.
- README.md  rewrite: what this is, how to run (worker dev + static server), how to point clients at a deployed worker, protocol pointer. Short.
- package.json (root)  remove express/socket.io/http deps; scripts: "dev:web" (python3 -m http.server 8080 -d public), "dev:worker" (npm --prefix worker run dev), "test" (node --test tests/).

Delete (legacy, replaced by public/ + worker/):
- server.js, index.html, game.html, "run server.bat", js/game.js, js/collisions.js, js/socket.io.min.js, js/socket.io.min.js.map (remove js/ dir if empty), css/style.css (root css/ dir if empty; public/ has its own)

## netplay.js interface

createSession({transport, isHost, myChar, level, world, chars}) ->
{tick(), onLocalDeath(), onLevelDone(), dispose()} where:
- Outbound: every 3rd sim tick (20Hz) send relay {"t":"state","seq":n,"x","y","vx","vy","anim"} for own char. Host also sends relay {"t":"world","tick",snapshot} whenever serializeWorld output changes, plus at least every 12 ticks (5Hz) as keepalive. Death and level-complete decisions are HOST-only: host sends relay {"t":"event","kind":"death"|"levelDone","level":n}; guest never decides these locally, it reports its own hazard overlap to host via relay {"t":"event","kind":"hazard"} and waits.
- Inbound: state frames with seq <= last seen are dropped; accepted frames push {t, x, y, vx, vy, anim} into a ring buffer; the remote char's render position comes from interpolating the two snapshots straddling (now - 100ms), extrapolating at most 50ms beyond the newest, and snapping when the gap exceeds 60px or on death/level events. world frames: applyWorld. event frames: run the same respawn/advance flow the local sim uses.
- The remote character is never stepped through physics locally; its position is purely interpolated (per architecture decision, guests trust the peer for the peer's own character).

## Constraints

- No new dependencies, ES modules, no build step, 3-space indent, keep
  physics.js/world.js/render.js untouched except where their exported
  API is consumed.
- transport-ws.js and netplay.js must be importable under node --test
  (no DOM at module top level; WebSocket injectable for tests).

## Verification (paste real output in the report)

1. node --test tests/  (all suites, old and new, green). netsync.test.js: with a pair of in-memory fake transports, (a) guest world state equals host's serializeWorld after host presses a button, within one keepalive; (b) stale state frame (seq regress) is ignored; (c) interpolator returns a position strictly between two snapshots for a mid-timestamp and snaps past 60px gaps; (d) host death event resets both sims to spawns; (e) transport-ws reconnect: fake WebSocket that drops once — session resumes, hello re-sent with same name, buffered outbound state resumes.
2. node --check on every created/edited js file.
3. Confirm the deleted files are gone and nothing in public/ references them (grep).
