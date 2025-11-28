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

        const getClasses = (isSelected) => {
            let base = 'cursor-pointer p-2 rounded flex justify-between items-center text-xs transition mb-1 ';
            if (isSelected) return base + 'bg-primary text-white font-bold';
            return base + 'text-slate-300 hover:bg-white/10';
        };

        const noSubtitleOption = document.createElement('div');
        noSubtitleOption.className = getClasses(state.selectedSubtitleId === 'none');
        noSubtitleOption.onclick = () => this.selectSubtitle('none');
        noSubtitleOption.innerHTML = `
            <span>No Subtitles</span>
            <span class="${state.selectedSubtitleId === 'none' ? 'text-blue-100' : 'text-slate-500'} text-[10px] uppercase">Off</span>
        `;
        subtitlesList.appendChild(noSubtitleOption);

        state.availableSubtitles.forEach(subtitle => {
            const subtitleOption = document.createElement('div');
            subtitleOption.className = getClasses(state.selectedSubtitleId === subtitle.filename);
            subtitleOption.onclick = () => this.selectSubtitle(subtitle.filename);
            subtitleOption.innerHTML = `
                <span class="truncate mr-2">${subtitle.label}</span>
                <span class="${state.selectedSubtitleId === subtitle.filename ? 'text-blue-100' : 'text-slate-500'} text-[10px] whitespace-nowrap">${subtitle.language}</span>
            `;
            subtitlesList.appendChild(subtitleOption);
        });

        const subtitleSection = document.getElementById('subtitleSection');
        if (subtitleSection) {
            if (state.availableSubtitles.length > 0) subtitleSection.classList.remove('hidden');
            else subtitleSection.classList.add('hidden');
        }
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