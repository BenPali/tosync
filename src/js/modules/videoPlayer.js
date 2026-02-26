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

    // Handle video synchronization from other users
    handleVideoSync(data) {
        if (state.isLiveStream) return;
        if (state.isReceivingSync) return;

        state.isReceivingSync = true;
        const syncTolerance = config.SYNC_TOLERANCE;

        switch (data.action) {
            case 'play':
                if (state.videoPlayer.paused) {
                    if (data.time && Math.abs(state.videoPlayer.currentTime - data.time) > syncTolerance) {
                        state.videoPlayer.currentTime = data.time;
                    }
                    state.videoPlayer.play().catch(e => console.log('Auto-play prevented:', e));
                }
                break;
            case 'pause':
                if (!state.videoPlayer.paused) {
                    if (data.time && Math.abs(state.videoPlayer.currentTime - data.time) > syncTolerance) {
                        state.videoPlayer.currentTime = data.time;
                    }
                    state.videoPlayer.pause();
                }
                break;
            case 'seek':
                state.videoPlayer.currentTime = data.time || 0;
                break;
            case 'playback-rate':
                state.videoPlayer.playbackRate = data.playbackRate || 1;
                if (data.time !== undefined && Math.abs(state.videoPlayer.currentTime - data.time) > syncTolerance) {
                    state.videoPlayer.currentTime = data.time;
                }
                break;
        }

        uiManager.updateLastAction(`${data.user} ${data.action}`);

        setTimeout(() => {
            state.isReceivingSync = false;
        }, 300);
    }

    // Video control functions
    togglePlay() {
        if (state.isLiveStream) return;
        if (state.videoPlayer.paused) {
            state.videoPlayer.play();
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
        const videoContainer = document.querySelector('.video-container');

        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            videoContainer.requestFullscreen();
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