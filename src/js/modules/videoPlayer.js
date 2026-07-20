// modules/videoPlayer.js - Video player controls and synchronization

import { state } from '../state.js';
import { config } from '../config.js';
import { socketManager, uiManager } from '../main.js';

export class VideoPlayer {
    constructor() {
        this._boundHandlePlay = this.handlePlay.bind(this);
        this._boundHandlePause = this.handlePause.bind(this);
        this._boundHandleRateChange = this.handleRateChange.bind(this);
        this._boundHandleSeeked = this.handleSeeked.bind(this);
        this._boundHandleSeeking = this.handleSeeking.bind(this);
        this._boundHandleTimeUpdate = this.handleTimeUpdate.bind(this);
    }

    setupEventListeners() {
        state.videoPlayer.removeEventListener('play', this._boundHandlePlay);
        state.videoPlayer.removeEventListener('pause', this._boundHandlePause);
        state.videoPlayer.removeEventListener('ratechange', this._boundHandleRateChange);
        state.videoPlayer.removeEventListener('seeked', this._boundHandleSeeked);
        state.videoPlayer.removeEventListener('seeking', this._boundHandleSeeking);
        state.videoPlayer.removeEventListener('timeupdate', this._boundHandleTimeUpdate);

        state.videoPlayer.addEventListener('play', this._boundHandlePlay);
        state.videoPlayer.addEventListener('pause', this._boundHandlePause);
        state.videoPlayer.addEventListener('ratechange', this._boundHandleRateChange);
        state.videoPlayer.addEventListener('seeked', this._boundHandleSeeked);
        state.videoPlayer.addEventListener('seeking', this._boundHandleSeeking);
        state.videoPlayer.addEventListener('timeupdate', this._boundHandleTimeUpdate);
    }

    // Event handlers for automatic synchronization
    handlePlay() {
        if (state.isLiveStream) return;
        if (!state.isReceivingSync && state.isConnected) {
            socketManager.broadcastVideoAction('play', state.videoPlayer.currentTime);
            uiManager.updateLastAction(`${state.userName} played video`);
        }
    }

    handlePause() {
        if (state.isLiveStream) return;
        if (!state.isReceivingSync && state.isConnected) {
            socketManager.broadcastVideoAction('pause', state.videoPlayer.currentTime);
            uiManager.updateLastAction(`${state.userName} paused video`);
        }
    }

    handleRateChange() {
        if (state.isLiveStream) return;
        if (!state.isReceivingSync && state.isConnected) {
            socketManager.broadcastVideoAction(
                'playback-rate',
                state.videoPlayer.currentTime,
                state.videoPlayer.playbackRate
            );
            uiManager.updateLastAction(`${state.userName} changed speed to ${state.videoPlayer.playbackRate}x`);
        }
    }

    // Track the playhead during normal playback. The seek algorithm also fires
    // a timeupdate right before `seeked` (with seeking already false), so after
    // any completed seek this ends up at the landing position — which is
    // exactly what the NEXT seek's origin should be.
    handleTimeUpdate() {
        // Mid-seek timeupdates read the seek TARGET, not the playhead: handlers
        // see the live currentTime, and a seek updates it synchronously — e.g.
        // pause() queues a timeupdate that dispatches only after a same-tick
        // `currentTime = 0` write. Letting that through would zero the origin
        // and make the restart look like a no-move seek.
        if (state.videoPlayer.seeking) return;
        state.lastPlayheadPosition = state.videoPlayer.currentTime;
    }

    // `seeking` fires when a seek starts, before its completion timeupdate has
    // moved lastPlayheadPosition — so this captures where the playhead was
    // BEFORE the seek. Re-anchored only at gesture START: during a continuous
    // scrub (another seek completed <500ms ago) the original origin is kept, so
    // the drag's TOTAL displacement is measured — per-step increments would
    // each fall under the broadcast tolerance and a slow drag would silently
    // never sync.
    handleSeeking() {
        if (Date.now() - state.lastSeekedAt > 500) {
            state.seekOriginPosition = state.lastPlayheadPosition;
        }
    }

    // The native <video controls> timeline lets anyone scrub, so seeking is the
    // most common action — yet without this listener a scrub is applied locally
    // and never announced, silently desyncing the room. This is the single
    // outbound path for every seek (native scrubber, ±10s keys, restart).
    handleSeeked() {
        if (state.isLiveStream) return;
        // A `seeked` on a metadata-less element is teardown noise from a media
        // switch, never a real seek (seeks require a seekable range).
        if (state.videoPlayer.readyState < 1) return;
        const pos = state.videoPlayer.currentTime;
        state.lastSeekedAt = Date.now();
        // The completed seek's landing position is the playhead now (normally
        // the completion timeupdate already did this; kept for engine quirks).
        state.lastPlayheadPosition = pos;

        // Echo of a programmatic (sync/restore/force-sync) seek: consume it and
        // don't rebroadcast. Matched by landing position: the browser aborts an
        // in-flight seek WITHOUT firing its `seeked` when a newer seek
        // supersedes it, so consuming the matched target and everything queued
        // before it mirrors that coalescing exactly — no leak, no over-eat.
        const idx = state.pendingSeekTargets.findIndex((t) => Math.abs(pos - t) < 0.5);
        if (idx !== -1) {
            state.pendingSeekTargets.splice(0, idx + 1);
            return;
        }
        // No match -> a user seek. It also aborted any programmatic seek still
        // in flight, so those echoes will never arrive — drop them.
        state.pendingSeekTargets.length = 0;

        // Sub-tolerance jumps are in-sync by definition, and are what hls.js
        // stall-recovery gap-nudges look like — don't spam the room with them.
        if (Math.abs(pos - state.seekOriginPosition) < config.SYNC_TOLERANCE) return;

        // NOTE: deliberately NOT gated on isReceivingSync. Seek echo is already
        // suppressed precisely by the target queue above, so the blunt 300ms
        // flag is redundant here and would wrongly drop a genuine user seek
        // made within 300ms of an incoming sync (e.g. grabbing the scrubber
        // right after the room jumped). play/pause still use the flag — they
        // have no queue.
        if (state.isConnected) {
            socketManager.broadcastVideoAction('seek', pos);
            uiManager.updateLastAction(`${state.userName} seeked video`);
        }
    }

    // Seeking before metadata is loaded is silently dropped by the browser,
    // which would leave this client out of sync. Defer until seekable, and tie
    // the listener to the current media load so a media change cancels it.
    seekWhenReady(t) {
        const v = state.videoPlayer;
        const applySeek = () => {
            // Clamp to duration: a target past the end would land at the clamp
            // position and never match its queued suppression target.
            const target = Number.isFinite(v.duration) ? Math.min(t, v.duration) : t;
            // A currentTime write only emits `seeked` when the value actually
            // changes; only queue a suppression target for real writes,
            // otherwise the stale target could eat a later user seek.
            if (Math.abs(v.currentTime - target) < 0.01) return;
            state.pendingSeekTargets.push(target);
            v.currentTime = target;
        };
        if (v.readyState >= 1) {
            applySeek();
        } else {
            v.addEventListener('loadedmetadata', applySeek, {
                once: true,
                signal: state.mediaLoadAbort?.signal
            });
        }
    }

    // Handle video synchronization from other users.
    // NOTE: incoming events are never early-returned on isReceivingSync — that
    // flag only suppresses OUR local echo (see the handlers above). Dropping
    // incoming events here was the bug where a second remote action arriving
    // within the suppression window (e.g. pause-then-seek) was silently lost.
    handleVideoSync(data) {
        if (state.isLiveStream) return;
        if (!data) return;

        state.isReceivingSync = true;
        // Reset the suppression flag in a finally so a throw mid-switch can't
        // leave it stuck true, which would silently drop every future sync.
        try {
            const syncTolerance = config.SYNC_TOLERANCE;

            switch (data.action) {
                case 'play':
                    if (state.videoPlayer.paused) {
                        // typeof check, not truthiness: time 0 is a valid position
                        // (a play/pause at the very start must still correct us).
                        if (
                            typeof data.time === 'number' &&
                            Math.abs(state.videoPlayer.currentTime - data.time) > syncTolerance
                        ) {
                            this.seekWhenReady(data.time);
                        }
                        state.videoPlayer.play().catch((e) => console.log('Auto-play prevented:', e));
                    }
                    break;
                case 'pause':
                    if (!state.videoPlayer.paused) {
                        if (
                            typeof data.time === 'number' &&
                            Math.abs(state.videoPlayer.currentTime - data.time) > syncTolerance
                        ) {
                            this.seekWhenReady(data.time);
                        }
                        state.videoPlayer.pause();
                    }
                    break;
                case 'seek': {
                    // Within-tolerance positions are already in sync — skipping
                    // avoids visible micro-yanks when a peer's seek lands near
                    // where this client already is.
                    const t = data.time || 0;
                    if (Math.abs(state.videoPlayer.currentTime - t) > syncTolerance) {
                        this.seekWhenReady(t);
                    }
                    break;
                }
                case 'playback-rate':
                    state.videoPlayer.playbackRate = data.playbackRate || 1;
                    if (
                        data.time !== undefined &&
                        Math.abs(state.videoPlayer.currentTime - data.time) > syncTolerance
                    ) {
                        this.seekWhenReady(data.time);
                    }
                    break;
            }

            uiManager.updateLastAction(`${data.user} ${data.action}`);
        } finally {
            // Shared timer: a second sync arriving inside the window must extend
            // it, not have the first sync's timer clear the flag early (which
            // would let the second sync's play/pause echo broadcast).
            clearTimeout(state.receivingSyncTimer);
            state.receivingSyncTimer = setTimeout(() => {
                state.isReceivingSync = false;
            }, 300);
        }
    }

    // Video control functions
    togglePlay() {
        if (state.isLiveStream) return;
        if (state.videoPlayer.paused) {
            state.videoPlayer.play().catch(() => {});
        } else {
            state.videoPlayer.pause();
        }
    }

    seekBackward() {
        if (state.isLiveStream) return;
        // Before metadata, currentTime writes are dropped by the browser; guard
        // so we don't broadcast a bogus position.
        if (state.videoPlayer.readyState < 1) return;
        state.videoPlayer.currentTime = Math.max(0, state.videoPlayer.currentTime - 10);
        // Broadcast is emitted by the `seeked` listener (single seek path).
    }

    seekForward() {
        if (state.isLiveStream) return;
        // Guard before metadata: duration is NaN -> Math.min(0, ...) would seek
        // to 0 and rewind the whole room. readyState < 1 means not yet seekable.
        if (state.videoPlayer.readyState < 1) return;
        state.videoPlayer.currentTime = Math.min(state.videoPlayer.duration || 0, state.videoPlayer.currentTime + 10);
        // Broadcast is emitted by the `seeked` listener (single seek path).
    }

    toggleFullscreen() {
        const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
        if (fsElement) {
            (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
            return;
        }
        const container = state.videoPlayer?.parentElement;
        if (!container) return;
        const requestOn = (el) =>
            (el.requestFullscreen || el.webkitRequestFullscreen || el.webkitEnterFullscreen)?.call(el);
        try {
            const result = requestOn(container);
            // If the container request rejects (e.g. blocked), fall back to native
            // video fullscreen, which reliably fills the whole screen.
            if (result && typeof result.catch === 'function') {
                result.catch((err) => {
                    console.warn('Container fullscreen failed, using native video fullscreen:', err?.message || err);
                    requestOn(state.videoPlayer);
                });
            }
        } catch (err) {
            console.warn('Fullscreen error, using native video fullscreen:', err?.message || err);
            requestOn(state.videoPlayer);
        }
    }

    syncTime() {
        if (state.isLiveStream) return;
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can force sync');
            return;
        }

        if (state.socket && state.isConnected) {
            state.socket.emit('force-sync', {
                time: state.videoPlayer.currentTime,
                isPlaying: !state.videoPlayer.paused
            });
        }

        uiManager.updateLastAction('Force sync initiated');
    }

    restartVideo() {
        if (state.isLiveStream) return;
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can restart video');
            return;
        }
        state.videoPlayer.currentTime = 0;
        // Broadcast is emitted by the `seeked` listener (single seek path).
    }

    setPlaybackRate(rate) {
        if (state.isLiveStream) return;
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can change playback speed');
            return;
        }
        state.videoPlayer.playbackRate = rate;
    }
}
