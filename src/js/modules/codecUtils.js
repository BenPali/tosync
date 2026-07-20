import { state } from '../state.js';

const CODEC_MIME_MAP = {
    video: {
        h264: 'video/mp4; codecs="avc1.42E01E"',
        hevc: 'video/mp4; codecs="hvc1"',
        h265: 'video/mp4; codecs="hvc1"',
        vp9: 'video/webm; codecs="vp9"',
        av1: 'video/mp4; codecs="av01.0.01M.08"'
    },
    audio: {
        aac: 'audio/mp4; codecs="mp4a.40.2"',
        mp3: 'audio/mpeg',
        opus: 'audio/webm; codecs="opus"',
        vorbis: 'audio/webm; codecs="vorbis"',
        ac3: 'audio/mp4; codecs="ac-3"',
        eac3: 'audio/mp4; codecs="ec-3"',
        flac: 'audio/mp4; codecs="flac"'
    }
};

// Returns 'audio' | 'video' | 'both' | null (what needs transcoding)
// Uses canPlayType — checks native <video> element support for direct streaming
export function checkCodecSupport(codecs) {
    const videoMime = codecs.video ? CODEC_MIME_MAP.video[codecs.video.codec] || null : null;
    const audioMime = codecs.audio ? CODEC_MIME_MAP.audio[codecs.audio.codec] || null : null;

    const v = document.createElement('video');
    const checkSupport = (mime) => {
        if (!mime) return true; // Codec not in map — try direct playback
        return v.canPlayType(mime) !== '';
    };

    const videoOk = !codecs.video || checkSupport(videoMime);
    const audioOk = !codecs.audio || checkSupport(audioMime);

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

            await new Promise((r) => setTimeout(r, 1000));
        } catch {
            return null;
        }
    }
    return null;
}

export function buildHlsUrl(params, needs) {
    const query = new URLSearchParams({ ...params, needs }).toString();
    return `/api/hls/master.m3u8?${query}`;
}

export function startHlsPlayback(hlsUrl) {
    destroyHls();

    if (typeof Hls === 'undefined' || !Hls.isSupported()) {
        console.error('HLS.js is not available or not supported');
        return false;
    }

    // startPosition 0: an in-progress transcode is an EVENT playlist with no
    // ENDLIST, which hls.js classifies as live and would otherwise seek to the
    // live edge on start — a programmatic seek our echo-suppression doesn't
    // know about, broadcast to the room as a phantom user seek. Everyone starts
    // at 0; late joiners are moved by the restore/force-sync path.
    const hls = new Hls({ startPosition: 0 });
    state.hlsInstance = hls;
    hls.loadSource(hlsUrl);
    hls.attachMedia(state.videoPlayer);

    hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
            console.error('[HLS] Fatal error:', data.type, data.details);
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                hls.startLoad();
            } else {
                destroyHls();
            }
        }
    });

    // Keepalive ping every 30s so the server doesn't GC the session while paused
    const keepaliveUrl = hlsUrl.replace('/api/hls/master.m3u8', '/api/hls/keepalive');
    state.hlsKeepalive = setInterval(() => {
        fetch(keepaliveUrl, { method: 'POST' }).catch(() => {});
    }, 30000);

    return true;
}

export function destroyHls() {
    if (state.hlsKeepalive) {
        clearInterval(state.hlsKeepalive);
        state.hlsKeepalive = null;
    }
    if (state.hlsInstance) {
        state.hlsInstance.destroy();
        state.hlsInstance = null;
    }
}

// Tear down BOTH streaming players (HLS + mpegts/IPTV). Call on every media
// switch: otherwise a previous IPTV player keeps pulling its relay in the
// background and its ended/error handlers re-attach to the newly-loaded media
// (bandwidth leak + playback hijack). Idempotent.
export function teardownPlayers() {
    destroyHls();
    if (state.mpegtsPlayer) {
        try {
            state.mpegtsPlayer.destroy();
        } catch (e) {
            // player may already be torn down; nothing to do
        }
        state.mpegtsPlayer = null;
    }
}
