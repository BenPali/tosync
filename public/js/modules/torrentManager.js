// modules/torrentManager.js - Torrent/magnet link management

import { state } from '../state.js';
import { config } from '../config.js';
import { socketManager, subtitleManager, uiManager } from '../main.js';

export class TorrentManager {
    // Load torrent through server
    async loadTorrent() {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can load torrents');
            return;
        }

        const torrentInput = document.getElementById('torrentInput').value.trim();

        if (!torrentInput) {
            uiManager.showError('Please enter a magnet link');
            return;
        }

        if (!torrentInput.startsWith('magnet:')) {
            uiManager.showError('Please enter a valid magnet link');
            return;
        }

        uiManager.updateMediaStatus('🧲 Processing magnet link...');
        console.log('Loading torrent:', torrentInput);

        try {
            const response = await fetch('/api/torrents/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    magnetLink: torrentInput,
                    roomId: state.currentRoomId
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to add torrent');
            }

            const torrentData = await response.json();
            console.log('Torrent added:', torrentData);

            state.currentTorrentInfo = torrentData;

            // Display torrent info
            document.getElementById('torrentName').textContent = torrentData.name;
            document.getElementById('torrentSize').textContent = uiManager.formatBytes(torrentData.totalLength);

            // Only show torrent info for admins
            if (state.userRole === 'admin') {
                document.getElementById('torrentInfo').classList.remove('hidden');
                // Display files
                this.displayTorrentFiles(torrentData.files);
            }

            // Auto-play first video file
            if (torrentData.files.length > 0) {
                const firstFile = torrentData.files[0];
                this.playTorrentFile(torrentData.infoHash, firstFile.index, firstFile.name);
            }

            // Start monitoring progress
            this.updateTorrentProgressFromServer();

        } catch (error) {
            uiManager.showError('Failed to add torrent: ' + error.message);
            console.error('Torrent load error:', error);
        }
    }

    // Play torrent file
    playTorrentFile(infoHash, fileIndex, fileName) {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can select files');
            return;
        }

        const streamUrl = `/api/torrents/${infoHash}/files/${fileIndex}/stream`;
        console.log('Playing torrent file:', fileName, 'from:', streamUrl);

        // Clear previous event listeners to prevent multiple calls
        state.videoPlayer.onloadedmetadata = null;
        state.videoPlayer.onerror = null;

        state.videoPlayer.src = streamUrl;
        state.videoPlayer.load();

        state.videoPlayer.onloadedmetadata = () => {
            console.log('Torrent video loaded successfully');
            uiManager.updateMediaStatus(`Streaming: ${fileName}`);

            // Broadcast to other users
            socketManager.broadcastMediaAction('load-torrent', {
                name: state.currentTorrentInfo.name,
                infoHash: infoHash,
                fileIndex: fileIndex,
                fileName: fileName,
                streamUrl: streamUrl,
                size: state.currentTorrentInfo.totalLength
            });

            // Restore subtitle selection if any
            if (state.selectedSubtitleId && state.selectedSubtitleId !== 'none') {
                setTimeout(() => {
                    subtitleManager.selectSubtitle(state.selectedSubtitleId);
                }, 100);
            }
        };

        state.videoPlayer.onerror = (e) => {
            console.error('Video streaming error:', e);
            uiManager.showError('Failed to stream video. The torrent might still be downloading.');
        };
    }

    // Display torrent files
    displayTorrentFiles(files) {
        const fileList = document.getElementById('fileList');
        fileList.innerHTML = '<h4 style="margin-bottom: 12px;">Available Files:</h4>';

        if (files.length === 0) {
            fileList.innerHTML += '<p style="color: #718096;">No video files found in this torrent.</p>';
            return;
        }

        files.forEach((file) => {
            const fileItem = document.createElement('div');
            fileItem.className = `file-item ${state.userRole === 'guest' ? 'restricted' : ''}`;

            fileItem.innerHTML = `
                <span>${file.name}</span>
                <span style="color: #718096; font-size: 0.85rem;">
                    ${uiManager.formatBytes(file.length)}
                </span>
            `;

            if (state.userRole === 'admin') {
                fileItem.onclick = () => this.playTorrentFile(state.currentTorrentInfo.infoHash, file.index, file.name);
                fileItem.style.cursor = 'pointer';
            } else {
                fileItem.title = 'Only admins can select files';
            }

            fileList.appendChild(fileItem);
        });
    }

    // Update torrent progress from server
    async updateTorrentProgressFromServer() {
        if (!state.currentTorrentInfo || !state.currentTorrentInfo.infoHash) return;

        this.clearTorrentProgress();

        const updateProgress = async () => {
            try {
                const response = await fetch(`/api/torrents/${state.currentTorrentInfo.infoHash}/status`);
                if (!response.ok) return;

                const status = await response.json();
                this.updateTorrentProgressUI(status);

                // Broadcast progress to other users
                if (state.userRole === 'admin' && state.socket && state.isConnected) {
                    state.socket.emit('torrent-status', status);
                }
            } catch (error) {
                console.error('Error fetching torrent status:', error);
            }
        };

        // Initial update
        updateProgress();

        // Set up periodic updates
        state.torrentProgressInterval = setInterval(updateProgress, config.TORRENT_UPDATE_INTERVAL);
    }

    // Update torrent progress UI
    updateTorrentProgressUI(status) {
        const progress = Math.round(status.progress * 100);
        document.getElementById('progressFill').style.width = progress + '%';
        document.getElementById('downloaded').textContent = uiManager.formatBytes(status.downloaded);
        document.getElementById('downloadSpeed').textContent = uiManager.formatBytes(status.downloadSpeed) + '/s';
        document.getElementById('numPeers').textContent = `${status.numPeers} peers`;

        // Update status message
        if (status.numPeers === 0 && progress < 100) {
            uiManager.updateMediaStatus(`🔍 Searching for peers... (${progress}%)`);
        } else if (progress < 100) {
            uiManager.updateMediaStatus(`⬇️ Downloading: ${status.name} (${progress}%, ${uiManager.formatBytes(status.downloadSpeed)}/s)`);
        } else {
            uiManager.updateMediaStatus(`✅ Complete: ${status.name} (Seeding to ${status.numPeers} peers)`);
        }
    }

    // Clear torrent progress monitoring
    clearTorrentProgress() {
        if (state.torrentProgressInterval) {
            clearInterval(state.torrentProgressInterval);
            state.torrentProgressInterval = null;
        }
        document.getElementById('progressFill').style.width = '0%';
    }

    // Restore torrent media for late-joining users
    restoreTorrentMedia(mediaData, videoState) {
        console.log('Restoring torrent media:', mediaData);
        state.currentTorrentInfo = mediaData.data;

        if (state.currentTorrentInfo.streamUrl) {
            // Clear previous event listeners
            state.videoPlayer.onloadedmetadata = null;
            state.videoPlayer.onerror = null;

            state.videoPlayer.src = state.currentTorrentInfo.streamUrl;
            state.videoPlayer.currentTime = videoState.currentTime || 0;
            state.videoPlayer.playbackRate = videoState.playbackRate || 1;

            state.videoPlayer.onloadedmetadata = () => {
                console.log('Restored torrent video loaded');
                uiManager.updateMediaStatus(`Watching: ${state.currentTorrentInfo.name}`);

                if (videoState.isPlaying) {
                    state.videoPlayer.play().catch(e => console.log('Auto-play prevented:', e));
                }
            };

            state.videoPlayer.load();

            document.getElementById('torrentName').textContent = state.currentTorrentInfo.name;
            document.getElementById('torrentSize').textContent = uiManager.formatBytes(state.currentTorrentInfo.size || 0);

            // Only show torrent info for admins
            if (state.userRole === 'admin') {
                document.getElementById('torrentInfo').classList.remove('hidden');
                this.updateTorrentProgressFromServer();
            }
        }
    }
}