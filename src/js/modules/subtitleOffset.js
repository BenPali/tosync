// Pure helpers for the subtitle timing-offset feature. Kept dependency-free so
// they can be unit-tested without a DOM (see tests/unit/subtitleOffset.test.js).

export const SUBTITLE_OFFSET_MIN = -60;
export const SUBTITLE_OFFSET_MAX = 60;

// Clamp a desired offset (seconds) to the supported range; non-numbers → 0.
export function clampOffset(offset) {
    const n = Number(offset);
    if (!Number.isFinite(n)) return 0;
    return Math.max(SUBTITLE_OFFSET_MIN, Math.min(SUBTITLE_OFFSET_MAX, n));
}

// Shift a single cue's [start, end] by delta seconds. Start never goes below 0,
// and a minimum positive duration is preserved so the cue stays valid.
export function shiftCueTimes(startTime, endTime, delta) {
    const start = Math.max(0, startTime + delta);
    const end = Math.max(start + 0.05, endTime + delta);
    return { startTime: start, endTime: end };
}

// Human-readable readout: 0 → "0.0s", 1.5 → "+1.5s", -0.5 → "-0.5s".
export function formatOffset(offset) {
    const o = Number(offset) || 0;
    return (o > 0 ? '+' : '') + o.toFixed(1) + 's';
}
