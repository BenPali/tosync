# Spike: WebRTC peer-to-peer sync — decision record

Prototype built for the comparative study (grid C08.1/C08.2).
Status: **evaluated, rejected — ToSync uses server-authoritative sync over Socket.IO**.

## Run it

```bash
python3 -m http.server 8090        # from the repo root
# open http://localhost:8090/proto-webrtc-sync/
```

Two **real** `RTCPeerConnection`s + a DataChannel, both peers in one page so the
spike is demoable without infrastructure. Press play/pause/scrub on either video:
the other follows. Then press the conflict button.

## What it proves

1. **It works** — for 2 peers, playback sync over a DataChannel is ~40 lines.
   The comparison is honest: this was a viable candidate, not a strawman.
2. **"Serverless" is fiction** — the SDP offer/answer exchange here is a
   same-page variable. Across real machines that variable *is a server*
   (signaling), plus STUN/TURN for NAT. WebRTC never removes the server; it only
   demotes it from state-holder to relay.
3. **No authority ⇒ permanent divergence** — the conflict button fires two
   "simultaneous" scrubs. Each peer applies its own, then the other's arrives:
   they end up **swapped** (A at B's target and vice versa), ~60s apart, forever.
   Neither peer is wrong; there is no arbiter. This is the exact failure class a
   server-side authoritative `videoState` eliminates — every action is serialized
   through one owner and late joiners get one truth (`room.videoState` +
   force-sync in `server.js`).
4. **Mesh cost** — N viewers = N·(N−1)/2 connections, each peer uploads to every
   other. ToSync targets living-room groups on home connections; a star topology
   through the server is O(N) and the server has the bandwidth.
5. Bonus finding: the spike needs the same **echo suppression** ToSync does (the
   `applying` flag) — and its naive 150 ms timer version is exactly the fragile
   design ToSync's P0 work replaced with position-matched suppression targets.

## Verdict

| | P2P (this spike) | Server-authoritative (ToSync) |
|---|---|---|
| Infra | signaling + STUN/TURN anyway | one Socket.IO server |
| Topology | O(N²) mesh | O(N) star |
| Conflicts | undefined (divergence demo) | serialized by the server |
| Late join | ask a peer — which one? | `room.videoState`, one truth |
| NAT/firewalls | TURN relay fallback needed | plain WebSocket, works everywhere |

Where P2P *would* win: media-heavy fan-out (each peer relaying video chunks —
CDN-less distribution). ToSync's sync messages are ~100 bytes; the bottleneck
P2P solves does not exist here.
