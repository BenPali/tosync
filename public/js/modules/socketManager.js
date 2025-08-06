// modules/socketManager.js - Socket.IO connection management

import { state } from '../state.js';
import { config } from '../config.js';
import { videoPlayer, mediaManager, torrentManager, subtitleManager, authManager, uiManager } from '../main.js';

export class SocketManager {
    initializeSocket() {
        state.socket = io();

        state.socket.on('connect', () => {
            console.log('Connected to server');
            state.isConnected = true;
            uiManager.updateConnectionStatus('Connected to server', 'connected');

            state.socket.emit('join-room', {
                roomId: state.currentRoomId,
                userName: state.userName,
                userRole: state.userRole,
                isCreator: state.isRoomCreator
            });
        });

        state.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            state.isConnected = false;
            uiManager.updateConnectionStatus('Disconnected from server', 'disconnected');
        });

        state.socket.on('room-not-found', () => {
            console.log('Room not found');
            const guestJoinError = document.getElementById('guestJoinError');
            if (guestJoinError) {
                guestJoinError.classList.remove('hidden');
            }
            // Don't reset role since user hasn't set one yet
        });

        state.socket.on('room-state', (data) => {
            console.log('Received room state:', data);
            uiManager.updateRoomStatus(`Connected to room ${state.currentRoomId}`);
            uiManager.updateUsersList(data.users);

            // Update current room code display
            document.getElementById('currentRoomCode').textContent = state.currentRoomId;

            // Restore subtitles
            if (data.subtitles) {
                state.availableSubtitles = data.subtitles;
                subtitleManager.updateSubtitlesList();
            }

            if (data.currentMedia) {
                console.log('Restoring media state:', data.currentMedia);

                if (data.currentMedia.type === 'file') {
                    mediaManager.restoreFileMedia(data.currentMedia, data.videoState);
                } else if (data.currentMedia.type === 'torrent') {
                    torrentManager.restoreTorrentMedia(data.currentMedia, data.videoState);
                }
            }
        });

        state.socket.on('sync-video', (data) => {
            videoPlayer.handleVideoSync(data);
        });

        state.socket.on('media-update', (data) => {
            mediaManager.handleMediaUpdate(data);
        });

        state.socket.on('torrent-progress', (data) => {
            if (state.currentTorrentInfo && data.infoHash === state.currentTorrentInfo.infoHash) {
                torrentManager.updateTorrentProgressUI(data);
            }
        });

        state.socket.on('users-update', (data) => {
            uiManager.updateUsersList(data.users);
        });

        state.socket.on('user-joined', (data) => {
            uiManager.updateLastAction(`${data.user.name} joined (${data.user.role})`);
        });

        state.socket.on('user-left', (data) => {
            uiManager.updateLastAction(`${data.user.name} left`);
        });

        state.socket.on('force-sync', (data) => {
            state.isReceivingSync = true;
            state.videoPlayer.currentTime = data.time;
            if (data.isPlaying && state.videoPlayer.paused) {
                state.videoPlayer.play().catch(e => console.log('Auto-play prevented:', e));
            } else if (!data.isPlaying && !state.videoPlayer.paused) {
                state.videoPlayer.pause();
            }
            uiManager.updateLastAction(`${data.user} forced sync`);
            setTimeout(() => {
                state.isReceivingSync = false;
            }, 100);
        });

        state.socket.on('error', (data) => {
            uiManager.showError(data.message);
        });

        // Subtitle-related events
        state.socket.on('subtitle-added', (data) => {
            console.log('Subtitle added:', data.subtitle);
            state.availableSubtitles.push(data.subtitle);
            subtitleManager.updateSubtitlesList();
            uiManager.updateLastAction(`${data.user} added subtitle: ${data.subtitle.label}`);
        });

        state.socket.on('subtitle-selected', (data) => {
            console.log('Subtitle selected:', data.subtitleId);
            uiManager.updateLastAction(`${data.user} selected subtitle`);
        });

        // Admin transfer events
        state.socket.on('admin-transferred', (data) => {
            console.log('Admin transferred:', data);
            authManager.handleAdminTransferred(data);
        });

        state.socket.on('transfer-admin-error', (data) => {
            console.log('Admin transfer error:', data.message);
            uiManager.showError(data.message);
        });

        // User kick events
        state.socket.on('user-kicked', (data) => {
            console.log('User kicked:', data);
            authManager.handleUserKicked(data);
        });

        state.socket.on('kick-user-error', (data) => {
            console.log('Kick user error:', data.message);
            uiManager.showError(data.message);
        });

    }

    // Send video actions to server
    broadcastVideoAction(action, time, playbackRate) {
        if (!state.socket || !state.isConnected || state.isReceivingSync) return;

        const now = Date.now();
        if (now - state.lastSyncTime < config.SYNC_THROTTLE_DELAY) {
            return;
        }
        state.lastSyncTime = now;

        state.socket.emit('video-action', {
            action: action,
            time: time,
            playbackRate: playbackRate
        });
    }

    // Send media actions to server
    broadcastMediaAction(action, mediaData) {
        if (!state.socket || !state.isConnected || state.userRole !== 'admin') return;

        // Create a unique key for this action to prevent duplicates
        const actionKey = `${action}-${JSON.stringify(mediaData)}`;

        // Prevent duplicate actions within a short time window
        if (state.lastMediaAction && state.lastMediaAction.key === actionKey &&
            Date.now() - state.lastMediaAction.timestamp < 2000) {
            console.log('Preventing duplicate media action:', action);
            return;
        }

        state.lastMediaAction = {
            key: actionKey,
            action: action,
            mediaData: mediaData,
            timestamp: Date.now()
        };

        console.log('Broadcasting media action:', action);
        state.socket.emit('media-action', {
            action: action,
            mediaData: mediaData
        });
    }
}