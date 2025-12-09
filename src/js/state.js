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
    torrentProgressInterval: null,
    lastMediaAction: null,
    hlsInstance: null,
    mpegtsPlayer: null,

    // Subtitles
    availableSubtitles: [],
    selectedSubtitleId: null,

    // File library
    currentLibrary: null
};