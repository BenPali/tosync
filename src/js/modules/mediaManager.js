// modules/mediaManager.js - Media upload and management

import { state } from '../state.js';
import { config } from '../config.js';
import { socketManager, torrentManager, subtitleManager, uiManager } from '../main.js';
import { checkCodecSupport, fetchCodecs, buildHlsUrl, startHlsPlayback, destroyHls } from './codecUtils.js';

// Call at every point where a new media source is being loaded. Aborts any
// listeners (e.g. deferred force-sync) tied to the previous media so stale
// events can't fire against a newly-loaded video.
export function resetMediaLoad() {
    state.mediaLoadAbort?.abort();
    state.mediaLoadAbort = new AbortController();
}

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

        xhr.addEventListener('load', async () => {
            if (xhr.status === 200) {
                try {
                    const data = JSON.parse(xhr.responseText);

                    if (data.error) {
                        throw new Error(data.error);
                    }

                    // Clear previous event listeners to prevent multiple calls
                    state.isLiveStream = false;
                    destroyHls();
                    state.videoPlayer.onloadedmetadata = null;
                    state.videoPlayer.onerror = null;

                    // Check codec compatibility
                    const roomId = state.currentRoomId;
                    const filename = data.filename;

                    const codecs = await fetchCodecs({
                        source: 'upload', roomId, filename
                    });
                    const needs = codecs ? checkCodecSupport(codecs) : null;

                    if (needs) {
                        const hlsUrl = buildHlsUrl({ source: 'upload', roomId, filename }, needs);
                        const transcodingWhat = needs === 'both' ? 'video & audio' : needs;
                        uiManager.updateMediaStatus(`Transcoding ${transcodingWhat}...`);
                        startHlsPlayback(hlsUrl);
                    } else {
                        state.videoPlayer.src = data.url;
                        state.videoPlayer.load();
                    }

                    state.videoPlayer.onloadedmetadata = () => {
                        const suffix = needs ? ' (transcoded)' : '';
                        uiManager.updateMediaStatus('Ready to stream: ' + data.originalName + suffix);

                        socketManager.broadcastMediaAction('load-file', {
                            fileName: data.originalName,
                            fileSize: data.size,
                            url: data.url,
                            filename: data.filename,
                            codecs: codecs
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


    loadStreamDirect(streamUrl, streamName) {
        state.isLiveStream = true;

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
                                player.play().catch(() => {});
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
                                player.play().catch(() => {});
                            }
                        }, 1000);
                    }
                });

                player.play().catch(() => {});
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

        state.isLiveStream = false;

        destroyHls();

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
        subtitleManager.clearSubtitles();
        resetMediaLoad();

        switch (data.action) {
            case 'load-torrent': {
                state.isLiveStream = false;
                destroyHls();
                state.currentTorrentInfo = data.mediaData.data;
                const ti = state.currentTorrentInfo;
                uiManager.updateMediaStatus(`${data.user} loaded torrent: ${ti.name}`);

                if (ti.infoHash !== undefined && ti.fileIndex !== undefined) {
                    state.videoPlayer.onloadedmetadata = null;
                    state.videoPlayer.onerror = null;

                    // Check codec support using codecs from broadcast
                    const torrentCodecs = ti.codecs || null;
                    const torrentNeeds = torrentCodecs ? checkCodecSupport(torrentCodecs) : null;

                    if (torrentNeeds) {
                        const hlsUrl = buildHlsUrl({ source: 'torrent', infoHash: ti.infoHash, fileIndex: ti.fileIndex }, torrentNeeds);
                        startHlsPlayback(hlsUrl);
                    } else {
                        state.videoPlayer.src = `/api/torrents/${ti.infoHash}/files/${ti.fileIndex}/stream`;
                        state.videoPlayer.load();
                    }

                    document.getElementById('torrentName').textContent = ti.name;
                    document.getElementById('torrentSize').textContent = uiManager.formatBytes(ti.size || 0);

                    if (state.userRole === 'admin' && torrentManager) {
                        const torrentInfoEl = document.getElementById('torrentInfo');
                        if (torrentInfoEl) torrentInfoEl.classList.remove('hidden');
                        torrentManager.updateTorrentProgressFromServer();
                    }
                }
                break;
            }

            case 'load-file': {
                state.isLiveStream = false;
                destroyHls();
                state.currentTorrentInfo = null;
                if (torrentManager) {
                    torrentManager.clearTorrentProgress();
                }

                const fileData = data.mediaData.data;
                uiManager.updateMediaStatus(`${data.user} loaded: ${fileData.fileName}`);

                state.videoPlayer.onloadedmetadata = null;
                state.videoPlayer.onerror = null;

                // Check codec support using codecs from broadcast
                const fileCodecs = fileData.codecs || null;
                const fileNeeds = fileCodecs ? checkCodecSupport(fileCodecs) : null;

                if (fileNeeds && fileData.filename) {
                    const hlsUrl = buildHlsUrl({
                        source: 'upload',
                        roomId: state.currentRoomId,
                        filename: fileData.filename
                    }, fileNeeds);
                    startHlsPlayback(hlsUrl);
                } else {
                    state.videoPlayer.src = fileData.url;
                    state.videoPlayer.load();
                }

                const torrentInfoLoadFile = document.getElementById('torrentInfo');
                if (torrentInfoLoadFile) {
                    torrentInfoLoadFile.classList.add('hidden');
                }
                break;
            }

            case 'load-stream':
                if (data.user === state.userName) {
                    break;
                }

                state.currentTorrentInfo = null;
                if (torrentManager) {
                    torrentManager.clearTorrentProgress();
                }

                destroyHls();

                if (state.mpegtsPlayer) {
                    state.mpegtsPlayer.destroy();
                    state.mpegtsPlayer = null;
                }

                state.videoPlayer.onloadedmetadata = null;
                state.videoPlayer.onerror = null;

                const streamName = data.mediaData.data.streamName || 'Live Stream';
                const relayPath = data.mediaData.data.relayUrl || `/api/stream/relay/${state.currentRoomId}`;
                const relayUrl = `${window.location.origin}${relayPath}`;

                this.loadStreamDirect(relayUrl, streamName);
                uiManager.updateMediaStatus(`📡 ${data.user} started stream: ${streamName}`);

                const torrentInfoLoadStream = document.getElementById('torrentInfo');
                if (torrentInfoLoadStream) {
                    torrentInfoLoadStream.classList.add('hidden');
                }
                break;

            case 'clear-media':
                state.isLiveStream = false;
                destroyHls();
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
        state.isLiveStream = false;
        resetMediaLoad();
        destroyHls();
        state.videoPlayer.onloadedmetadata = null;
        state.videoPlayer.onerror = null;

        const fileData = mediaData.data;
        const codecs = fileData.codecs || null;
        const needs = codecs ? checkCodecSupport(codecs) : null;

        if (needs && fileData.filename) {
            const hlsUrl = buildHlsUrl({
                source: 'upload',
                roomId: state.currentRoomId,
                filename: fileData.filename
            }, needs);
            startHlsPlayback(hlsUrl);
        } else {
            state.videoPlayer.src = fileData.url;
            state.videoPlayer.load();
        }

        state.videoPlayer.playbackRate = videoState.playbackRate || 1;

        state.videoPlayer.onloadedmetadata = () => {
            const suffix = needs ? ' (transcoded)' : '';
            uiManager.updateMediaStatus(`Watching: ${fileData.fileName}${suffix}`);

            // Seek AFTER metadata is loaded so the browser honors it (seekable range is known).
            state.videoPlayer.currentTime = videoState.currentTime || 0;

            if (videoState.isPlaying) {
                state.videoPlayer.play().catch(e => console.log('Auto-play prevented:', e));
            }
        };

        const torrentInfo = document.getElementById('torrentInfo');
        if (torrentInfo) torrentInfo.classList.add('hidden'); // absent on the public build
    }

    restoreStreamMedia(mediaData, videoState) {
        const streamName = mediaData.data.streamName || 'Live Stream';
        const relayPath = mediaData.data.relayUrl || `/api/stream/relay/${state.currentRoomId}`;

        resetMediaLoad();
        state.videoPlayer.onloadedmetadata = null;
        state.videoPlayer.onerror = null;

        destroyHls();

        if (state.mpegtsPlayer) {
            state.mpegtsPlayer.destroy();
            state.mpegtsPlayer = null;
        }

        const relayUrl = `${window.location.origin}${relayPath}`;

        this.loadStreamDirect(relayUrl, streamName);
        uiManager.updateMediaStatus(`📡 Watching: ${streamName}`);

        const torrentInfo = document.getElementById('torrentInfo');
        if (torrentInfo) {
            torrentInfo.classList.add('hidden');
        }
    }
}