# Task 4 spec: Capacitor iOS shell

Repo: /Users/tanujd/dev/fb-wg. Wraps the finished web client (public/)
in a native iOS app. Xcode 26.6 is installed. Do not touch worker/,
tests/, docs/, or "Game without MP but all levels/".

## Objective

A store-ready-shaped iOS app: the game bundled locally (no remote URL),
native haptics on death, working touch controls (already in the client),
buildable for the iOS simulator from the command line.

## Files / actions

- package.json (root): add @capacitor/core and @capacitor/haptics to
  dependencies; @capacitor/cli and @capacitor/ios to devDependencies.
  npm install.
- capacitor.config.json: {"appId":"dev.tanujd.embersplash",
  "appName":"Ember & Splash","webDir":"public"}. No server.url (assets
  must be bundled; the game reaches the room server via
  public/js/config.js, which already honors window.FBWG_SERVER).
- npx cap add ios  — prefer the Swift Package Manager flavor
  (--packagemanager SPM) if the installed Capacitor supports it, to
  avoid the CocoaPods dependency; fall back to CocoaPods + pod install
  only if SPM is unavailable AND pod exists. Report which path you took.
- public/js/native.js: export initNative() and hapticDeath(). Guarded:
  dynamically import @capacitor/haptics only when
  window.Capacitor?.isNativePlatform?.() is true; otherwise both are
  no-ops. Never let a failed import break the web build.
- public/js/main.js: call initNative() at boot and hapticDeath() where
  the death handling runs (one-line touchpoints only).
- public/index.html: add viewport-fit=cover meta if missing; ensure
  touch controls are not obscured by the home indicator
  (safe-area-inset padding in css).
- README.md: append a short "iOS" section: npm install, npx cap sync
  ios, open ios/App in Xcode, and how to point the app at a deployed
  worker (window.FBWG_SERVER in a small inline script or localStorage).

## Constraints

- The web client must keep working when opened directly in a browser
  with no Capacitor present (guard every native call).
- Do not commit; leave the working tree for review.
- If npx cap add ios generates files with its own formatting, leave
  them as generated.

## Verification (paste real output)

1. npx cap sync ios — success output.
2. xcodebuild -project ios/App/App.xcodeproj -scheme App -destination
   'generic/platform=iOS Simulator' build (or -workspace
   ios/App/App.xcworkspace if CocoaPods path) — must end in BUILD
   SUCCEEDED. Paste the final lines.
3. node --check public/js/native.js and main.js; confirm web still
   loads header-free by serving public/ and checking for JS errors as
   far as headless allows.
