# Fireboy & Watergirl online co-op: revival design (v2)

Date: 2026-07-31
Status: Draft v2, awaiting approval. v1 targeted web only on Render;
v2 adds iOS and Android cross-play and removes anything with a cold start.

## Goal

Two friends play a Fireboy & Watergirl style co-op platformer together
remotely via a room code, from any mix of web, iOS, and Android. All three
platforms join the same rooms and play each other. It must feel responsive
(under 100ms perceived lag), survive thousands of total users, have no
cold-start wait anywhere, and run at or near $0/month.

Non-goals, cut on purpose:

- Accounts and Firebase auth. The room code is the auth.
- Anti-cheat. Co-op with a friend has no adversary; we validate inputs to
  protect the server, not gameplay fairness.
- More than 2 players per room, spectators, chat, leaderboards.
- Fully native (Swift/Kotlin) game engines per platform. See Client
  strategy for why, and how the protocol keeps that door open.

## Current state (audit)

| Piece | State |
|---|---|
| `server.js` | Express + Socket.IO relay. Rooms are arbitrary client-chosen strings, capacity is not enforced until "Play", the `users` map leaks empty rooms, and `app.get('*')` serves every file in the repo, including server.js itself |
| `js/game.js` | setInterval(13ms) loop, WASD velocity movement with no gravity or jumping (not a platformer yet), raw coords relayed, no interpolation |
| `game.html` | Contains a debug widget that emits arbitrary socket events. Remove it |
| `maps/level1.json` | Homegrown 29x39 grid format (0/1). Good, keep it |
| `Game without MP but all levels/` | An extracted Microsoft Store Appx of the official copyrighted game (AppxSignature.p7x is still present). The `maps/forest_*.json` files and several sprites also appear ripped |

Legal flag: the official game build and its assets cannot ship anywhere
public, and app stores are stricter than the open web. Both Apple and
Google will reject or take down a clone that uses the original name or
assets. Exclude the folder from all builds, use original or CC-licensed
art and self-authored levels, and ship under a distinct name (for example
"Ember & Splash").

## Client strategy: one codebase, three platforms

Options considered:

**A. One TypeScript canvas game, wrapped with Capacitor for iOS and
Android (recommended).** The game stays a web canvas app. Capacitor wraps
it in a real native shell (WKWebView on iOS, WebView on Android) with
store-ready projects. Cross-play is guaranteed by construction: all three
platforms run byte-identical game code and the same protocol. WebRTC and
WebSockets work inside both webviews (WKWebView has had WebRTC since iOS
14.3). One codebase to maintain.

**B. A cross-platform engine (Godot 4) exporting to web, iOS, and
Android.** One codebase too, and better raw performance, but it means
rewriting the game from scratch in a new toolchain, and the web export is
a heavy wasm bundle. Not worth it for a 2D tile platformer that a canvas
already renders comfortably.

**C. Native game per platform (SpriteKit, Compose, canvas) speaking a
shared protocol.** Best-feeling result and three times the work, with
every gameplay tweak made three times. Rejected.

Decision: A. Two guardrails make it safe:

- The protocol is platform-neutral (JSON over WebSocket and DataChannel,
  documented in this spec). If a fully native client is ever wanted, it
  implements the protocol and joins the same rooms. Host authority makes
  this workable across engines, because the guest applies world state
  rather than re-deriving it.
- Apple guideline 4.2 (minimum functionality) rejects thin website
  wrappers. Mitigation: bundle all assets in the app (no loading a URL),
  work offline for a future solo mode, native haptics on death, and
  proper touch controls. Games in webviews pass review routinely when
  they feel like apps.

Mobile requires on-screen touch controls (left/right/jump zones). These
are part of the client work, not an afterthought; the abandoned Android
button code in `game.js` gets deleted and redone properly.

## Server strategy: no cold starts, no monthly bill

The user constraint: avoid Render (its free tier sleeps and cold-starts
for about 30 seconds) and anything like it. Surveyed free tiers as of
July 2026:

| Provider | Always-free offer | Cold start | Fit |
|---|---|---|---|
| Cloudflare Workers + Durable Objects | 100k requests/day, 313k GB-s/day duration; DO on the free plan since April 2025; WebSocket hibernation makes idle rooms cost nothing | None (V8 isolates, ~ms) | Winner for signaling |
| GCP | e2-micro VM 24/7 forever (3 US regions, 30GB disk, 1GB egress/mo); Cloud Run 2M req/mo | VM: none. Cloud Run: seconds, unless paying for min-instances | Backup option: the VM never sleeps, but 1GB/mo egress rules out any relay traffic, and it is a box to patch |
| AWS | New accounts since July 2025 get $200 in credits for 6 months instead of the old 12-month tier. Lambda and DynamoDB stay always free, but API Gateway WebSockets do not | Lambda cold starts | Rejected: no perpetual free path for a persistent WebSocket endpoint |
| Oracle Cloud | 4 ARM cores / 24GB RAM VM, always free, never sleeps | None | Most raw compute for $0, but signup and capacity reclaim flakiness, plus a box to manage. Backup if we ever need real server relay |
| Fly.io / Railway / Heroku | No perpetual free tier anymore | n/a | Rejected |

Decision: **Cloudflare Workers with one Durable Object per room** for
rooms and signaling, and Cloudflare Pages for the web client. Workers run
as V8 isolates with effectively no cold start, which satisfies the
no-cold-start requirement outright.

Consequences:

- Socket.IO is dropped for plain WebSockets (Workers do not run
  Socket.IO, and every platform speaks raw WS natively anyway). The
  message set is small enough that Socket.IO was only overhead.
- A Durable Object is a tiny stateful actor: the room code routes to
  exactly one DO instance which holds the two sockets, arbitrates
  character claims, and brokers the WebRTC handshake. This replaces the
  in-memory `users` map and its leaks with something that scales
  horizontally by default.
- With hibernation, an idle room consumes nothing. 1000 concurrent
  players is about 500 rooms doing a few dozen signaling messages each,
  far inside 100k requests/day.
- The free plan's request metering is why gameplay must NOT relay through
  the server at scale: every incoming WS message counts. Relayed gameplay
  at 40 msg/s would burn the daily quota in under an hour. TURN, not the
  server, is the fallback transport (next section). During development
  and at small scale, DO relay is fine and is how phase 1 ships.

## Architecture

```
 Web client          iOS app              Android app
 (CF Pages)      (Capacitor shell)     (Capacitor shell)
      \                 |                    /
       \        same TS game core           /
        \               |                  /
         ⇄⇄⇄  WebRTC DataChannel (P2P, 20Hz gameplay)  ⇄⇄⇄
                        |
              TURN fallback (Open Relay free tier)
                        |
        wss:// Cloudflare Worker + Durable Object per room
              (room codes, signaling, dev-scale relay)
```

Any two of the three platforms pair up identically: same code, same
protocol, same rooms.

### Room lifecycle

- Host taps Create. The Worker mints a 5-char code from an unambiguous
  alphabet using `crypto.randomInt` equivalent (no 0/O/1/I, about 28M
  combos) and routes it to a fresh Durable Object.
- Friend enters the code on any platform. The DO enforces capacity 2,
  then brokers the WebRTC offer/answer/ICE exchange between the two
  sockets.
- Characters are claimed first come, first served, arbitrated by the DO.
  This fixes the current race where both players can pick Fireboy.
- Rooms expire after 30 min idle via DO alarms, or when both sockets
  drop. Hibernation means an idle-but-alive room costs nothing.
- Reconnect: the same code within a grace period re-attaches and the game
  pauses while a player is gone. This matters more on mobile, where
  backgrounding the app kills sockets; the client reconnects and resumes
  silently when foregrounded within the grace window.

### Sync model: host-authoritative co-op

- Own character: each client simulates its own character locally with
  zero input latency and sends `{seq, x, y, vx, vy, anim}` at 20Hz.
- Remote character: rendered about 100ms in the past, interpolated
  between the two most recent snapshots. Snap on teleport or death, and
  drop stale packets (seq at or below the last seen).
- Shared world (boxes, buttons, doors, diamonds, deaths, level complete):
  the room creator's device is the authority. It simulates shared objects
  and broadcasts their state, and the guest applies it. The host decides
  level transitions and deaths, so both players always agree on when a
  door opened or a level ended. Because the guest applies state rather
  than re-deriving it, host authority also survives mixed platforms and
  even a future native client. `// ponytail: host authority, not
  lockstep, desync-proof by construction; upgrade path is lockstep if
  latency on shared objects ever feels bad.`

### Game loop and rendering (client rewrite of `game.js`)

- Fixed 60Hz simulation step with an accumulator, rendering on
  `requestAnimationFrame`. This replaces `setInterval(13)` and stops
  physics speed varying with frame rate, battery throttling, and webview
  quirks.
- Real platformer physics: gravity, jumping, and AABB tile collisions
  against the existing grid format. Hand-rolled in about 150 lines, no
  physics engine dependency.
- Element rules (fire hurts Watergirl, water hurts Fireboy, and so on)
  come from extended tile values: 0 empty, 1 solid, 2 fire, 3 water,
  4 goo, 5 button, 6 door, and so on.
- Input is abstracted to `{left, right, jump}` so keyboard (web) and
  touch zones (mobile) feed the same simulation.
- Both characters draw every frame through the same code path. The only
  difference is whose position comes from input and whose comes from the
  network buffer.

### Protocol (identical over DataChannel or WebSocket relay)

Small JSON messages of about 60 bytes: `state` (20Hz per player), `world`
(host to guest, on change plus a 5Hz keepalive), `event` (death,
levelDone, pause), `ping`. Signaling messages: `create`, `join`, `claim`,
`offer`, `answer`, `ice`. This message set is the cross-play contract and
gets written down in `docs/protocol.md`; any client on any platform that
speaks it can play. Binary encoding waits until measurement shows
bandwidth matters.

## Security

- The Worker serves nothing from disk, which retires the current
  serve-the-whole-repo hole (`app.get('*', sendFile)`) along with
  server.js itself.
- Validate at the trust boundary: usernames capped at 16 chars of
  `[a-zA-Z0-9_-]`, room codes format-checked before DO routing, every
  message schema-checked and capped at 1KB, unknown events dropped.
- Rate limits: join attempts per IP via Worker logic (blunts room-code
  brute force), and at most 40 messages/s per socket on the relay path.
- DOM: keep `innerText` for names, and stop using the username as an
  element id. That causes a collision bug today; use a session id.
- Origin checks on the WebSocket upgrade, pinned to the deployed web
  origin plus the Capacitor app origins. TLS comes free with Workers.
- Remove the debug widget from `game.html`.
- Secrets: none exist, since there is no database and no auth, so there
  is nothing to leak.

## Deployment and cost

| Thing | Where | Cost |
|---|---|---|
| Web client and assets | Cloudflare Pages | $0 |
| Rooms + signaling | Cloudflare Workers + Durable Objects free plan | $0 |
| TURN fallback | Open Relay free tier (20GB/mo) | $0 |
| iOS distribution | Apple Developer Program | $99/yr |
| Android distribution | Google Play, one-time registration | $25 once |
| Domain (optional) | anywhere | ~$10/yr |

The store fees are the only unavoidable real money in the whole design,
and they exist only because native apps were requested. A TestFlight/APK
sideload phase can defer both while friends test.

Load math: with P2P gameplay the server handles about 30 signaling
messages per session, not 40 per second per room. 1000 concurrent players
is about 500 rooms, far inside the 100k requests/day free quota, with
idle rooms hibernated at zero cost.

Known ceilings, accepted deliberately:

- Free-plan request metering caps how many rooms can fall back to DO
  relay at once. TURN absorbs the fallback load instead; if Open Relay's
  20GB/mo ever runs dry, the $5/mo Workers paid plan (10M requests/mo)
  or Oracle's free VM as a coturn host are the upgrade paths.
- A DO restart drops its room's sockets. Players re-join with the same
  code, and clients auto-retry.
- Capacitor webview performance is below native. For a 2D tile game at
  60fps this is comfortably fine; if it ever isn't, the protocol lets a
  native client replace the wrapper without touching the server or the
  other platforms.

## Testing

- Physics and collisions are pure functions over the grid, so one small
  headless test file (`node --test`) covers the AABB resolver, tunneling
  at max velocity, and element-versus-tile rules.
- Netcode: a fake-socket harness drives two client sims in one process
  and asserts that shared-world state converges.
- The Worker and DO run locally under `wrangler dev`, so room lifecycle
  tests run in CI without deploying.
- Cross-play matrix before each release: web+web, web+iOS, web+Android,
  iOS+Android. Four pairings, one level each, on real devices.
- Manual latency check: network throttling plus a `?fakelag=150` query
  param that delays the receive buffer.

## Build phases

1. Rebuild the backbone: Worker + DO rooms with codes, capacity,
   validation, rate limits, and expiry; plain-WS client; static client on
   Cloudflare Pages. Gameplay relays through the DO at this scale.
   Playable on the web exactly as today, but safe, shareable, and with no
   cold start.
2. Make it a real game: fixed-timestep loop, platformer physics, element
   tiles, deaths, level complete flowing into the next level, 3 to 5
   original levels in the existing grid format, original placeholder art,
   input abstraction with touch zones testable in mobile Safari/Chrome.
3. Make it feel good: 20Hz snapshots with interpolation,
   host-authoritative shared objects, reconnect grace, a ping display.
4. Make it scale at $0: WebRTC DataChannel with DO signaling, TURN
   fallback, auto-negotiated at room start. DO relay remains only as the
   last-resort transport.
5. Ship the apps: Capacitor shells for iOS and Android, bundled assets,
   haptics, app icons, store metadata, the cross-play test matrix, then
   TestFlight and Play internal testing before public store submission.

Each phase ships something playable, and the project can stop after any
phase while still being strictly better than today.
