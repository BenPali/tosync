// state.js - Global application state

export const state = {
    // Socket connection
    socket: null,
    isConnected: false,

    // Room management
    currentRoomId: null,
    isRoomCreator: false,

    // User info
    userRole: null,
    userName: "Anonymous",

    // Video player
    videoPlayer: null,
    isReceivingSync: false,
    lastSyncTime: 0,

    // Media
    currentTorrentInfo: null,
    // Aborts any pending listeners tied to the current media (e.g. deferred
    // force-sync). Replaced on every media change so stale events can't fire
    // against a newly-loaded video.
    mediaLoadAbort: null,
    torrentProgressInterval: null,
    lastMediaAction: null,
    hlsInstance: null,
    hlsKeepalive: null,
    mpegtsPlayer: null,
    isLiveStream: false,

    // Subtitles
    availableSubtitles: [],
    selectedSubtitleId: null,

    // File library
    currentLibrary: null
};