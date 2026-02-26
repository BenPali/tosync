import { state } from '../state.js';

const CODEC_MIME_MAP = {
    video: {
        h264: 'video/mp4; codecs="avc1.42E01E"',
        hevc: 'video/mp4; codecs="hvc1"',
        h265: 'video/mp4; codecs="hvc1"',
        vp9:  'video/webm; codecs="vp9"',
        av1:  'video/mp4; codecs="av01.0.01M.08"',
    },
    audio: {
        aac:    'audio/mp4; codecs="mp4a.40.2"',
        mp3:    'audio/mpeg',
        opus:   'audio/webm; codecs="opus"',
        vorbis: 'audio/webm; codecs="vorbis"',
        ac3:    'audio/mp4; codecs="ac-3"',
        eac3:   'audio/mp4; codecs="ec-3"',
        flac:   'audio/mp4; codecs="flac"',
    }
};

// Returns 'audio' | 'video' | 'both' | null (what needs transcoding)
export function checkCodecSupport(codecs) {
    const v = document.createElement('video');

    const videoMime = codecs.video ? CODEC_MIME_MAP.video[codecs.video.codec] || null : null;
    const audioMime = codecs.audio ? CODEC_MIME_MAP.audio[codecs.audio.codec] || null : null;

    // null MIME = unknown codec, assume unsupported
    const videoOk = !codecs.video || (videoMime !== null && v.canPlayType(videoMime) !== '');
    const audioOk = !codecs.audio || (audioMime !== null && v.canPlayType(audioMime) !== '');

    if (!videoOk && !audioOk) return 'both';
    if (!videoOk) return 'video';
    if (!audioOk) return 'audio';
    return null;
}

// Fetches codec info from /api/codecs, retrying if the file isn't ready yet
export async function fetchCodecs(params, maxRetries = 5) {
    const query = new URLSearchParams(params).toString();

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const res = await fetch(`/api/codecs?${query}`);
            if (!res.ok) return null;

            const data = await res.json();
            if (data.ready) return { video: data.video, audio: data.audio };

            await new Promise(r => setTimeout(r, 2000));
        } catch {
            return null;
        }
    }
    return null;
}

export function buildHlsUrl(params, needs) {
    const socketId = state.socket ? state.socket.id : '';
    const query = new URLSearchParams({ ...params, needs, socketId }).toString();
    return `/api/hls/master.m3u8?${query}`;
}

export function startHlsPlayback(hlsUrl) {
    destroyHls();

    if (typeof Hls === 'undefined' || !Hls.isSupported()) {
        console.error('HLS.js is not available or not supported');
        return false;
    }

    const hls = new Hls();
    state.hlsInstance = hls;
    hls.loadSource(hlsUrl);
    hls.attachMedia(state.videoPlayer);

    hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
            console.error('[HLS] Fatal error:', data.type, data.details);
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                hls.startLoad();
            } else {
                hls.destroy();
            }
        }
    });

    return true;
}

export function destroyHls() {
    if (state.hlsInstance) {
        state.hlsInstance.destroy();
        state.hlsInstance = null;
    }
}
