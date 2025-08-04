// script.js - Enhanced Tosync Client

// Configuration
// simple password to restrict access from your friends
// Will implement better security later on
const ADMIN_PASSWORD = "admin123";
const SERVER_URL = window.location.origin;

// Global variables
let socket = null;
let videoPlayer = null;
let userRole = null;
let userName = "Anonymous";
let isReceivingSync = false;
let isConnected = false;
let lastSyncTime = 0;
let syncThrottleDelay = 200;
let currentTorrentInfo = null;
let torrentProgressInterval = null;
let lastMediaAction = null; // Track last media action to prevent duplicates
let availableSubtitles = []; // Array of available subtitle tracks
let selectedSubtitleId = null; // Currently selected subtitle track

// Socket.IO connection
function initializeSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('Connected to server');
        isConnected = true;
        updateConnectionStatus('Connected to server', 'connected');

        socket.emit('join-room', {
            userName: userName,
            userRole: userRole
        });
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        isConnected = false;
        updateConnectionStatus('Disconnected from server', 'disconnected');
    });

    socket.on('room-state', (data) => {
        console.log('Received room state:', data);
        updateRoomStatus('Connected to room');
        updateUsersList(data.users);

        // Restore subtitles
        if (data.subtitles) {
            availableSubtitles = data.subtitles;
            updateSubtitlesList();
        }

        if (data.currentMedia) {
            console.log('Restoring media state:', data.currentMedia);

            if (data.currentMedia.type === 'file') {
                restoreFileMedia(data.currentMedia, data.videoState);
            } else if (data.currentMedia.type === 'torrent') {
                restoreTorrentMedia(data.currentMedia, data.videoState);
            }
        }
    });

    socket.on('sync-video', (data) => {
        handleVideoSync(data);
    });

    socket.on('media-update', (data) => {
        handleMediaUpdate(data);
    });

    socket.on('torrent-progress', (data) => {
        if (currentTorrentInfo && data.infoHash === currentTorrentInfo.infoHash) {
            updateTorrentProgressUI(data);
        }
    });

    socket.on('users-update', (data) => {
        updateUsersList(data.users);
    });

    socket.on('user-joined', (data) => {
        updateLastAction(`${data.user.name} joined (${data.user.role})`);
    });

    socket.on('user-left', (data) => {
        updateLastAction(`${data.user.name} left`);
    });

    socket.on('force-sync', (data) => {
        isReceivingSync = true;
        videoPlayer.currentTime = data.time;
        if (data.isPlaying && videoPlayer.paused) {
            videoPlayer.play().catch(e => console.log('Auto-play prevented:', e));
        } else if (!data.isPlaying && !videoPlayer.paused) {
            videoPlayer.pause();
        }
        updateLastAction(`${data.user} forced sync`);
        setTimeout(() => {
            isReceivingSync = false;
        }, 100);
    });

    socket.on('error', (data) => {
        showError(data.message);
    });

    // Subtitle-related events
    socket.on('subtitle-added', (data) => {
        console.log('Subtitle added:', data.subtitle);
        availableSubtitles.push(data.subtitle);
        updateSubtitlesList();
        updateLastAction(`${data.user} added subtitle: ${data.subtitle.label}`);
    });

    socket.on('subtitle-selected', (data) => {
        console.log('Subtitle selected:', data.subtitleId);
        updateLastAction(`${data.user} selected subtitle`);
    });
}

// Restore file media for late-joining users
function restoreFileMedia(mediaData, videoState) {
    const videoUrl = mediaData.data.url;
    console.log('Restoring file media:', videoUrl);

    // Clear previous event listeners
    videoPlayer.onloadedmetadata = null;
    videoPlayer.onerror = null;

    videoPlayer.src = videoUrl;
    videoPlayer.currentTime = videoState.currentTime || 0;
    videoPlayer.playbackRate = videoState.playbackRate || 1;

    videoPlayer.onloadedmetadata = () => {
        console.log('Restored video loaded');
        updateMediaStatus(`Watching: ${mediaData.data.fileName}`);

        if (videoState.isPlaying) {
            videoPlayer.play().catch(e => console.log('Auto-play prevented:', e));
        }
    };

    videoPlayer.load();
    document.getElementById('torrentInfo').classList.add('hidden');
}

// Restore torrent media for late-joining users
function restoreTorrentMedia(mediaData, videoState) {
    console.log('Restoring torrent media:', mediaData);
    currentTorrentInfo = mediaData.data;

    if (currentTorrentInfo.streamUrl) {
        // Clear previous event listeners
        videoPlayer.onloadedmetadata = null;
        videoPlayer.onerror = null;

        videoPlayer.src = currentTorrentInfo.streamUrl;
        videoPlayer.currentTime = videoState.currentTime || 0;
        videoPlayer.playbackRate = videoState.playbackRate || 1;

        videoPlayer.onloadedmetadata = () => {
            console.log('Restored torrent video loaded');
            updateMediaStatus(`Watching: ${currentTorrentInfo.name}`);

            if (videoState.isPlaying) {
                videoPlayer.play().catch(e => console.log('Auto-play prevented:', e));
            }
        };

        videoPlayer.load();

        document.getElementById('torrentName').textContent = currentTorrentInfo.name;
        document.getElementById('torrentSize').textContent = formatBytes(currentTorrentInfo.size || 0);

        // Only show torrent info for admins
        if (userRole === 'admin') {
            document.getElementById('torrentInfo').classList.remove('hidden');
            updateTorrentProgressFromServer();
        }
    }
}

// Handle video synchronization
function handleVideoSync(data) {
    if (isReceivingSync) return;

    isReceivingSync = true;
    const syncTolerance = 1.0;

    switch (data.action) {
        case 'play':
            if (videoPlayer.paused) {
                if (data.time && Math.abs(videoPlayer.currentTime - data.time) > syncTolerance) {
                    videoPlayer.currentTime = data.time;
                }
                videoPlayer.play().catch(e => console.log('Auto-play prevented:', e));
            }
            break;
        case 'pause':
            if (!videoPlayer.paused) {
                if (data.time && Math.abs(videoPlayer.currentTime - data.time) > syncTolerance) {
                    videoPlayer.currentTime = data.time;
                }
                videoPlayer.pause();
            }
            break;
        case 'seek':
            videoPlayer.currentTime = data.time || 0;
            break;
        case 'playback-rate':
            videoPlayer.playbackRate = data.playbackRate || 1;
            if (data.time !== undefined && Math.abs(videoPlayer.currentTime - data.time) > syncTolerance) {
                videoPlayer.currentTime = data.time;
            }
            break;
    }

    updateLastAction(`${data.user} ${data.action}`);

    setTimeout(() => {
        isReceivingSync = false;
    }, 300);
}

// Handle media updates
function handleMediaUpdate(data) {
    console.log('Received media update:', data);

    switch (data.action) {
        case 'load-torrent':
            currentTorrentInfo = data.mediaData.data;
            updateMediaStatus(`${data.user} loaded torrent: ${currentTorrentInfo.name}`);

            if (currentTorrentInfo.streamUrl) {
                // Clear previous event listeners
                videoPlayer.onloadedmetadata = null;
                videoPlayer.onerror = null;

                videoPlayer.src = currentTorrentInfo.streamUrl;
                videoPlayer.load();

                document.getElementById('torrentName').textContent = currentTorrentInfo.name;
                document.getElementById('torrentSize').textContent = formatBytes(currentTorrentInfo.size || 0);

                // Only show torrent info for admins
                if (userRole === 'admin') {
                    document.getElementById('torrentInfo').classList.remove('hidden');
                    updateTorrentProgressFromServer();
                }
            }
            break;

        case 'load-file':
            currentTorrentInfo = null;
            clearTorrentProgress();
            updateMediaStatus(`${data.user} loaded: ${data.mediaData.data.fileName}`);

            // Clear previous event listeners
            videoPlayer.onloadedmetadata = null;
            videoPlayer.onerror = null;

            videoPlayer.src = data.mediaData.data.url;
            videoPlayer.load();
            document.getElementById('torrentInfo').classList.add('hidden');
            break;

        case 'clear-media':
            currentTorrentInfo = null;
            clearTorrentProgress();
            videoPlayer.src = '';
            updateMediaStatus(`${data.user} cleared media`);
            document.getElementById('torrentInfo').classList.add('hidden');
            break;
    }

    updateLastAction(`${data.user} ${data.action.replace('-', ' ')}`);
}

// Load torrent through server
async function loadTorrent() {
    if (userRole !== 'admin') {
        showError('Only admins can load torrents');
        return;
    }

    const torrentInput = document.getElementById('torrentInput').value.trim();

    if (!torrentInput) {
        showError('Please enter a magnet link');
        return;
    }

    if (!torrentInput.startsWith('magnet:')) {
        showError('Please enter a valid magnet link');
        return;
    }

    updateMediaStatus('🧲 Processing magnet link...');
    console.log('Loading torrent:', torrentInput);

    try {
        const response = await fetch('/api/torrents/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ magnetLink: torrentInput })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to add torrent');
        }

        const torrentData = await response.json();
        console.log('Torrent added:', torrentData);

        currentTorrentInfo = torrentData;

        // Display torrent info
        document.getElementById('torrentName').textContent = torrentData.name;
        document.getElementById('torrentSize').textContent = formatBytes(torrentData.totalLength);

        // Only show torrent info for admins
        if (userRole === 'admin') {
            document.getElementById('torrentInfo').classList.remove('hidden');
            // Display files
            displayTorrentFiles(torrentData.files);
        }

        // Auto-play first video file
        if (torrentData.files.length > 0) {
            const firstFile = torrentData.files[0];
            playTorrentFile(torrentData.infoHash, firstFile.index, firstFile.name);
        }

        // Start monitoring progress
        updateTorrentProgressFromServer();

    } catch (error) {
        showError('Failed to add torrent: ' + error.message);
        console.error('Torrent load error:', error);
    }
}

// Play torrent file
function playTorrentFile(infoHash, fileIndex, fileName) {
    if (userRole !== 'admin') {
        showError('Only admins can select files');
        return;
    }

    const streamUrl = `/api/torrents/${infoHash}/files/${fileIndex}/stream`;
    console.log('Playing torrent file:', fileName, 'from:', streamUrl);

    // Clear previous event listeners to prevent multiple calls
    videoPlayer.onloadedmetadata = null;
    videoPlayer.onerror = null;

    videoPlayer.src = streamUrl;
    videoPlayer.load();

    videoPlayer.onloadedmetadata = () => {
        console.log('Torrent video loaded successfully');
        updateMediaStatus(`Streaming: ${fileName}`);

        // Broadcast to other users
        broadcastMediaAction('load-torrent', {
            name: currentTorrentInfo.name,
            infoHash: infoHash,
            fileIndex: fileIndex,
            fileName: fileName,
            streamUrl: streamUrl,
            size: currentTorrentInfo.totalLength
        });

        // Restore subtitle selection if any
        if (selectedSubtitleId && selectedSubtitleId !== 'none') {
            setTimeout(() => {
                selectSubtitle(selectedSubtitleId);
            }, 100);
        }
    };

    videoPlayer.onerror = (e) => {
        console.error('Video streaming error:', e);
        showError('Failed to stream video. The torrent might still be downloading.');
    };
}

// Display torrent files
function displayTorrentFiles(files) {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '<h4 style="margin-bottom: 12px;">Available Files:</h4>';

    if (files.length === 0) {
        fileList.innerHTML += '<p style="color: #718096;">No video files found in this torrent.</p>';
        return;
    }

    files.forEach((file) => {
        const fileItem = document.createElement('div');
        fileItem.className = `file-item ${userRole === 'guest' ? 'restricted' : ''}`;

        fileItem.innerHTML = `
            <span>${file.name}</span>
            <span style="color: #718096; font-size: 0.85rem;">
                ${formatBytes(file.length)}
            </span>
        `;

        if (userRole === 'admin') {
            fileItem.onclick = () => playTorrentFile(currentTorrentInfo.infoHash, file.index, file.name);
            fileItem.style.cursor = 'pointer';
        } else {
            fileItem.title = 'Only admins can select files';
        }

        fileList.appendChild(fileItem);
    });
}

// Update torrent progress from server
async function updateTorrentProgressFromServer() {
    if (!currentTorrentInfo || !currentTorrentInfo.infoHash) return;

    clearTorrentProgress();

    const updateProgress = async () => {
        try {
            const response = await fetch(`/api/torrents/${currentTorrentInfo.infoHash}/status`);
            if (!response.ok) return;

            const status = await response.json();
            updateTorrentProgressUI(status);

            // Broadcast progress to other users
            if (userRole === 'admin' && socket && isConnected) {
                socket.emit('torrent-status', status);
            }
        } catch (error) {
            console.error('Error fetching torrent status:', error);
        }
    };

    // Initial update
    updateProgress();

    // Set up periodic updates
    torrentProgressInterval = setInterval(updateProgress, 1000);
}

// Update torrent progress UI
function updateTorrentProgressUI(status) {
    const progress = Math.round(status.progress * 100);
    document.getElementById('progressFill').style.width = progress + '%';
    document.getElementById('downloaded').textContent = formatBytes(status.downloaded);
    document.getElementById('downloadSpeed').textContent = formatBytes(status.downloadSpeed) + '/s';
    document.getElementById('numPeers').textContent = `${status.numPeers} peers`;

    // Update status message
    if (status.numPeers === 0 && progress < 100) {
        updateMediaStatus(`🔍 Searching for peers... (${progress}%)`);
    } else if (progress < 100) {
        updateMediaStatus(`⬇️ Downloading: ${status.name} (${progress}%, ${formatBytes(status.downloadSpeed)}/s)`);
    } else {
        updateMediaStatus(`✅ Complete: ${status.name} (Seeding to ${status.numPeers} peers)`);
    }
}

// Clear torrent progress monitoring
function clearTorrentProgress() {
    if (torrentProgressInterval) {
        clearInterval(torrentProgressInterval);
        torrentProgressInterval = null;
    }
    document.getElementById('progressFill').style.width = '0%';
}

// Upload file
async function uploadFile() {
    if (userRole !== 'admin') {
        showError('Only admins can upload files');
        return;
    }

    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];

    if (!file) {
        showError('Please select a file');
        return;
    }

    const maxSize = 10 * 1024 * 1024 * 1024; // 10GB
    if (file.size > maxSize) {
        showError(`File too large: ${formatBytes(file.size)}. Maximum size is 10GB.`);
        return;
    }

    updateMediaStatus(`Uploading ${file.name} (${formatBytes(file.size)})...`);

    const formData = new FormData();
    formData.append('video', file);

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            updateMediaStatus(`Uploading: ${percentComplete}% (${formatBytes(e.loaded)}/${formatBytes(e.total)})`);
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

                console.log('File uploaded successfully:', data);

                // Clear previous event listeners to prevent multiple calls
                videoPlayer.onloadedmetadata = null;
                videoPlayer.onerror = null;

                videoPlayer.src = data.url;

                videoPlayer.onloadedmetadata = () => {
                    updateMediaStatus('✅ Ready to stream: ' + data.originalName);

                    broadcastMediaAction('load-file', {
                        fileName: data.originalName,
                        fileSize: data.size,
                        url: data.url
                    });

                    // Restore subtitle selection if any
                    if (selectedSubtitleId && selectedSubtitleId !== 'none') {
                        setTimeout(() => {
                            selectSubtitle(selectedSubtitleId);
                        }, 100);
                    }

                    setTimeout(() => {
                        document.getElementById('progressFill').style.width = '0%';
                    }, 2000);
                };

                videoPlayer.load();
                document.getElementById('torrentInfo').classList.add('hidden');

            } catch (parseError) {
                console.error('JSON parse error:', parseError);
                showError('Server returned invalid response');
            }
        } else {
            try {
                const errorData = JSON.parse(xhr.responseText);
                showError(errorData.error || `Upload failed with status ${xhr.status}`);
            } catch {
                showError(`Upload failed: HTTP ${xhr.status}`);
            }
        }
    });

    xhr.addEventListener('error', () => {
        showError('Network error during upload');
    });

    xhr.addEventListener('timeout', () => {
        showError('Upload timed out');
    });

    xhr.timeout = 10 * 60 * 1000; // 10 minutes

    xhr.open('POST', '/upload');
    xhr.send(formData);
}

// Upload subtitle file
async function uploadSubtitle() {
    if (userRole !== 'admin') {
        showError('Only admins can upload subtitles');
        return;
    }

    const subtitleInput = document.getElementById('subtitleInput');
    const file = subtitleInput.files[0];

    if (!file) {
        showError('Please select a subtitle file');
        return;
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
        showError(`File too large: ${formatBytes(file.size)}. Maximum size is 5MB.`);
        return;
    }

    const language = document.getElementById('subtitleLanguage').value.trim() || 'Unknown';
    const label = document.getElementById('subtitleLabel').value.trim() || file.name;

    updateMediaStatus(`Uploading subtitle: ${file.name}...`);

    const formData = new FormData();
    formData.append('subtitle', file);
    formData.append('language', language);
    formData.append('label', label);

    const xhr = new XMLHttpRequest();

    xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);

                if (data.error) {
                    throw new Error(data.error);
                }

                console.log('Subtitle uploaded successfully:', data);

                // Broadcast to other users
                if (socket && isConnected) {
                    socket.emit('subtitle-upload', {
                        subtitle: data
                    });
                }

                // Clear form
                subtitleInput.value = '';
                document.getElementById('subtitleLanguage').value = '';
                document.getElementById('subtitleLabel').value = '';

                updateMediaStatus('✅ Subtitle uploaded: ' + data.label);

            } catch (parseError) {
                console.error('JSON parse error:', parseError);
                showError('Server returned invalid response');
            }
        } else {
            try {
                const errorData = JSON.parse(xhr.responseText);
                showError(errorData.error || `Upload failed with status ${xhr.status}`);
            } catch {
                showError(`Upload failed: HTTP ${xhr.status}`);
            }
        }
    });

    xhr.addEventListener('error', () => {
        showError('Network error during upload');
    });

    xhr.addEventListener('timeout', () => {
        showError('Upload timed out');
    });

    xhr.timeout = 30 * 1000; // 30 seconds

    xhr.open('POST', '/upload-subtitle');
    xhr.send(formData);
}

// Clear media
function clearMedia() {
    if (userRole !== 'admin') {
        showError('Only admins can clear media');
        return;
    }

    currentTorrentInfo = null;
    clearTorrentProgress();
    videoPlayer.src = '';
    document.getElementById('torrentInfo').classList.add('hidden');
    document.getElementById('progressFill').style.width = '0%';
    lastMediaAction = null; // Clear last media action

    updateMediaStatus('Media cleared');
    broadcastMediaAction('clear-media', {});
}

// Send video actions to server
function broadcastVideoAction(action, time, playbackRate) {
    if (!socket || !isConnected || isReceivingSync) return;

    const now = Date.now();
    if (now - lastSyncTime < syncThrottleDelay) {
        return;
    }
    lastSyncTime = now;

    socket.emit('video-action', {
        action: action,
        time: time,
        playbackRate: playbackRate
    });
}

// Send media actions to server
function broadcastMediaAction(action, mediaData) {
    if (!socket || !isConnected || userRole !== 'admin') return;

    // Create a unique key for this action to prevent duplicates
    const actionKey = `${action}-${JSON.stringify(mediaData)}`;

    // Prevent duplicate actions within a short time window
    if (lastMediaAction && lastMediaAction.key === actionKey &&
        Date.now() - lastMediaAction.timestamp < 2000) {
        console.log('Preventing duplicate media action:', action);
        return;
    }

    lastMediaAction = {
        key: actionKey,
        action: action,
        mediaData: mediaData,
        timestamp: Date.now()
    };

    console.log('Broadcasting media action:', action);
    socket.emit('media-action', {
        action: action,
        mediaData: mediaData
    });
}

// Role selection functions
function selectAdmin() {
    document.getElementById('adminAuth').classList.remove('hidden');
    document.getElementById('guestNameForm').classList.add('hidden');
}

function selectGuest() {
    document.getElementById('guestNameForm').classList.remove('hidden');
    document.getElementById('adminAuth').classList.add('hidden');
}

function cancelAuth() {
    document.getElementById('adminAuth').classList.add('hidden');
    document.getElementById('guestNameForm').classList.add('hidden');
    document.getElementById('authError').classList.add('hidden');
}

function authenticateAdmin() {
    const password = document.getElementById('adminPassword').value;

    if (password === ADMIN_PASSWORD) {
        setRole('admin', 'Admin');
    } else {
        document.getElementById('authError').classList.remove('hidden');
        document.getElementById('adminPassword').value = '';
    }
}

function setGuestName() {
    const name = document.getElementById('guestName').value.trim() || 'Anonymous';
    setRole('guest', name);
}

function setRole(role, name) {
    userRole = role;
    userName = name;

    document.getElementById('roleSelector').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');

    const roleIndicator = document.getElementById('roleIndicator');
    const userInfo = document.getElementById('userInfo');

    if (role === 'admin') {
        roleIndicator.textContent = 'Admin';
        roleIndicator.className = 'role-indicator admin';
        userInfo.textContent = `Logged in as ${name}`;
        document.getElementById('adminControls').style.display = 'block';
        document.getElementById('adminControls').classList.remove('hidden');
        document.getElementById('adminPlayerControls').classList.remove('hidden');
    } else {
        roleIndicator.textContent = 'Guest';
        roleIndicator.className = 'role-indicator guest';
        userInfo.textContent = `Connected as ${name}`;
        document.getElementById('adminControls').style.display = 'none';
        document.getElementById('adminControls').classList.add('hidden');
        document.getElementById('adminPlayerControls').classList.add('hidden');
    }

    updateMediaStatus(`Ready - ${role} access`);
    setupEventListeners();
    initializeSocket();
}

function resetRole() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }

    currentTorrentInfo = null;
    clearTorrentProgress();
    lastMediaAction = null; // Clear last media action
    availableSubtitles = [];
    selectedSubtitleId = null;
    userRole = null;
    userName = "Anonymous";
    isConnected = false;

    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('roleSelector').classList.remove('hidden');
    document.getElementById('adminAuth').classList.add('hidden');
    document.getElementById('guestNameForm').classList.add('hidden');
    document.getElementById('authError').classList.add('hidden');
    document.getElementById('torrentInfo').classList.add('hidden');

    document.getElementById('adminPassword').value = '';
    document.getElementById('guestName').value = '';
    document.getElementById('torrentInput').value = '';
    document.getElementById('fileInput').value = '';

    updateMediaStatus('Select your access level to begin');
}

// Video controls
function togglePlay() {
    if (videoPlayer.paused) {
        videoPlayer.play();
    } else {
        videoPlayer.pause();
    }
}

function seekBackward() {
    videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 10);
    broadcastVideoAction('seek', videoPlayer.currentTime);
}

function seekForward() {
    videoPlayer.currentTime = Math.min(videoPlayer.duration || 0, videoPlayer.currentTime + 10);
    broadcastVideoAction('seek', videoPlayer.currentTime);
}

function toggleFullscreen() {
    const videoContainer = document.querySelector('.custom-video-player');

    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        videoContainer.requestFullscreen();
    }
}

function syncTime() {
    if (userRole !== 'admin') {
        showError('Only admins can force sync');
        return;
    }

    if (socket && isConnected) {
        socket.emit('force-sync', {
            time: videoPlayer.currentTime,
            isPlaying: !videoPlayer.paused
        });
    }

    updateLastAction('Force sync initiated');
}

function restartVideo() {
    if (userRole !== 'admin') {
        showError('Only admins can restart video');
        return;
    }
    videoPlayer.currentTime = 0;
    broadcastVideoAction('seek', 0);
}

function setPlaybackRate(rate) {
    if (userRole !== 'admin') {
        showError('Only admins can change playback speed');
        return;
    }
    videoPlayer.playbackRate = rate;
}

function toggleSubtitles() {
    const tracks = Array.from(videoPlayer.textTracks);
    console.log('Toggle subtitles - available tracks:', tracks.length);

    if (tracks.length > 0) {
        const currentTrack = tracks.find(track => track.mode === 'showing');
        if (currentTrack) {
            currentTrack.mode = 'disabled';
            updateLastAction('Subtitles disabled');
            console.log('Subtitles disabled');
        } else {
            // Find the first available track or the selected one
            let trackToEnable = tracks[0];
            if (selectedSubtitleId && selectedSubtitleId !== 'none') {
                const selectedTrack = tracks.find(t => t.label === availableSubtitles.find(s => s.filename === selectedSubtitleId)?.label);
                if (selectedTrack) {
                    trackToEnable = selectedTrack;
                }
            }

            trackToEnable.mode = 'showing';
            updateLastAction('Subtitles enabled');
            console.log('Subtitles enabled:', trackToEnable.label);

            // Check visibility after enabling
            setTimeout(() => {
                checkSubtitleVisibility();
            }, 500);
        }
    } else {
        updateLastAction('No subtitle tracks available');
        console.log('No subtitle tracks available');
    }
}

// Enable native video player subtitles
function enableNativeSubtitles() {
    // Try to enable subtitles through the video player's native interface
    const tracks = Array.from(videoPlayer.textTracks);
    if (tracks.length > 0) {
        // Enable the first available subtitle track
        tracks[0].mode = 'showing';
        console.log('Enabled native subtitle track:', tracks[0].label);

        // Also try to trigger the video player's subtitle button if it exists
        const subtitleButton = videoPlayer.querySelector('[data-subtitle]') ||
            videoPlayer.querySelector('.vjs-subtitle-button') ||
            videoPlayer.querySelector('[aria-label*="subtitle"]');

        if (subtitleButton) {
            subtitleButton.click();
            console.log('Clicked native subtitle button');
        }

        // Check if subtitles are actually visible
        setTimeout(() => {
            checkSubtitleVisibility();
        }, 1000);
    }
}

// Check if subtitles are visible
function checkSubtitleVisibility() {
    const tracks = Array.from(videoPlayer.textTracks);
    const activeTrack = tracks.find(track => track.mode === 'showing');

    if (activeTrack) {
        console.log('Subtitle track is active:', activeTrack.label);
        console.log('Track mode:', activeTrack.mode);
        console.log('Track ready state:', activeTrack.readyState);

        if (activeTrack.cues && activeTrack.cues.length > 0) {
            console.log('Subtitle cues available:', activeTrack.cues.length);
            updateLastAction(`Subtitles active: ${activeTrack.label}`);
        } else {
            console.log('No subtitle cues available');
            updateLastAction('Subtitles loaded but no cues available');
        }
    } else {
        console.log('No active subtitle track found');
        updateLastAction('No subtitle track active');
    }
}

// Note: Server-side subtitle conversion is now handled by the backend
// All subtitle files are served as WebVTT format for browser compatibility

// File library functions
let currentLibrary = null;

async function loadFileLibrary() {
    if (userRole !== 'admin') {
        showError('Only admins can access the file library');
        return;
    }

    const statusElement = document.getElementById('libraryStatus');
    statusElement.textContent = 'Loading file library...';

    try {
        const response = await fetch('/api/library');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        currentLibrary = await response.json();
        displayFileLibrary(currentLibrary);
        statusElement.textContent = `Loaded ${currentLibrary.uploads.length} uploaded files and ${currentLibrary.downloads.length} downloaded files`;

    } catch (error) {
        console.error('Error loading file library:', error);
        statusElement.textContent = 'Error loading file library';
        showError('Failed to load file library: ' + error.message);
    }
}

function displayFileLibrary(library) {
    // Display uploaded files
    const uploadedList = document.getElementById('uploadedFilesList');
    uploadedList.innerHTML = '';

    if (library.uploads.length === 0) {
        uploadedList.innerHTML = '<div style="color: #718096; text-align: center; padding: 20px;">No uploaded files found</div>';
    } else {
        library.uploads.forEach(file => {
            const fileItem = createLibraryFileItem(file, 'uploaded');
            uploadedList.appendChild(fileItem);
        });
    }

    // Display downloaded files
    const downloadedList = document.getElementById('downloadedFilesList');
    downloadedList.innerHTML = '';

    if (library.downloads.length === 0) {
        downloadedList.innerHTML = '<div style="color: #718096; text-align: center; padding: 20px;">No downloaded files found</div>';
    } else {
        library.downloads.forEach(file => {
            const fileItem = createLibraryFileItem(file, 'downloaded');
            downloadedList.appendChild(fileItem);
        });
    }
}

function createLibraryFileItem(file, type) {
    const fileItem = document.createElement('div');
    fileItem.className = `library-file-item ${type}`;

    const fileName = type === 'uploaded' ? file.originalName : file.originalName;
    const fileSize = formatBytes(file.size);
    const fileDate = new Date(file.addedAt).toLocaleDateString();

    fileItem.innerHTML = `
        <div class="file-info">
            <div class="file-name">${fileName}</div>
            <div class="file-details">
                <span class="file-size">${fileSize}</span>
                <span class="file-date">${fileDate}</span>
                ${type === 'downloaded' ? `<span style="color: #fbb6ce;">📁 ${file.folderName}</span>` : ''}
            </div>
        </div>
        <button class="play-button" onclick="playLibraryFile('${file.url}', '${fileName}')">▶️ Play</button>
    `;

    return fileItem;
}

function playLibraryFile(fileUrl, fileName) {
    if (userRole !== 'admin') {
        showError('Only admins can play files from library');
        return;
    }

    console.log('Playing library file:', fileName, 'from:', fileUrl);

    // Clear previous event listeners
    videoPlayer.onloadedmetadata = null;
    videoPlayer.onerror = null;

    videoPlayer.src = fileUrl;
    videoPlayer.load();

    videoPlayer.onloadedmetadata = () => {
        console.log('Library file loaded successfully');
        updateMediaStatus(`Playing: ${fileName}`);

        // Broadcast to other users
        broadcastMediaAction('load-file', {
            fileName: fileName,
            fileSize: 0, // We don't have size info in this context
            url: fileUrl
        });
    };

    videoPlayer.onerror = (e) => {
        console.error('Library file error:', e);
        showError('Failed to load library file');
    };

    // Clear torrent info since we're playing a file
    currentTorrentInfo = null;
    clearTorrentProgress();
    document.getElementById('torrentInfo').classList.add('hidden');
}

// Test subtitle loading
function testSubtitleLoading() {
    console.log('=== Subtitle Loading Test ===');
    console.log('Available subtitles:', availableSubtitles);
    console.log('Selected subtitle ID:', selectedSubtitleId);
    console.log('Video text tracks:', videoPlayer.textTracks.length);

    Array.from(videoPlayer.textTracks).forEach((track, index) => {
        console.log(`Track ${index}:`, {
            kind: track.kind,
            label: track.label,
            language: track.language,
            mode: track.mode,
            readyState: track.readyState,
            cues: track.cues ? track.cues.length : 0
        });
    });

    // Test subtitle file accessibility and format
    if (availableSubtitles.length > 0) {
        console.log('=== Testing Subtitle File Accessibility ===');
        availableSubtitles.forEach(subtitle => {
            fetch(subtitle.url)
                .then(response => {
                    console.log(`Subtitle ${subtitle.label}:`, {
                        status: response.status,
                        ok: response.ok,
                        contentType: response.headers.get('content-type'),
                        size: response.headers.get('content-length')
                    });
                    return response.text();
                })
                .then(text => {
                    console.log(`Subtitle ${subtitle.label} content preview:`, text.substring(0, 300));

                    // Analyze subtitle format
                    analyzeSubtitleFormat(subtitle.label, text);
                })
                .catch(error => {
                    console.error(`Subtitle ${subtitle.label} fetch error:`, error);
                });
        });
    }
}

// Analyze subtitle format to help with debugging
function analyzeSubtitleFormat(label, content) {
    console.log(`=== Analyzing subtitle format: ${label} ===`);

    const lines = content.split('\n');
    console.log('Total lines:', lines.length);
    console.log('First 10 lines:', lines.slice(0, 10));

    // Check for common subtitle formats
    if (content.includes('-->')) {
        console.log('Format detected: SRT (SubRip)');

        // Count subtitle blocks
        const blocks = content.split(/\n\s*\n/).filter(block => block.trim());
        console.log('Subtitle blocks found:', blocks.length);

        if (blocks.length > 0) {
            console.log('First block:', blocks[0]);
        }
    } else if (content.includes('WEBVTT')) {
        console.log('Format detected: WebVTT');
    } else if (content.includes('[Script Info]')) {
        console.log('Format detected: ASS/SSA');
    } else {
        console.log('Format: Unknown or corrupted');
    }

    // Check for encoding issues
    if (content.includes('') || content.includes('?')) {
        console.warn('Potential encoding issues detected');
    }
}

// Event listeners
function setupEventListeners() {
    videoPlayer.removeEventListener('play', handlePlay);
    videoPlayer.removeEventListener('pause', handlePause);
    videoPlayer.removeEventListener('ratechange', handleRateChange);

    videoPlayer.addEventListener('play', handlePlay);
    videoPlayer.addEventListener('pause', handlePause);
    videoPlayer.addEventListener('ratechange', handleRateChange);

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName.toLowerCase() !== 'input') {
            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    seekBackward();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    seekForward();
                    break;
                case 'KeyF':
                    e.preventDefault();
                    toggleFullscreen();
                    break;
                case 'KeyS':
                    e.preventDefault();
                    toggleSubtitles();
                    break;
                case 'KeyT':
                    e.preventDefault();
                    testSubtitleLoading();
                    break;
            }
        }
    });
}

// Event handlers for automatic synchronization
function handlePlay() {
    if (!isReceivingSync && isConnected) {
        console.log('Video played, broadcasting sync');
        broadcastVideoAction('play', videoPlayer.currentTime);
        updateLastAction(`${userName} played video`);
    }
}

function handlePause() {
    if (!isReceivingSync && isConnected) {
        console.log('Video paused, broadcasting sync');
        broadcastVideoAction('pause', videoPlayer.currentTime);
        updateLastAction(`${userName} paused video`);
    }
}

function handleRateChange() {
    if (!isReceivingSync && isConnected) {
        console.log('Playback rate changed, broadcasting sync');
        broadcastVideoAction('playback-rate', videoPlayer.currentTime, videoPlayer.playbackRate);
        updateLastAction(`${userName} changed speed to ${videoPlayer.playbackRate}x`);
    }
}

// UI update functions
function updateConnectionStatus(message, status) {
    const statusElement = document.getElementById('connectionStatus');
    statusElement.textContent = message;
    statusElement.className = `connection-status ${status}`;
}

function updateMediaStatus(message) {
    document.getElementById('mediaStatus').textContent = message;
}

function updateLastAction(action) {
    document.getElementById('lastAction').textContent = action;
}

function updateRoomStatus(message) {
    document.getElementById('roomStatus').textContent = message;
    document.getElementById('syncStatus').textContent = 'Active';
}

function updateUsersList(users) {
    const usersList = document.getElementById('usersList');
    usersList.innerHTML = '';

    users.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = `user-item ${user.role}`;
        userItem.textContent = user.name;
        usersList.appendChild(userItem);
    });

    document.getElementById('connectedUsers').textContent = `${users.length} user${users.length !== 1 ? 's' : ''}`;
}

function showError(message) {
    updateMediaStatus(`Error: ${message}`);
    console.error(message);
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Subtitle functions
function selectSubtitle(subtitleId) {
    selectedSubtitleId = subtitleId;

    console.log('Selecting subtitle:', subtitleId);

    // Remove existing subtitle tracks
    const existingTracks = videoPlayer.querySelectorAll('track');
    existingTracks.forEach(track => {
        console.log('Removing track:', track.label);
        track.remove();
    });

    if (subtitleId && subtitleId !== 'none') {
        const subtitle = availableSubtitles.find(s => s.filename === subtitleId);
        if (subtitle) {
            console.log('Loading subtitle:', subtitle.label);

            // Create subtitle track directly - server handles conversion
            createSubtitleTrack(subtitle);
        } else {
            console.error('Subtitle not found:', subtitleId);
        }
    } else {
        // Disable all subtitle tracks
        const tracks = Array.from(videoPlayer.textTracks);
        tracks.forEach(track => {
            track.mode = 'disabled';
            console.log('Disabled track:', track.label);
        });
        console.log('All subtitles disabled');
        updateLastAction('Subtitles disabled');
    }

    // Broadcast selection to other users
    if (socket && isConnected) {
        socket.emit('subtitle-select', {
            subtitleId: subtitleId
        });
    }

    updateSubtitlesList();

    // Debug: Log subtitle status
    setTimeout(() => {
        const tracks = Array.from(videoPlayer.textTracks);
        console.log('Current subtitle tracks:', tracks.length);
        tracks.forEach((track, index) => {
            console.log(`Track ${index}:`, {
                kind: track.kind,
                label: track.label,
                language: track.language,
                mode: track.mode,
                readyState: track.readyState
            });
        });
    }, 1000);
}

// Create subtitle track from content
function createSubtitleTrack(subtitle, content) {
    try {
        console.log('Creating subtitle track for:', subtitle.label);

        // Remove any existing tracks first
        const existingTracks = videoPlayer.querySelectorAll('track');
        existingTracks.forEach(track => {
            console.log('Removing existing track:', track.label);
            track.remove();
        });

        // Create track element - server now serves everything as WebVTT
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.src = subtitle.url; // Use the server URL directly
        track.srclang = subtitle.language || 'en';
        track.label = subtitle.label;
        track.default = true;

        // Add track to video
        videoPlayer.appendChild(track);

        // Enable the track
        track.addEventListener('load', () => {
            console.log('Subtitle track loaded successfully:', subtitle.label);

            setTimeout(() => {
                const tracks = Array.from(videoPlayer.textTracks);
                console.log('Available tracks after load:', tracks.length);

                const ourTrack = tracks.find(t => t.label === subtitle.label);

                if (ourTrack) {
                    ourTrack.mode = 'showing';
                    console.log('Subtitle track enabled, mode:', ourTrack.mode);
                    updateLastAction(`Subtitle enabled: ${subtitle.label}`);

                    // Check if subtitles are working
                    setTimeout(() => {
                        checkSubtitleVisibility();
                    }, 1000);
                } else {
                    console.warn('Could not find our track in textTracks');
                    // Try to enable the first available track
                    if (tracks.length > 0) {
                        tracks[0].mode = 'showing';
                        console.log('Enabled first available track:', tracks[0].label);
                        updateLastAction(`Subtitle enabled: ${tracks[0].label}`);
                    }
                }
            }, 100);
        });

        track.addEventListener('error', (e) => {
            console.error('Subtitle track error:', e);
            console.error('Error details:', {
                error: e,
                target: e.target,
                src: e.target.src,
                label: e.target.label
            });

            // Clean up the failed track
            track.remove();
            showError(`Failed to load subtitle: ${subtitle.label}`);
        });

        console.log('Subtitle track element added to video');

    } catch (error) {
        console.error('Failed to create subtitle track:', error);
        showError(`Failed to create subtitle track: ${subtitle.label}`);
    }
}

function updateSubtitlesList() {
    const subtitlesList = document.getElementById('subtitlesList');
    const subtitleDropdown = document.getElementById('subtitleDropdown');

    if (!subtitlesList) return;

    subtitlesList.innerHTML = '';

    // Add "No subtitles" option
    const noSubtitleOption = document.createElement('div');
    noSubtitleOption.className = `subtitle-option ${selectedSubtitleId === 'none' ? 'selected' : ''}`;
    noSubtitleOption.onclick = () => selectSubtitle('none');
    noSubtitleOption.innerHTML = `
        <span>No Subtitles</span>
        <span style="color: #718096; font-size: 0.85rem;">Off</span>
    `;
    subtitlesList.appendChild(noSubtitleOption);

    // Add available subtitle options
    availableSubtitles.forEach(subtitle => {
        const subtitleOption = document.createElement('div');
        subtitleOption.className = `subtitle-option ${selectedSubtitleId === subtitle.filename ? 'selected' : ''}`;
        subtitleOption.onclick = () => selectSubtitle(subtitle.filename);
        subtitleOption.innerHTML = `
            <span>${subtitle.label}</span>
            <span style="color: #718096; font-size: 0.85rem;">${subtitle.language}</span>
        `;
        subtitlesList.appendChild(subtitleOption);
    });

    // Update custom player subtitle dropdown
    if (subtitleDropdown) {
        subtitleDropdown.innerHTML = '';

        // Add "No subtitles" option
        const noSubtitleDropdownOption = document.createElement('div');
        noSubtitleDropdownOption.className = `subtitle-option ${selectedSubtitleId === 'none' ? 'selected' : ''}`;
        noSubtitleDropdownOption.dataset.subtitle = 'none';
        noSubtitleDropdownOption.innerHTML = '<span>No Subtitles</span>';
        noSubtitleDropdownOption.addEventListener('click', () => selectSubtitle('none'));
        subtitleDropdown.appendChild(noSubtitleDropdownOption);

        // Add available subtitle options
        availableSubtitles.forEach(subtitle => {
            const subtitleDropdownOption = document.createElement('div');
            subtitleDropdownOption.className = `subtitle-option ${selectedSubtitleId === subtitle.filename ? 'selected' : ''}`;
            subtitleDropdownOption.dataset.subtitle = subtitle.filename;
            subtitleDropdownOption.innerHTML = `<span>${subtitle.label}</span>`;
            subtitleDropdownOption.addEventListener('click', () => selectSubtitle(subtitle.filename));
            subtitleDropdown.appendChild(subtitleDropdownOption);
        });
    }

    // Show/hide subtitle section based on availability
    const subtitleSection = document.getElementById('subtitleSection');
    if (subtitleSection) {
        subtitleSection.style.display = availableSubtitles.length > 0 ? 'block' : 'none';
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    videoPlayer = document.getElementById('videoPlayer');
    updateMediaStatus('Select your access level to begin');

    // Initialize subtitle support
    initializeSubtitleSupport();

    setupUIEventListeners();
});

// Initialize subtitle support
function initializeSubtitleSupport() {
    // Enable subtitle support
    videoPlayer.addEventListener('loadedmetadata', () => {
        console.log('Video metadata loaded, subtitle tracks available:', videoPlayer.textTracks.length);

        // If there's a selected subtitle, make sure it's enabled
        if (selectedSubtitleId && selectedSubtitleId !== 'none') {
            const tracks = Array.from(videoPlayer.textTracks);
            if (tracks.length > 0) {
                tracks[0].mode = 'showing';
                console.log('Subtitle track enabled');
            }
        }
    });

    // Handle subtitle track changes
    videoPlayer.addEventListener('loadeddata', () => {
        console.log('Video data loaded, checking subtitle tracks');
        const tracks = Array.from(videoPlayer.textTracks);
        console.log('Available text tracks:', tracks.length);

        tracks.forEach((track, index) => {
            console.log(`Track ${index}:`, track.kind, track.label, track.language, track.mode);
        });
    });
}

// Setup UI event listeners
function setupUIEventListeners() {
    // Role selection buttons
    document.getElementById('adminBtn').addEventListener('click', selectAdmin);
    document.getElementById('guestBtn').addEventListener('click', selectGuest);

    // Authentication buttons
    document.getElementById('authenticateBtn').addEventListener('click', authenticateAdmin);
    document.getElementById('cancelAuthBtn').addEventListener('click', cancelAuth);
    document.getElementById('setGuestNameBtn').addEventListener('click', setGuestName);
    document.getElementById('cancelGuestBtn').addEventListener('click', cancelAuth);

    // Admin control buttons
    document.getElementById('uploadBtn').addEventListener('click', uploadFile);
    document.getElementById('clearMediaBtn').addEventListener('click', clearMedia);
    document.getElementById('loadTorrentBtn').addEventListener('click', loadTorrent);
    document.getElementById('uploadSubtitleBtn').addEventListener('click', uploadSubtitle);
    document.getElementById('resetRoleBtn').addEventListener('click', resetRole);

    // File library buttons
    document.getElementById('refreshLibraryBtn').addEventListener('click', loadFileLibrary);

    // Video control buttons
    document.getElementById('togglePlayBtn').addEventListener('click', togglePlay);
    document.getElementById('seekBackBtn').addEventListener('click', seekBackward);
    document.getElementById('seekForwardBtn').addEventListener('click', seekForward);
    document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);

    // Admin video control buttons
    document.getElementById('syncTimeBtn').addEventListener('click', syncTime);
    document.getElementById('restartBtn').addEventListener('click', restartVideo);
    document.getElementById('rate05Btn').addEventListener('click', () => setPlaybackRate(0.5));
    document.getElementById('rate1Btn').addEventListener('click', () => setPlaybackRate(1));
    document.getElementById('rate15Btn').addEventListener('click', () => setPlaybackRate(1.5));

    // Enter key support
    document.getElementById('adminPassword').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') authenticateAdmin();
    });

    document.getElementById('guestName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') setGuestName();
    });
}