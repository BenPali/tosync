# Spike: Video.js as ToSync's player — decision record

Prototype built for the comparative study (grid C08.1/C08.2, feeds C06.2).
Status: **evaluated — not adopted as the default player, but implemented in-app
behind a flag** (see below). The default remains native `<video controls>`.

## The in-app prototype (`?player=videojs`)

The integration map below is not theoretical — it is implemented, feature-flagged:
append `?player=videojs` to a room URL on the **private** instance and
`src/js/modules/videojsProto.js` wraps the existing `#videoPlayer` element with
the Video.js chrome (skinned bar, in-bar ±10s buttons wired to the app's own
guarded seek methods). `state.videoPlayer` still points at the same native
element, so the sync engine is untouched — proven by
`tests/e2e/videojs-proto.spec.js`: admin on Video.js + guest on native stay in
sync both directions, and an in-bar button click drives the whole room.
Without the flag the module is never even imported; rollback = remove the flag.

Integration findings the standalone spike could not have caught (all are part
of the study's evidence):

- **CSP**: Video.js embeds its icon font as a `data:` URI — `font-src` needed
  `data:` (private build only) or every control renders as raw text.
- **`video-js` class**: the element must carry it before init or none of the
  player CSS applies (unstyled, invisible chrome).
- **Focus vs hidden subtrees**: hiding a popup that still contains focus makes
  Chromium reset focus asynchronously — move focus out BEFORE hiding.
- **`vjs-has-started`**: the control bar is `display:none` until first play, so
  keyboard reachability of in-bar controls begins at playback start.

### Keyboard accessibility (the C06.2/C20.2 material)

Video.js provides for free: every control is a real `<button>` (Tab +
Enter/Space), the seek bar and volume are ARIA sliders with arrow-key steps,
menus have arrow/Esc handling, and custom controls inherit screen-reader
labels via `controlText()`. The custom subtitle panel matches that bar:
`role="dialog"`, every row a real button with `aria-pressed` state, ArrowUp/
Down navigation, Tab trapped while open, Esc closes and returns focus to the
CC button (`aria-haspopup`/`aria-expanded` kept in sync), keyboard-open moves
focus into the panel, pointer-open doesn't steal it, and panel keyboard use
counts as player activity so the inactivity timer can't dismiss it
mid-navigation. Anti-glow blur is pointer-only (`event.detail`), so keyboard
users never lose their tab position.

## Run it

```bash
python3 -m http.server 8090        # from the repo root
# open http://localhost:8090/proto-videojs/
```

Uses the same 120s test fixture as the e2e suite. No build step, one pinned CDN dependency.

## What the spike demonstrates (each ~10 lines)

1. **Skinning** — the control bar is our DOM: theme color, backgrounds, any CSS. Native controls accept none of this.
2. **In-bar custom controls** — ToSync's ±10s actions as first-class control-bar buttons (with ARIA labels for free via `controlText`). Today these are page buttons *outside* the video and are unreachable in fullscreen.
3. **Role-aware UI** — "guest mode" removes exactly one control (the scrubber) with one CSS class. The native player is all-or-nothing (`controls` on/off).

## Current (native `<video controls>`) vs Video.js

| Criterion | Native (current) | Video.js |
|---|---|---|
| Payload | 0 KB | ~250 KB min. JS + CSS (before plugins) |
| UI consistency | different per browser, not styleable | identical everywhere, fully skinnable |
| Custom buttons in the control bar | impossible (page-level buttons instead) | component API (demo 2) |
| Per-role control removal (guest scrubber) | impossible | one CSS class (demo 3) |
| Controls in fullscreen | native bar only; our page buttons vanish | our bar, everything stays |
| Accessibility | browser-dependent, uneven keyboard/ARIA | consistent ARIA + keyboard out of the box |
| Media event access (sync engine!) | **raw native semantics** | re-emitted through a player layer |
| HLS | hls.js, tuned (`startPosition: 0`, event playlists) | ships its own engine (VHS) — replaces hls.js |
| mpegts.js (IPTV) `attachMediaElement` | direct | needs the underlying tech/el, fights the wrapper |
| Failure surface | browser only | browser + player framework versions |

## Why rejected (the C08.2 argument)

ToSync's sync engine is built on **exact native media-event semantics**: seek
abort-coalescing (`pendingSeekTargets` matching), the pause-queued `timeupdate`
trap, `seeking`-gesture origin capture (`videoPlayer.js`). The P0 stabilization
found and fixed bugs at precisely that layer — possible only because nothing
sits between the sync engine and the element. Video.js inserts exactly such a
layer, and swaps our tuned hls.js pipeline for its own (VHS). The UI gains
(demos 1–3) don't outweigh re-validating the entire sync core against a
wrapper. **Revisit if** product priorities shift toward in-bar role-aware
controls or built-in a11y (see integration map below — the surface is known).

## Integration surface map (adoption *and* rollback walk the same files)

Everything that touches the video element — the complete blast radius of
swapping the player in either direction:

| File | Contact |
|---|---|
| `src/index.public.html` / `src/index.private.html` | the `<video id="videoPlayer">` element |
| `src/js/main.js` | `state.videoPlayer` = the element (single shared reference) |
| `src/js/modules/videoPlayer.js` | native listeners (`play/pause/ratechange/seeked/seeking/timeupdate`), `currentTime` read/write, fullscreen |
| `src/js/modules/socketManager.js` | force-sync `currentTime` writes |
| `src/js/modules/codecUtils.js` | `hls.attachMedia(state.videoPlayer)`, teardown |
| `src/js/modules/mediaManager.js` | `src`/`load()` assignments, `mpegts.attachMediaElement` |
| `src/js/modules/torrentManager.js` | `src`/`load()` on restore |
| `src/js/modules/subtitleManager.js` | `textTracks` / track elements |

Adoption = introduce the wrapper in `main.js`, keep `state.videoPlayer` pointing
at the underlying element (`player.el().querySelector('video')` or `player.tech().el()`)
so the sync engine keeps native events, adapt the rows above one by one.
Rollback = the same rows in reverse. Nothing else in the codebase knows the player exists.
