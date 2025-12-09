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

    loadStream() {
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

        uiManager.updateMediaStatus('Loading stream...');

        state.currentTorrentInfo = null;
        if (torrentManager) {
            torrentManager.clearTorrentProgress();
        }

        if (state.hlsInstance) {
            state.hlsInstance.destroy();
            state.hlsInstance = null;
        }

        state.videoPlayer.onloadedmetadata = null;
        state.videoPlayer.onerror = null;

        let streamName;
        try {
            streamName = new URL(streamUrl).pathname.split('/').pop() || 'Live Stream';
        } catch {
            streamName = 'Live Stream';
        }

        const proxyUrl = `${window.location.origin}/api/stream/proxy?url=${encodeURIComponent(streamUrl)}`;

        const onStreamReady = () => {
            uiManager.updateMediaStatus(`📡 Streaming: ${streamName}`);
            socketManager.broadcastMediaAction('load-stream', {
                streamUrl: proxyUrl,
                streamName: streamName
            });
            streamInput.value = '';
        };

        const isHlsUrl = streamUrl.includes('.m3u8');

        if (isHlsUrl && typeof Hls !== 'undefined' && Hls.isSupported()) {
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true
            });
            state.hlsInstance = hls;

            hls.loadSource(proxyUrl);
            hls.attachMedia(state.videoPlayer);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                onStreamReady();
            });

            hls.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal) {
                    hls.destroy();
                    state.hlsInstance = null;
                    this.loadStreamDirect(proxyUrl, streamName, streamInput, onStreamReady);
                }
            });
        } else {
            this.loadStreamDirect(proxyUrl, streamName, streamInput, onStreamReady);
        }

        const torrentInfo = document.getElementById('torrentInfo');
        if (torrentInfo) {
            torrentInfo.classList.add('hidden');
        }
    }

    loadStreamDirect(streamUrl, streamName, streamInput, onReady) {
        if (state.mpegtsPlayer) {
            state.mpegtsPlayer.destroy();
            state.mpegtsPlayer = null;
        }

        state.videoPlayer.oncanplay = null;
        state.videoPlayer.onloadeddata = null;
        state.videoPlayer.onerror = null;

        const handleStreamReady = () => {
            state.videoPlayer.oncanplay = null;
            state.videoPlayer.onloadeddata = null;

            if (onReady) {
                onReady();
            } else {
                uiManager.updateMediaStatus(`📡 Streaming: ${streamName}`);
                socketManager.broadcastMediaAction('load-stream', {
                    streamUrl: streamUrl,
                    streamName: streamName
                });
            }
            if (streamInput) streamInput.value = '';
            state.videoPlayer.play().catch(() => {});
        };

        if (typeof mpegts !== 'undefined' && mpegts.isSupported()) {
            mpegts.LoggingControl.enableAll = false;

            const player = mpegts.createPlayer({
                type: 'mpegts',
                isLive: true,
                url: streamUrl
            }, {
                enableWorker: true,
                enableStashBuffer: true,
                stashInitialSize: 512 * 1024,
                autoCleanupSourceBuffer: true,
                autoCleanupMaxBackwardDuration: 30,
                autoCleanupMinBackwardDuration: 15,
                liveBufferLatencyChasing: false,
                liveBufferLatencyMaxLatency: 10,
                liveBufferLatencyMinRemain: 3
            });

            state.mpegtsPlayer = player;
            player.attachMediaElement(state.videoPlayer);
            player.load();

            player.on(mpegts.Events.LOADING_COMPLETE, handleStreamReady);
            player.on(mpegts.Events.METADATA_ARRIVED, handleStreamReady);

            player.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
                console.error('mpegts.js error:', errorType, errorDetail);
                player.destroy();
                state.mpegtsPlayer = null;
                this.loadStreamNative(streamUrl, streamName, streamInput, onReady);
            });

            player.play();
        } else {
            this.loadStreamNative(streamUrl, streamName, streamInput, onReady);
        }
    }

    loadStreamNative(streamUrl, streamName, streamInput, onReady) {
        const handleStreamReady = () => {
            state.videoPlayer.oncanplay = null;
            state.videoPlayer.onloadeddata = null;

            if (onReady) {
                onReady();
            } else {
                uiManager.updateMediaStatus(`📡 Streaming: ${streamName}`);
                socketManager.broadcastMediaAction('load-stream', {
                    streamUrl: streamUrl,
                    streamName: streamName
                });
            }
            if (streamInput) streamInput.value = '';
            state.videoPlayer.play().catch(() => {});
        };

        state.videoPlayer.oncanplay = handleStreamReady;
        state.videoPlayer.onloadeddata = handleStreamReady;

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
                state.currentTorrentInfo = null;
                if (torrentManager) {
                    torrentManager.clearTorrentProgress();
                }
                uiManager.updateMediaStatus(`📡 ${data.user} started stream: ${data.mediaData.data.streamName}`);

                if (state.hlsInstance) {
                    state.hlsInstance.destroy();
                    state.hlsInstance = null;
                }

                state.videoPlayer.onloadedmetadata = null;
                state.videoPlayer.onerror = null;

                if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                    const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
                    state.hlsInstance = hls;
                    hls.loadSource(data.mediaData.data.streamUrl);
                    hls.attachMedia(state.videoPlayer);
                    hls.on(Hls.Events.ERROR, (_, errData) => {
                        if (errData.fatal) {
                            hls.destroy();
                            state.hlsInstance = null;
                            state.videoPlayer.src = data.mediaData.data.streamUrl;
                            state.videoPlayer.load();
                        }
                    });
                } else {
                    state.videoPlayer.src = data.mediaData.data.streamUrl;
                    state.videoPlayer.load();
                }

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
}