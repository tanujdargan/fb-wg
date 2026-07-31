// transport-mock.js — local mock implementation of the Transport interface.
//
// Transport interface (contract a later networking task must satisfy):
//
//   createTransport() -> {
//     create({name}) -> Promise<{code}>   // host a new room, get back a join code
//     join({code, name}) -> Promise<void> // join an existing room by code
//     send(obj)                           // send a plain-JSON message
//     on(type, handler)                   // subscribe to an event
//     off(type, handler)                  // unsubscribe (mock-only convenience)
//     close()                             // tear down the connection
//   }
//
//   Events delivered via on(type, handler), payloads are plain objects:
//     'welcome'     {code, name}                 — connection established
//     'peer-joined' {name, id}                   — second player joined the room
//     'peer-left'   {id}                         — second player disconnected
//     'claimed'     {who: 'me'|'peer', element}   — a character was claimed
//     'start'       {fire: 'me'|'peer', water: 'me'|'peer'} — both claimed, go
//     'relay'       obj                          — an application message from the peer
//     'error'       {message}                    — something went wrong
//
// This mock never talks to a network. create()/join() immediately fabricate
// a room; ~500ms later a fake second player "joins". Gameplay is intended to
// run in local 2-player mode: main.js drives the real transport-holder's
// character from keyboard input as usual, and — because there is no actual
// remote peer — ALSO drives the mock peer's character locally from the
// arrow keys on the same keyboard (see main.js / input.js mode 'arrows').
// send()/on('relay', ...) are provided for API completeness so main.js can
// be written the same way it would be against a real transport, but no
// gameplay logic in this mock depends on relaying — the second character is
// simulated directly by the local game loop.

export function createTransport() {
  const handlers = {};
  let closed = false;
  let code = null;
  let claims = {}; // element -> 'me' | 'peer'
  let started = false;
  let peerJoined = false;

  function emit(type, payload) {
    if (closed) return;
    for (const fn of handlers[type] || []) {
      try {
        fn(payload);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[transport-mock] handler for "${type}" threw`, err);
      }
    }
  }

  function on(type, fn) {
    (handlers[type] = handlers[type] || []).push(fn);
  }

  function off(type, fn) {
    if (!handlers[type]) return;
    handlers[type] = handlers[type].filter((f) => f !== fn);
  }

  function genCode() {
    return Math.random().toString(36).slice(2, 7).toUpperCase();
  }

  function beginRoom(name, existingCode) {
    code = existingCode || genCode();
    setTimeout(() => emit('welcome', { code, name }), 0);
    setTimeout(() => {
      if (closed) return;
      peerJoined = true;
      emit('peer-joined', { name: 'Guest (local)', id: 'mock-peer' });
    }, 500);
  }

  function maybeStart() {
    if (started) return;
    if (claims.fire && claims.water) {
      started = true;
      emit('start', { fire: claims.fire, water: claims.water });
    }
  }

  function autoClaimPeer(myElement) {
    const otherElement = myElement === 'fire' ? 'water' : 'fire';
    if (claims[otherElement]) return;
    const fire = () => {
      if (closed || claims[otherElement]) return;
      claims[otherElement] = 'peer';
      emit('claimed', { who: 'peer', element: otherElement });
      maybeStart();
    };
    // Fire after the peer has "joined" so events arrive in a sensible order.
    if (peerJoined) setTimeout(fire, 120);
    else setTimeout(fire, 520);
  }

  return {
    create({ name }) {
      return new Promise((resolve) => {
        beginRoom(name);
        setTimeout(() => resolve({ code }), 0);
      });
    },

    join({ code: joinCode, name }) {
      return new Promise((resolve) => {
        beginRoom(name, joinCode);
        setTimeout(resolve, 0);
      });
    },

    send(obj) {
      if (closed || !obj || typeof obj !== 'object') return;
      if (obj.type === 'claim' && (obj.element === 'fire' || obj.element === 'water')) {
        if (!claims[obj.element]) {
          claims[obj.element] = 'me';
          emit('claimed', { who: 'me', element: obj.element });
          maybeStart();
          autoClaimPeer(obj.element);
        } else {
          emit('error', { message: `character "${obj.element}" is already claimed` });
        }
        return;
      }
      // No real peer to relay to in mock mode; echo back for API parity so
      // code exercising on('relay', ...) still runs in local testing.
      setTimeout(() => emit('relay', obj), 0);
    },

    on,
    off,

    close() {
      closed = true;
    },
  };
}
