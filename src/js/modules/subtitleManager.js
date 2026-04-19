import { state } from '../state.js';
import { config } from '../config.js';
import { socketManager, uiManager } from '../main.js';

export class SubtitleManager {
    initialize() {
        state.videoPlayer.addEventListener('loadedmetadata', () => {
            if (state.selectedSubtitleId && state.selectedSubtitleId !== 'none') {
                const tracks = Array.from(state.videoPlayer.textTracks);
                if (tracks.length > 0) {
                    tracks[0].mode = 'showing';
                }
            }
        });

        state.videoPlayer.addEventListener('loadeddata', () => {
            const tracks = Array.from(state.videoPlayer.textTracks);
            tracks.forEach((track, index) => {
                console.log(`Track loaded: ${index}`, { kind: track.kind });
            });
        });
    }

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
                    if (data.error) throw new Error(data.error);

                    if (state.socket && state.isConnected) {
                        state.socket.emit('subtitle-upload', { subtitle: data });
                    }

                    subtitleInput.value = '';
                    document.getElementById('subtitleLanguage').value = '';
                    document.getElementById('subtitleLabel').value = '';

                    uiManager.updateMediaStatus('✅ Subtitle uploaded: ' + data.label);

                } catch (parseError) {
                    console.error('JSON parse error:', parseError);
                    uiManager.showError('Server returned invalid response');
                }
            } else {
                uiManager.showError(`Upload failed: HTTP ${xhr.status}`);
            }
        });

        xhr.addEventListener('error', () => uiManager.showError('Network error during upload'));
        xhr.addEventListener('timeout', () => uiManager.showError('Upload timed out'));
        xhr.timeout = config.SUBTITLE_TIMEOUT;

        xhr.open('POST', `/upload-subtitle?roomId=${encodeURIComponent(state.currentRoomId)}`);
        xhr.send(formData);
    }

    selectSubtitle(subtitleId) {
        state.selectedSubtitleId = subtitleId;

        const existingTracks = state.videoPlayer.querySelectorAll('track');
        existingTracks.forEach(track => track.remove());

        if (subtitleId && subtitleId !== 'none') {
            const subtitle = state.availableSubtitles.find(s => s.filename === subtitleId);
            if (subtitle) {
                this.createSubtitleTrack(subtitle);
            } else {
                console.error('Subtitle not found:', subtitleId);
            }
        } else {
            const tracks = Array.from(state.videoPlayer.textTracks);
            tracks.forEach(track => track.mode = 'disabled');
            uiManager.updateLastAction('Subtitles disabled');
        }

        if (state.socket && state.isConnected) {
            state.socket.emit('subtitle-select', { subtitleId: subtitleId });
        }

        this.updateSubtitlesList();
    }

    createSubtitleTrack(subtitle) {
        try {
            const existingTracks = state.videoPlayer.querySelectorAll('track');
            existingTracks.forEach(track => track.remove());

            const track = document.createElement('track');
            track.kind = 'subtitles';
            track.src = subtitle.url;
            track.srclang = subtitle.language || 'en';
            track.label = subtitle.label;
            track.default = true;

            state.videoPlayer.appendChild(track);

            track.addEventListener('load', () => {
                setTimeout(() => {
                    const tracks = Array.from(state.videoPlayer.textTracks);
                    const ourTrack = tracks.find(t => t.label === subtitle.label);

                    if (ourTrack) {
                        ourTrack.mode = 'showing';
                        uiManager.updateLastAction(`Subtitle enabled: ${subtitle.label}`);
                    }
                }, 500);
            });

            track.addEventListener('error', () => {
                track.remove();
                uiManager.showError(`Failed to load subtitle: ${subtitle.label}`);
            });

        } catch (error) {
            console.error('Failed to create subtitle track:', error);
            uiManager.showError(`Failed to create subtitle track: ${subtitle.label}`);
        }
    }

    updateSubtitlesList() {
        const subtitlesList = document.getElementById('subtitlesList');
        if (!subtitlesList) return;
        subtitlesList.innerHTML = '';

        // Rows render inside the CC popover (narrow). Uniform row style:
        //   selected → primary-tinted bg + left accent dot
        //   hover → faint white wash
        const makeRow = ({ selected, onclick }) => {
            const row = document.createElement('div');
            row.className = selected
                ? 'flex items-center gap-3 px-4 py-2.5 bg-primary/[0.08] cursor-pointer'
                : 'flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-100/[0.03] cursor-pointer transition';
            row.addEventListener('click', onclick);
            return row;
        };
        const dot = (color) => {
            const d = document.createElement('span');
            d.className = `w-1.5 h-1.5 rounded-full ${color}`;
            return d;
        };

        // "Off" row always first
        const offSelected = state.selectedSubtitleId === 'none' || !state.selectedSubtitleId;
        const offRow = makeRow({ selected: offSelected, onclick: () => this.selectSubtitle('none') });
        offRow.append(dot(offSelected ? 'bg-primary' : 'bg-neutral-700'));
        const offLabel = document.createElement('span');
        offLabel.className = 'flex-1 text-sm ' + (offSelected ? 'text-neutral-100' : 'text-neutral-400');
        offLabel.textContent = 'Off';
        offRow.appendChild(offLabel);
        subtitlesList.appendChild(offRow);

        // One row per available subtitle
        state.availableSubtitles.forEach(subtitle => {
            const selected = state.selectedSubtitleId === subtitle.filename;
            const row = makeRow({ selected, onclick: () => this.selectSubtitle(subtitle.filename) });
            row.dataset.subtitleItem = `${subtitle.label} ${subtitle.language}`;

            row.append(dot(selected ? 'bg-primary' : 'bg-neutral-700'));

            const labelEl = document.createElement('span');
            labelEl.className = 'flex-1 text-sm truncate ' + (selected ? 'text-neutral-100' : 'text-neutral-300');
            labelEl.textContent = subtitle.label;

            const langEl = document.createElement('span');
            langEl.className = 'text-[10px] font-mono ' + (selected ? 'text-primary' : 'text-neutral-500');
            langEl.textContent = subtitle.language || 'und';

            row.append(labelEl, langEl);
            subtitlesList.appendChild(row);
        });
        // subtitleSection visibility is NOT toggled — CC button is always present
        // in the transport bar; an empty list just shows "Off" + the upload form.
    }

    clearSubtitles() {
        state.availableSubtitles = [];
        state.selectedSubtitleId = null;
        const existingTracks = state.videoPlayer.querySelectorAll('track');
        existingTracks.forEach(track => track.remove());
        this.updateSubtitlesList();
    }

    toggleSubtitles() {
        const tracks = Array.from(state.videoPlayer.textTracks);
        if (tracks.length > 0) {
            const currentTrack = tracks.find(track => track.mode === 'showing');
            if (currentTrack) {
                currentTrack.mode = 'disabled';
                uiManager.updateLastAction('Subtitles disabled');
            } else {
                let trackToEnable = tracks[0];
                if (state.selectedSubtitleId && state.selectedSubtitleId !== 'none') {
                    const selectedTrack = tracks.find(t => t.label === state.availableSubtitles.find(s => s.filename === state.selectedSubtitleId)?.label);
                    if (selectedTrack) trackToEnable = selectedTrack;
                }
                trackToEnable.mode = 'showing';
                uiManager.updateLastAction('Subtitles enabled');
                setTimeout(() => this.checkSubtitleVisibility(), 500);
            }
        } else {
            uiManager.updateLastAction('No subtitle tracks available');
        }
    }

    checkSubtitleVisibility() {
        const tracks = Array.from(state.videoPlayer.textTracks);
        const activeTrack = tracks.find(track => track.mode === 'showing');
        if (activeTrack) {
            uiManager.updateLastAction(activeTrack.cues && activeTrack.cues.length > 0 ? `Subtitles active: ${activeTrack.label}` : 'Subtitles loaded (no cues)');
        } else {
            uiManager.updateLastAction('No subtitle track active');
        }
    }
}