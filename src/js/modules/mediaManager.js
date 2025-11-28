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

    // Clear media
    clearMedia() {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can clear media');
            return;
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