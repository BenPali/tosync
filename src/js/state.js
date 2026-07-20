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
    userName: 'Anonymous',

    // Video player
    videoPlayer: null,
    isReceivingSync: false,
    lastSyncTime: 0,
    // Trailing-edge throttle for outbound video actions: the latest action
    // deferred while inside the throttle window, plus its timer handle. Ensures
    // the room always converges to the user's final action — a pause-then-play
    // inside the window no longer leaves the room stuck paused.
    pendingSyncAction: null,
    pendingSyncTimer: null,
    // Landing positions of programmatic (sync/restore/force-sync) seeks whose
    // `seeked` echo must NOT be re-broadcast. A queue matched by position, not a
    // counter: the browser aborts an in-flight seek WITHOUT firing its `seeked`
    // when a newer seek supersedes it, so a blind counter over-counts and then
    // silently eats real user seeks (see handleSeeked for the matching rules).
    pendingSeekTargets: [],
    // Playhead as of the last `timeupdate` — where playback actually was before
    // any in-progress seek started.
    lastPlayheadPosition: 0,
    // lastPlayheadPosition captured when a seek GESTURE starts (`seeking`, with
    // no other seek completed in the previous 500ms). The size of a finished
    // seek's jump is measured against this; sub-tolerance jumps (hls.js
    // gap-nudges, micro-scrubs) are not worth broadcasting. Gesture-anchored so
    // a slow continuous drag measures total displacement, not per-step
    // increments that would each duck under the tolerance.
    seekOriginPosition: 0,
    // When the last `seeked` fired — chains seeks into gestures (see above).
    lastSeekedAt: 0,
    // Timer handle for clearing isReceivingSync. Shared so overlapping incoming
    // syncs extend the suppression window instead of the first sync's timer
    // clearing the flag early for the second.
    receivingSyncTimer: null,

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
    subtitleOffset: 0, // timing offset in seconds (room-synced, + = subtitles later)

    // File library
    currentLibrary: null
};
