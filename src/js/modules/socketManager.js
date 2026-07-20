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

            if (roomCode && roomCode.length === config.ROOM_CODE_LENGTH) {
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
            // Restore the room's subtitle timing offset (no re-broadcast).
            subtitleManager.setSubtitleOffset(data.subtitleOffset || 0, { broadcast: false });

            if (data.currentMedia) {
                if (data.currentMedia.type === 'file') {
                    mediaManager.restoreFileMedia(data.currentMedia, data.videoState);
                } else if (data.currentMedia.type === 'torrent' && torrentManager) {
                    torrentManager.restoreTorrentMedia(data.currentMedia, data.videoState);
                } else if (data.currentMedia.type === 'stream') {
                    mediaManager.restoreStreamMedia(data.currentMedia, data.videoState);
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

        state.socket.on('user-left', (data) => {
            uiManager.updateLastAction(`${data.user.name} left`);
        });

        state.socket.on('force-sync', (data) => {
            if (state.isLiveStream) return;

            const apply = () => {
                state.isReceivingSync = true;
                // Queue the echo-suppression target for this programmatic seek
                // (see handleSeeked) — a flag window can't cover a seek deferred
                // to loadedmetadata.
                if (Math.abs(state.videoPlayer.currentTime - data.time) > 0.01) {
                    state.pendingSeekTargets.push(data.time);
                    state.videoPlayer.currentTime = data.time;
                }
                if (typeof data.playbackRate === 'number') {
                    state.videoPlayer.playbackRate = data.playbackRate;
                }
                if (data.isPlaying && state.videoPlayer.paused) {
                    state.videoPlayer.play().catch(e => console.log('Auto-play prevented:', e));
                } else if (!data.isPlaying && !state.videoPlayer.paused) {
                    state.videoPlayer.pause();
                }
                uiManager.updateLastAction(`${data.user} forced sync`);
                // Shared timer so an overlapping sync-video window isn't cut
                // short by this one (and vice versa).
                clearTimeout(state.receivingSyncTimer);
                state.receivingSyncTimer = setTimeout(() => { state.isReceivingSync = false; }, 100);
            };

            // Seeks are no-ops until the video has seekable metadata.
            if (state.videoPlayer.readyState >= 1) {
                apply();
            } else {
                // Tie the listener to the current media load so a subsequent
                // media change cancels it (prevents applying a stale seek to a
                // freshly-loaded video).
                state.videoPlayer.addEventListener('loadedmetadata', apply, {
                    once: true,
                    signal: state.mediaLoadAbort?.signal
                });
            }
        });

        // Admin: answer a server-initiated sync-request with our current video state.
        state.socket.on('sync-request', (data) => {
            if (state.userRole !== 'admin') return;
            if (state.isLiveStream) return;
            const v = state.videoPlayer;
            state.socket.emit('sync-response', {
                targetSocketId: data?.targetSocketId,
                time: v.currentTime,
                isPlaying: !v.paused,
                playbackRate: v.playbackRate
            });
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

        // Admin adjusted the subtitle timing offset — apply it locally (no re-broadcast).
        state.socket.on('subtitle-offset', (data) => {
            subtitleManager.setSubtitleOffset(data.offset || 0, { broadcast: false });
            if (typeof data.user === 'string') {
                uiManager.updateLastAction(`${data.user} adjusted subtitle timing`);
            }
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

    // Send video actions to server.
    //
    // Trailing-edge throttle: at most one emit per SYNC_THROTTLE_DELAY, but the
    // LATEST action in a burst is always delivered at the end of the window.
    // A plain leading-edge throttle (the old behaviour) dropped the trailing
    // action outright, so pause-then-play within the window left the room paused
    // while the sender played, and two quick -10s taps moved the sender -20s but
    // the room only -10s. Coalescing to the latest action fixes that convergence.
    broadcastVideoAction(action, time, playbackRate) {
        // No isReceivingSync gate here: each caller already applies the correct
        // echo suppression for its event type before calling — handlePlay/Pause/
        // RateChange check the flag, handleSeeked uses the pendingSeekTargets
        // queue. Gating again here would also drop a genuine seek made within
        // the flag's window.
        if (!state.socket || !state.isConnected) return;

        const now = Date.now();
        const elapsed = now - state.lastSyncTime;

        if (elapsed < config.SYNC_THROTTLE_DELAY) {
            // Inside the window: remember this (latest) action and make sure a
            // single trailing timer is scheduled to flush it when the window ends.
            state.pendingSyncAction = { action, time, playbackRate };
            if (!state.pendingSyncTimer) {
                state.pendingSyncTimer = setTimeout(() => {
                    state.pendingSyncTimer = null;
                    const pending = state.pendingSyncAction;
                    state.pendingSyncAction = null;
                    if (!pending) return;
                    // Seeks keep their captured target; play/pause/rate re-read
                    // the position at flush time — a remote seek may have been
                    // applied while this sat queued, and emitting the pre-sync
                    // position would yank the room back.
                    const flushTime = pending.action === 'seek'
                        ? pending.time
                        : state.videoPlayer.currentTime;
                    this._emitVideoAction(pending.action, flushTime, pending.playbackRate);
                }, config.SYNC_THROTTLE_DELAY - elapsed);
            }
            return;
        }

        // This direct emit supersedes anything still queued from the previous
        // window — cancel it so a late-firing trailing timer can't emit an
        // OLDER action after this newer one.
        if (state.pendingSyncTimer) {
            clearTimeout(state.pendingSyncTimer);
            state.pendingSyncTimer = null;
        }
        state.pendingSyncAction = null;

        this._emitVideoAction(action, time, playbackRate);
    }

    _emitVideoAction(action, time, playbackRate) {
        // Re-check liveness: the trailing flush runs later, by which point we may
        // have disconnected. (Echo suppression is the caller's responsibility —
        // see broadcastVideoAction.)
        if (!state.socket || !state.isConnected) return;
        state.lastSyncTime = Date.now();
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
}