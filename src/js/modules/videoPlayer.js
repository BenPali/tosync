// modules/videoPlayer.js - Video player controls and synchronization

import { state } from '../state.js';
import { config } from '../config.js';
import { socketManager, uiManager } from '../main.js';

export class VideoPlayer {
    setupEventListeners() {
        state.videoPlayer.removeEventListener('play', this.handlePlay);
        state.videoPlayer.removeEventListener('pause', this.handlePause);
        state.videoPlayer.removeEventListener('ratechange', this.handleRateChange);

        state.videoPlayer.addEventListener('play', this.handlePlay.bind(this));
        state.videoPlayer.addEventListener('pause', this.handlePause.bind(this));
        state.videoPlayer.addEventListener('ratechange', this.handleRateChange.bind(this));
    }

    // Event handlers for automatic synchronization
    handlePlay() {
        if (!state.isReceivingSync && state.isConnected) {
            console.log('Video played, broadcasting sync');
            socketManager.broadcastVideoAction('play', state.videoPlayer.currentTime);
            uiManager.updateLastAction(`${state.userName} played video`);
        }
    }

    handlePause() {
        if (!state.isReceivingSync && state.isConnected) {
            console.log('Video paused, broadcasting sync');
            socketManager.broadcastVideoAction('pause', state.videoPlayer.currentTime);
            uiManager.updateLastAction(`${state.userName} paused video`);
        }
    }

    handleRateChange() {
        if (!state.isReceivingSync && state.isConnected) {
            console.log('Playback rate changed, broadcasting sync');
            socketManager.broadcastVideoAction('playback-rate', state.videoPlayer.currentTime, state.videoPlayer.playbackRate);
            uiManager.updateLastAction(`${state.userName} changed speed to ${state.videoPlayer.playbackRate}x`);
        }
    }

    // Handle video synchronization from other users
    handleVideoSync(data) {
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
        if (state.videoPlayer.paused) {
            state.videoPlayer.play();
        } else {
            state.videoPlayer.pause();
        }
    }

    seekBackward() {
        state.videoPlayer.currentTime = Math.max(0, state.videoPlayer.currentTime - 10);
        socketManager.broadcastVideoAction('seek', state.videoPlayer.currentTime);
    }

    seekForward() {
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
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can restart video');
            return;
        }
        state.videoPlayer.currentTime = 0;
        socketManager.broadcastVideoAction('seek', 0);
    }

    setPlaybackRate(rate) {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can change playback speed');
            return;
        }
        state.videoPlayer.playbackRate = rate;
    }
}