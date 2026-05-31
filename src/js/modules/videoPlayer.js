// modules/videoPlayer.js - Video player controls and synchronization

import { state } from '../state.js';
import { config } from '../config.js';
import { socketManager, uiManager } from '../main.js';

export class VideoPlayer {
    constructor() {
        this._boundHandlePlay = this.handlePlay.bind(this);
        this._boundHandlePause = this.handlePause.bind(this);
        this._boundHandleRateChange = this.handleRateChange.bind(this);
    }

    setupEventListeners() {
        state.videoPlayer.removeEventListener('play', this._boundHandlePlay);
        state.videoPlayer.removeEventListener('pause', this._boundHandlePause);
        state.videoPlayer.removeEventListener('ratechange', this._boundHandleRateChange);

        state.videoPlayer.addEventListener('play', this._boundHandlePlay);
        state.videoPlayer.addEventListener('pause', this._boundHandlePause);
        state.videoPlayer.addEventListener('ratechange', this._boundHandleRateChange);
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
            socketManager.broadcastVideoAction('playback-rate', state.videoPlayer.currentTime, state.videoPlayer.playbackRate);
            uiManager.updateLastAction(`${state.userName} changed speed to ${state.videoPlayer.playbackRate}x`);
        }
    }

    // Seeking before metadata is loaded is silently dropped by the browser,
    // which would leave this client out of sync. Defer until seekable, and tie
    // the listener to the current media load so a media change cancels it.
    seekWhenReady(t) {
        const v = state.videoPlayer;
        if (v.readyState >= 1) {
            v.currentTime = t;
        } else {
            v.addEventListener('loadedmetadata', () => { v.currentTime = t; }, {
                once: true,
                signal: state.mediaLoadAbort?.signal
            });
        }
    }

    // Handle video synchronization from other users
    handleVideoSync(data) {
        if (state.isLiveStream) return;
        if (state.isReceivingSync) return;
        if (!data) return;

        state.isReceivingSync = true;
        // Reset the suppression flag in a finally so a throw mid-switch can't
        // leave it stuck true, which would silently drop every future sync.
        try {
            const syncTolerance = config.SYNC_TOLERANCE;

            switch (data.action) {
                case 'play':
                    if (state.videoPlayer.paused) {
                        if (data.time && Math.abs(state.videoPlayer.currentTime - data.time) > syncTolerance) {
                            this.seekWhenReady(data.time);
                        }
                        state.videoPlayer.play().catch(e => console.log('Auto-play prevented:', e));
                    }
                    break;
                case 'pause':
                    if (!state.videoPlayer.paused) {
                        if (data.time && Math.abs(state.videoPlayer.currentTime - data.time) > syncTolerance) {
                            this.seekWhenReady(data.time);
                        }
                        state.videoPlayer.pause();
                    }
                    break;
                case 'seek':
                    this.seekWhenReady(data.time || 0);
                    break;
                case 'playback-rate':
                    state.videoPlayer.playbackRate = data.playbackRate || 1;
                    if (data.time !== undefined && Math.abs(state.videoPlayer.currentTime - data.time) > syncTolerance) {
                        this.seekWhenReady(data.time);
                    }
                    break;
            }

            uiManager.updateLastAction(`${data.user} ${data.action}`);
        } finally {
            setTimeout(() => {
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
        state.videoPlayer.currentTime = Math.max(0, state.videoPlayer.currentTime - 10);
        socketManager.broadcastVideoAction('seek', state.videoPlayer.currentTime);
    }

    seekForward() {
        if (state.isLiveStream) return;
        state.videoPlayer.currentTime = Math.min(state.videoPlayer.duration || 0, state.videoPlayer.currentTime + 10);
        socketManager.broadcastVideoAction('seek', state.videoPlayer.currentTime);
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
        socketManager.broadcastVideoAction('seek', 0);
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