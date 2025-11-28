// modules/subtitleManager.js - Subtitle management functionality

import { state } from '../state.js';
import { config } from '../config.js';
import { socketManager, uiManager } from '../main.js';

export class SubtitleManager {
    initialize() {
        // Enable subtitle support
        state.videoPlayer.addEventListener('loadedmetadata', () => {

            // If there's a selected subtitle, make sure it's enabled
            if (state.selectedSubtitleId && state.selectedSubtitleId !== 'none') {
                const tracks = Array.from(state.videoPlayer.textTracks);
                if (tracks.length > 0) {
                    tracks[0].mode = 'showing';
                }
            }
        });

        // Handle subtitle track changes
        state.videoPlayer.addEventListener('loadeddata', () => {
            const tracks = Array.from(state.videoPlayer.textTracks);

            tracks.forEach((track, index) => {
            });
        });
    }

    // Upload subtitle file
    async uploadSubtitle() {
        if (state.userRole !== 'admin') {
            uiManager.showError('Only admins can upload subtitles');
            return;
        }

        const subtitleInput = document.getElementById('subtitleInput');
        const file = subtitleInput.files[0];

        if (!file) {
            uiManager.showError('Please select a subtitle file');
            return;
        }

        if (file.size > config.MAX_SUBTITLE_SIZE) {
            uiManager.showError(`File too large: ${uiManager.formatBytes(file.size)}. Maximum size is 5MB.`);
            return;
        }

        const language = document.getElementById('subtitleLanguage').value.trim() || 'Unknown';
        const label = document.getElementById('subtitleLabel').value.trim() || file.name;

        uiManager.updateMediaStatus(`Uploading subtitle: ${file.name}...`);

        const formData = new FormData();
        formData.append('subtitle', file);
        formData.append('roomId', state.currentRoomId);
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


                    // Broadcast to other users
                    if (state.socket && state.isConnected) {
                        state.socket.emit('subtitle-upload', {
                            subtitle: data
                        });
                    }

                    // Clear form
                    subtitleInput.value = '';
                    document.getElementById('subtitleLanguage').value = '';
                    document.getElementById('subtitleLabel').value = '';

                    uiManager.updateMediaStatus('✅ Subtitle uploaded: ' + data.label);

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

        xhr.timeout = config.SUBTITLE_TIMEOUT;

        xhr.open('POST', `/upload-subtitle?roomId=${encodeURIComponent(state.currentRoomId)}`)
        xhr.send(formData);
    }

    // Select subtitle
    selectSubtitle(subtitleId) {
        state.selectedSubtitleId = subtitleId;


        // Remove existing subtitle tracks
        const existingTracks = state.videoPlayer.querySelectorAll('track');
        existingTracks.forEach(track => {
            track.remove();
        });

        if (subtitleId && subtitleId !== 'none') {
            const subtitle = state.availableSubtitles.find(s => s.filename === subtitleId);
            if (subtitle) {

                // Create subtitle track directly - server handles conversion
                this.createSubtitleTrack(subtitle);
            } else {
                console.error('Subtitle not found:', subtitleId);
            }
        } else {
            // Disable all subtitle tracks
            const tracks = Array.from(state.videoPlayer.textTracks);
            tracks.forEach(track => {
                track.mode = 'disabled';
            });
            uiManager.updateLastAction('Subtitles disabled');
        }

        // Broadcast selection to other users
        if (state.socket && state.isConnected) {
            state.socket.emit('subtitle-select', {
                subtitleId: subtitleId
            });
        }

        this.updateSubtitlesList();

        // Debug: Log subtitle status
        setTimeout(() => {
            const tracks = Array.from(state.videoPlayer.textTracks);
            tracks.forEach((track, index) => {
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
    createSubtitleTrack(subtitle) {
        try {

            // Remove any existing tracks first
            const existingTracks = state.videoPlayer.querySelectorAll('track');
            existingTracks.forEach(track => {
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
            state.videoPlayer.appendChild(track);

            // Enable the track
            track.addEventListener('load', () => {

                // Wait a bit longer for track to be fully ready
                setTimeout(() => {
                    const tracks = Array.from(state.videoPlayer.textTracks);

                    const ourTrack = tracks.find(t => t.label === subtitle.label);

                    if (ourTrack) {
                        // Force track to showing mode
                        ourTrack.mode = 'showing';

                        // If still no cues, try to force a reload
                        if (!ourTrack.cues || ourTrack.cues.length === 0) {
                            console.warn('No cues loaded, checking track src:', track.src);

                            // Try fetching the subtitle file directly to debug
                            fetch(track.src)
                                .then(res => res.text())
                                .then(content => {
                                })
                                .catch(err => console.error('Error fetching subtitle:', err));
                        }

                        uiManager.updateLastAction(`Subtitle enabled: ${subtitle.label}`);
                    } else {
                        console.warn('Could not find our track in textTracks');
                    }
                }, 500); // Increased delay
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
                uiManager.showError(`Failed to load subtitle: ${subtitle.label}`);
            });


        } catch (error) {
            console.error('Failed to create subtitle track:', error);
            uiManager.showError(`Failed to create subtitle track: ${subtitle.label}`);
        }
    }

    // Update subtitles list UI
    updateSubtitlesList() {
        const subtitlesList = document.getElementById('subtitlesList');

        if (!subtitlesList) return;

        subtitlesList.innerHTML = '';

        // Add "No subtitles" option
        const noSubtitleOption = document.createElement('div');
        noSubtitleOption.className = `subtitle-option ${state.selectedSubtitleId === 'none' ? 'selected' : ''}`;
        noSubtitleOption.onclick = () => this.selectSubtitle('none');
        noSubtitleOption.innerHTML = `
            <span>No Subtitles</span>
            <span style="color: #718096; font-size: 0.85rem;">Off</span>
        `;
        subtitlesList.appendChild(noSubtitleOption);

        // Add available subtitle options
        state.availableSubtitles.forEach(subtitle => {
            const subtitleOption = document.createElement('div');
            subtitleOption.className = `subtitle-option ${state.selectedSubtitleId === subtitle.filename ? 'selected' : ''}`;
            subtitleOption.onclick = () => this.selectSubtitle(subtitle.filename);
            subtitleOption.innerHTML = `
                <span>${subtitle.label}</span>
                <span style="color: #718096; font-size: 0.85rem;">${subtitle.language}</span>
            `;
            subtitlesList.appendChild(subtitleOption);
        });

        // Show/hide subtitle section based on availability
        const subtitleSection = document.getElementById('subtitleSection');
        if (subtitleSection) {
            subtitleSection.style.display = state.availableSubtitles.length > 0 ? 'block' : 'none';
        }
    }

    // Toggle subtitles on/off
    toggleSubtitles() {
        const tracks = Array.from(state.videoPlayer.textTracks);

        if (tracks.length > 0) {
            const currentTrack = tracks.find(track => track.mode === 'showing');
            if (currentTrack) {
                currentTrack.mode = 'disabled';
                uiManager.updateLastAction('Subtitles disabled');
            } else {
                // Find the first available track or the selected one
                let trackToEnable = tracks[0];
                if (state.selectedSubtitleId && state.selectedSubtitleId !== 'none') {
                    const selectedTrack = tracks.find(t => t.label === state.availableSubtitles.find(s => s.filename === state.selectedSubtitleId)?.label);
                    if (selectedTrack) {
                        trackToEnable = selectedTrack;
                    }
                }

                trackToEnable.mode = 'showing';
                uiManager.updateLastAction('Subtitles enabled');

                // Check visibility after enabling
                setTimeout(() => {
                    this.checkSubtitleVisibility();
                }, 500);
            }
        } else {
            uiManager.updateLastAction('No subtitle tracks available');
        }
    }

    // Check if subtitles are visible
    checkSubtitleVisibility() {
        const tracks = Array.from(state.videoPlayer.textTracks);
        const activeTrack = tracks.find(track => track.mode === 'showing');

        if (activeTrack) {

            if (activeTrack.cues && activeTrack.cues.length > 0) {
                uiManager.updateLastAction(`Subtitles active: ${activeTrack.label}`);
            } else {
                uiManager.updateLastAction('Subtitles loaded but no cues available');
            }
        } else {
            uiManager.updateLastAction('No subtitle track active');
        }
    }
}