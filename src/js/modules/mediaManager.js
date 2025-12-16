// modules/mediaManager.js - Media upload and management

import { state } from '../state.js';
import { config } from '../config.js';
import { socketManager, torrentManager, subtitleManager, uiManager } from '../main.js';

export class MediaManager {
    // Upload file
    async uploadFile() {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can upload files');
            return;
        }

        const fileInput = document.getElementById('fileInput');
        const file = fileInput.files[0];

        if (!file) {
            uiManager.showError('Please select a file');
            return;
        }

        if (file.size > config.MAX_FILE_SIZE) {
            uiManager.showError(`File too large: ${uiManager.formatBytes(file.size)}. Maximum size is 10GB.`);
            return;
        }

        uiManager.updateMediaStatus(`Uploading ${file.name} (${uiManager.formatBytes(file.size)})...`);

        const formData = new FormData();
        formData.append('video', file);
        formData.append('roomId', state.currentRoomId);

        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentComplete = Math.round((e.loaded / e.total) * 100);
                uiManager.updateMediaStatus(`Uploading: ${percentComplete}% (${uiManager.formatBytes(e.loaded)}/${uiManager.formatBytes(e.total)})`);
                document.getElementById('progressFill').style.width = percentComplete + '%';
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status === 200) {
                try {
                    const data = JSON.parse(xhr.responseText);

                    if (data.error) {
                        throw new Error(data.error);
                    }


                    // Clear previous event listeners to prevent multiple calls
                    state.videoPlayer.onloadedmetadata = null;
                    state.videoPlayer.onerror = null;

                    state.videoPlayer.src = data.url;

                    state.videoPlayer.onloadedmetadata = () => {
                        uiManager.updateMediaStatus('✅ Ready to stream: ' + data.originalName);

                        socketManager.broadcastMediaAction('load-file', {
                            fileName: data.originalName,
                            fileSize: data.size,
                            url: data.url
                        });

                        // Restore subtitle selection if any
                        if (state.selectedSubtitleId && state.selectedSubtitleId !== 'none') {
                            setTimeout(() => {
                                subtitleManager.selectSubtitle(state.selectedSubtitleId);
                            }, 100);
                        }

                        setTimeout(() => {
                            document.getElementById('progressFill').style.width = '0%';
                        }, 2000);
                    };

                    state.videoPlayer.load();
                    const torrentInfo = document.getElementById('torrentInfo');
                    if (torrentInfo) {
                        torrentInfo.classList.add('hidden');
                    }

                } catch (parseError) {
                    console.error('JSON parse error:', parseError);
                    uiManager.showError('Server returned invalid response');
                }
            } else {
                try {
                    const errorData = JSON.parse(xhr.responseText);
                    uiManager.showError(errorData.error || `Upload failed with status ${xhr.status}`);
                } catch {
                    uiManager.showError(`Upload failed: HTTP ${xhr.status}`);
                }
            }
        });

        xhr.addEventListener('error', () => {
            uiManager.showError('Network error during upload');
        });

        xhr.addEventListener('timeout', () => {
            uiManager.showError('Upload timed out');
        });

        xhr.timeout = config.UPLOAD_TIMEOUT;

        xhr.open('POST', `/upload?roomId=${encodeURIComponent(state.currentRoomId)}`);
        xhr.send(formData);
    }

    async loadStream() {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can load streams');
            return;
        }

        const streamInput = document.getElementById('streamInput');
        const streamUrl = streamInput?.value.trim();

        if (!streamUrl) {
            uiManager.showError('Please enter a stream URL');
            return;
        }

        if (!streamUrl.startsWith('http://') && !streamUrl.startsWith('https://')) {
            uiManager.showError('Invalid URL format');
            return;
        }

        uiManager.updateMediaStatus('Starting stream relay...');

        state.currentTorrentInfo = null;
        if (torrentManager) {
            torrentManager.clearTorrentProgress();
        }

        if (state.hlsInstance) {
            state.hlsInstance.destroy();
            state.hlsInstance = null;
        }

        if (state.mpegtsPlayer) {
            state.mpegtsPlayer.destroy();
            state.mpegtsPlayer = null;
        }

        state.videoPlayer.onloadedmetadata = null;
        state.videoPlayer.onerror = null;

        let streamName;
        try {
            streamName = new URL(streamUrl).pathname.split('/').pop() || 'Live Stream';
        } catch {
            streamName = 'Live Stream';
        }

        try {
            const response = await fetch('/api/stream/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    streamUrl: streamUrl,
                    roomId: state.currentRoomId
                })
            });

            if (!response.ok) {
                const error = await response.json();
                uiManager.showError(`Failed to start stream: ${error.error || response.status}`);
                return;
            }

            const data = await response.json();
            const socketId = state.socket ? state.socket.id : '';
            const relayUrl = `${window.location.origin}${data.relayUrl}?socketId=${encodeURIComponent(socketId)}`;

            socketManager.broadcastMediaAction('load-stream', {
                streamUrl: streamUrl,
                streamName: streamName,
                relayUrl: data.relayUrl
            });
            streamInput.value = '';

            this.loadStreamDirect(relayUrl, streamName);
            uiManager.updateMediaStatus(`📡 Streaming: ${streamName}`);

        } catch (err) {
            console.error('Stream start error:', err);
            uiManager.showError(`Failed to start stream: ${err.message}`);
        }

        const torrentInfo = document.getElementById('torrentInfo');
        if (torrentInfo) {
            torrentInfo.classList.add('hidden');
        }
    }

    loadStreamDirect(streamUrl, streamName) {
        if (state.mpegtsPlayer) {
            state.mpegtsPlayer.destroy();
            state.mpegtsPlayer = null;
        }

        state.videoPlayer.oncanplay = null;
        state.videoPlayer.onloadeddata = null;
        state.videoPlayer.onerror = null;

        if (typeof mpegts !== 'undefined' && mpegts.isSupported()) {
            mpegts.LoggingControl.enableAll = false;

            const createPlayer = () => {
                const player = mpegts.createPlayer({
                    type: 'mpegts',
                    isLive: true,
                    url: streamUrl
                }, {
                    enableWorker: true,
                    enableStashBuffer: true,
                    stashInitialSize: 1024 * 1024,
                    autoCleanupSourceBuffer: true,
                    autoCleanupMaxBackwardDuration: 60,
                    autoCleanupMinBackwardDuration: 30,
                    liveBufferLatencyChasing: true,
                    liveBufferLatencyMaxLatency: 15,
                    liveBufferLatencyMinRemain: 5,
                    fixAudioTimestampGap: true
                });

                state.mpegtsPlayer = player;
                player.attachMediaElement(state.videoPlayer);
                player.load();

                player.on(mpegts.Events.METADATA_ARRIVED, () => {
                    uiManager.updateMediaStatus(`📡 Streaming: ${streamName}`);
                });

                player.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
                    console.error('mpegts.js error:', errorType, errorDetail);
                    if (errorType === 'NetworkError' || errorType === 'MediaError') {
                        console.log('Attempting to reconnect stream...');
                        setTimeout(() => {
                            if (state.mpegtsPlayer) {
                                player.unload();
                                player.load();
                                player.play();
                            }
                        }, 2000);
                    }
                });

                state.videoPlayer.addEventListener('ended', () => {
                    if (state.mpegtsPlayer) {
                        console.log('Stream ended, attempting to restart...');
                        setTimeout(() => {
                            if (state.mpegtsPlayer) {
                                player.unload();
                                player.load();
                                player.play();
                            }
                        }, 1000);
                    }
                });

                player.play();
            };

            createPlayer();
        } else {
            this.loadStreamNative(streamUrl, streamName);
        }
    }

    loadStreamNative(streamUrl, streamName) {
        state.videoPlayer.oncanplay = () => {
            state.videoPlayer.oncanplay = null;
            uiManager.updateMediaStatus(`📡 Streaming: ${streamName}`);
            state.videoPlayer.play().catch(() => { });
        };

        state.videoPlayer.onerror = (e) => {
            console.error('Stream error:', e, state.videoPlayer.error);
            uiManager.showError('Failed to load stream. Check URL or format.');
        };

        state.videoPlayer.src = streamUrl;
        state.videoPlayer.load();
    }

    // Clear media
    clearMedia() {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can clear media');
            return;
        }

        if (state.hlsInstance) {
            state.hlsInstance.destroy();
            state.hlsInstance = null;
        }

        if (state.mpegtsPlayer) {
            state.mpegtsPlayer.destroy();
            state.mpegtsPlayer = null;
        }

        state.currentTorrentInfo = null;
        if (torrentManager) {
            torrentManager.clearTorrentProgress();
        }
        state.videoPlayer.src = '';
        const torrentInfo = document.getElementById('torrentInfo');
        if (torrentInfo) {
            torrentInfo.classList.add('hidden');
        }
        document.getElementById('progressFill').style.width = '0%';
        state.lastMediaAction = null;

        uiManager.updateMediaStatus('Media cleared');
        socketManager.broadcastMediaAction('clear-media', {});
    }

    // Handle media updates from server
    handleMediaUpdate(data) {

        switch (data.action) {
            case 'load-torrent':
                state.currentTorrentInfo = data.mediaData.data;
                uiManager.updateMediaStatus(`${data.user} loaded torrent: ${state.currentTorrentInfo.name}`);

                if (state.currentTorrentInfo.streamUrl) {
                    // Clear previous event listeners
                    state.videoPlayer.onloadedmetadata = null;
                    state.videoPlayer.onerror = null;

                    state.videoPlayer.src = state.currentTorrentInfo.streamUrl;
                    state.videoPlayer.load();

                    document.getElementById('torrentName').textContent = state.currentTorrentInfo.name;
                    document.getElementById('torrentSize').textContent = uiManager.formatBytes(state.currentTorrentInfo.size || 0);

                    // Only show torrent info for admins
                    if (state.userRole === 'admin' && torrentManager) {
                        const torrentInfo = document.getElementById('torrentInfo');
                        if (torrentInfo) {
                            torrentInfo.classList.remove('hidden');
                        }
                        torrentManager.updateTorrentProgressFromServer();
                    }
                }
                break;

            case 'load-file':
                state.currentTorrentInfo = null;
                if (torrentManager) {
                    torrentManager.clearTorrentProgress();
                }
                uiManager.updateMediaStatus(`${data.user} loaded: ${data.mediaData.data.fileName}`);

                // Clear previous event listeners
                state.videoPlayer.onloadedmetadata = null;
                state.videoPlayer.onerror = null;

                state.videoPlayer.src = data.mediaData.data.url;
                state.videoPlayer.load();
                const torrentInfoLoadFile = document.getElementById('torrentInfo');
                if (torrentInfoLoadFile) {
                    torrentInfoLoadFile.classList.add('hidden');
                }
                break;

            case 'load-stream':
                if (data.user === state.userName) {
                    break;
                }

                state.currentTorrentInfo = null;
                if (torrentManager) {
                    torrentManager.clearTorrentProgress();
                }

                if (state.hlsInstance) {
                    state.hlsInstance.destroy();
                    state.hlsInstance = null;
                }

                if (state.mpegtsPlayer) {
                    state.mpegtsPlayer.destroy();
                    state.mpegtsPlayer = null;
                }

                state.videoPlayer.onloadedmetadata = null;
                state.videoPlayer.onerror = null;

                const streamName = data.mediaData.data.streamName || 'Live Stream';
                const relayPath = data.mediaData.data.relayUrl || `/api/stream/relay/${state.currentRoomId}`;
                const socketId = state.socket ? state.socket.id : '';
                const relayUrl = `${window.location.origin}${relayPath}?socketId=${encodeURIComponent(socketId)}`;

                this.loadStreamDirect(relayUrl, streamName);
                uiManager.updateMediaStatus(`📡 ${data.user} started stream: ${streamName}`);

                const torrentInfoLoadStream = document.getElementById('torrentInfo');
                if (torrentInfoLoadStream) {
                    torrentInfoLoadStream.classList.add('hidden');
                }
                break;

            case 'clear-media':
                state.currentTorrentInfo = null;
                if (torrentManager) {
                    torrentManager.clearTorrentProgress();
                }
                state.videoPlayer.src = '';
                uiManager.updateMediaStatus(`${data.user} cleared media`);
                const torrentInfoClearMedia = document.getElementById('torrentInfo');
                if (torrentInfoClearMedia) {
                    torrentInfoClearMedia.classList.add('hidden');
                }
                break;
        }

        uiManager.updateLastAction(`${data.user} ${data.action.replace('-', ' ')}`);
    }

    // Restore file media for late-joining users
    restoreFileMedia(mediaData, videoState) {
        const videoUrl = mediaData.data.url;

        // Clear previous event listeners
        state.videoPlayer.onloadedmetadata = null;
        state.videoPlayer.onerror = null;

        state.videoPlayer.src = videoUrl;
        state.videoPlayer.currentTime = videoState.currentTime || 0;
        state.videoPlayer.playbackRate = videoState.playbackRate || 1;

        state.videoPlayer.onloadedmetadata = () => {
            uiManager.updateMediaStatus(`Watching: ${mediaData.data.fileName}`);

            if (videoState.isPlaying) {
                state.videoPlayer.play().catch(e => console.log('Auto-play prevented:', e));
            }
        };

        state.videoPlayer.load();
        document.getElementById('torrentInfo').classList.add('hidden');
    }

    restoreStreamMedia(mediaData, videoState) {
        const streamName = mediaData.data.streamName || 'Live Stream';
        const relayPath = mediaData.data.relayUrl || `/api/stream/relay/${state.currentRoomId}`;

        console.log('[STREAM DEBUG] restoreStreamMedia called');
        console.log('[STREAM DEBUG] relayPath:', relayPath);

        state.videoPlayer.onloadedmetadata = null;
        state.videoPlayer.onerror = null;

        if (state.hlsInstance) {
            state.hlsInstance.destroy();
            state.hlsInstance = null;
        }

        if (state.mpegtsPlayer) {
            state.mpegtsPlayer.destroy();
            state.mpegtsPlayer = null;
        }

        const socketId = state.socket ? state.socket.id : '';
        const relayUrl = `${window.location.origin}${relayPath}?socketId=${encodeURIComponent(socketId)}`;
        console.log('[STREAM DEBUG] relayUrl:', relayUrl);

        this.loadStreamDirect(relayUrl, streamName);
        uiManager.updateMediaStatus(`📡 Watching: ${streamName}`);

        const torrentInfo = document.getElementById('torrentInfo');
        if (torrentInfo) {
            torrentInfo.classList.add('hidden');
        }
    }
}