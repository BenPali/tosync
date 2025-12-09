// modules/socketManager.js - Socket.IO connection management

import { state } from '../state.js';
import { config } from '../config.js';
import { videoPlayer, mediaManager, torrentManager, subtitleManager, authManager, uiManager } from '../main.js';

export class SocketManager {
    initializeSocket() {
        state.socket = io({
            withCredentials: true,
            transports: ['websocket'],
            upgrade: false
        });

        state.socket.on('connect', () => {
            state.isConnected = true;
            uiManager.updateConnectionStatus('Connected to server', 'connected');

            state.socket.emit('join-room', {
                roomId: state.currentRoomId,
                userName: state.userName,
                isCreator: state.isRoomCreator
            });
        });

        state.socket.on('disconnect', () => {
            state.isConnected = false;
            uiManager.updateConnectionStatus('Disconnected from server', 'disconnected');
        });

        state.socket.on('room-not-found', () => {

            // Check if we came from a direct URL
            const pathParts = window.location.pathname.split('/');
            const roomCode = pathParts[1];

            if (roomCode && roomCode.length === 6) {
                // Direct URL access - show room not found page
                document.getElementById('roomSelector').classList.add('hidden');
                document.getElementById('guestJoinForm')?.remove();
                document.getElementById('roomNotFound').classList.remove('hidden');
                document.getElementById('invalidRoomCode').textContent = roomCode.toUpperCase();

                // Set up go back button
                document.getElementById('goBackHomeBtn').addEventListener('click', () => {
                    window.history.pushState({}, '', '/');
                    location.reload();
                });
            } else {
                // Form submission - show inline error
                const guestJoinError = document.getElementById('guestJoinError');
                if (guestJoinError) {
                    guestJoinError.classList.remove('hidden');
                }
            }
        });

        state.socket.on('room-state', (data) => {
            uiManager.updateRoomStatus(`Connected to room ${state.currentRoomId}`);
            uiManager.updateUsersList(data.users);

            // Check if our role was changed by the server (auto-promotion)
            const ourUser = data.users.find(user => user.id === state.socket.id);
            if (ourUser && ourUser.role !== state.userRole) {
                state.userRole = ourUser.role;
                authManager.updateUIForRole(ourUser.role, state.userName);
            }

            // Update current room code display
            document.getElementById('currentRoomCode').textContent = state.currentRoomId;

            // Restore subtitles
            if (data.subtitles) {
                state.availableSubtitles = data.subtitles;
                subtitleManager.updateSubtitlesList();
            }

            if (data.currentMedia) {

                if (data.currentMedia.type === 'file') {
                    mediaManager.restoreFileMedia(data.currentMedia, data.videoState);
                } else if (data.currentMedia.type === 'torrent' && torrentManager) {
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
            if (torrentManager && state.currentTorrentInfo && data.infoHash === state.currentTorrentInfo.infoHash) {
                torrentManager.updateTorrentProgressUI(data);
            }
        });

        state.socket.on('users-update', (data) => {
            uiManager.updateUsersList(data.users);
        });

        state.socket.on('user-joined', (data) => {
            uiManager.updateLastAction(`${data.user.name} joined (${data.user.role})`);
        });

        // Enhanced user-left handler that supports admin succession
        state.socket.on('user-left', (data) => {

            // Check if this event indicates admin succession
            if (data.adminChanged && data.newAdminId === state.socket?.id) {
                authManager.handleUserLeft(data);
            } else {
                // Regular user departure
                uiManager.updateLastAction(`${data.user.name} left`);
            }
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
            state.availableSubtitles.push(data.subtitle);
            subtitleManager.updateSubtitlesList();
            uiManager.updateLastAction(`${data.user} added subtitle: ${data.subtitle.label}`);
        });

        state.socket.on('subtitle-selected', (data) => {
            uiManager.updateLastAction(`${data.user} selected subtitle`);
        });

        // Enhanced admin transfer events with better logging
        state.socket.on('admin-transferred', (data) => {
            authManager.handleAdminTransferred(data);
        });

        state.socket.on('transfer-admin-error', (data) => {
            uiManager.showError(data.message);
        });

        // User kick events
        state.socket.on('user-kicked', (data) => {
            authManager.handleUserKicked(data);
        });

        state.socket.on('kick-user-error', (data) => {
            uiManager.showError(data.message);
        });

        // Connection health monitoring
        state.socket.on('ping', () => {
        });

        state.socket.on('pong', (latency) => {
        });

        // Enhanced error handling
        state.socket.on('connect_error', (error) => {
            console.error('Socket connection error:', error);
            uiManager.updateConnectionStatus('Connection failed', 'disconnected');
        });

        state.socket.on('reconnect', (attemptNumber) => {
            uiManager.updateConnectionStatus('Reconnected to server', 'connected');
        });

        state.socket.on('reconnect_error', (error) => {
            console.error('Reconnection error:', error);
            uiManager.updateConnectionStatus('Reconnection failed', 'disconnected');
        });

        state.socket.on('reconnect_failed', () => {
            console.error('Failed to reconnect to server');
            uiManager.updateConnectionStatus('Failed to reconnect', 'disconnected');
            uiManager.showError('Lost connection to server. Please refresh the page.');
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
            return;
        }

        state.lastMediaAction = {
            key: actionKey,
            action: action,
            mediaData: mediaData,
            timestamp: Date.now()
        };

        state.socket.emit('media-action', {
            action: action,
            mediaData: mediaData
        });
    }

    // Enhanced connection status monitoring
    monitorConnection() {
        if (!state.socket) return;

        // Check connection status every 30 seconds
        setInterval(() => {
            if (state.socket.connected && state.isConnected) {
                // Connection is healthy
            } else if (!state.socket.connected && state.isConnected) {
                // Connection lost but state not updated
                console.warn('Connection health check: LOST');
                state.isConnected = false;
                uiManager.updateConnectionStatus('Connection lost', 'disconnected');
            }
        }, 30000);
    }

    // Gracefully disconnect
    disconnect() {
        if (state.socket) {
            state.socket.disconnect();
            state.socket = null;
            state.isConnected = false;
        }
    }

    // Force reconnection
    reconnect() {
        if (state.socket) {
            state.socket.connect();
        }
    }

    // Get connection statistics
    getConnectionStats() {
        if (!state.socket) return null;

        return {
            connected: state.socket.connected,
            id: state.socket.id,
            transport: state.socket.io.engine.transport.name,
            upgraded: state.socket.io.engine.upgraded,
            pingInterval: state.socket.io.engine.pingInterval,
            pingTimeout: state.socket.io.engine.pingTimeout
        };
    }

    // Send custom event with error handling
    emitWithCallback(eventName, data, callback) {
        if (!state.socket || !state.isConnected) {
            if (callback) callback(new Error('Not connected to server'));
            return;
        }

        const timeout = setTimeout(() => {
            if (callback) callback(new Error('Request timeout'));
        }, 10000); // 10 second timeout

        state.socket.emit(eventName, data, (response) => {
            clearTimeout(timeout);
            if (callback) callback(null, response);
        });
    }
}