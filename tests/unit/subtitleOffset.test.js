import { describe, it, expect } from 'vitest';
import {
    clampOffset,
    shiftCueTimes,
    formatOffset,
    SUBTITLE_OFFSET_MIN,
    SUBTITLE_OFFSET_MAX,
} from '../../src/js/modules/subtitleOffset.js';

describe('clampOffset', () => {
    it('passes through in-range values', () => {
        expect(clampOffset(0)).toBe(0);
        expect(clampOffset(1.5)).toBe(1.5);
        expect(clampOffset(-2.5)).toBe(-2.5);
    });
    it('clamps to the supported range', () => {
        expect(clampOffset(999)).toBe(SUBTITLE_OFFSET_MAX);
        expect(clampOffset(-999)).toBe(SUBTITLE_OFFSET_MIN);
    });
    it('coerces non-finite / junk to 0', () => {
        expect(clampOffset(NaN)).toBe(0);
        expect(clampOffset(undefined)).toBe(0);
        expect(clampOffset('abc')).toBe(0);
        expect(clampOffset(Infinity)).toBe(0);
        expect(clampOffset(null)).toBe(0);
    });
    it('parses numeric strings', () => {
        expect(clampOffset('1.5')).toBe(1.5);
    });
});

describe('shiftCueTimes', () => {
    it('shifts both bounds by a positive delta', () => {
        expect(shiftCueTimes(2, 4, 1)).toEqual({ startTime: 3, endTime: 5 });
    });
    it('shifts both bounds by a negative delta', () => {
        expect(shiftCueTimes(2, 4, -0.5)).toEqual({ startTime: 1.5, endTime: 3.5 });
    });
    it('never lets start go below 0', () => {
        const r = shiftCueTimes(1, 3, -5);
        expect(r.startTime).toBe(0);
        expect(r.endTime).toBeGreaterThan(0);
    });
    it('preserves a minimum positive duration when clamped', () => {
        const r = shiftCueTimes(0.5, 0.6, -5);
        expect(r.startTime).toBe(0);
        expect(r.endTime).toBeGreaterThanOrEqual(r.startTime + 0.05);
    });
    it('is reversible for in-range shifts (no drift)', () => {
        const once = shiftCueTimes(10, 12, 1.5);
        const back = shiftCueTimes(once.startTime, once.endTime, -1.5);
        expect(back).toEqual({ startTime: 10, endTime: 12 });
    });
});

describe('formatOffset', () => {
    it('formats zero', () => {
        expect(formatOffset(0)).toBe('0.0s');
    });
    it('prefixes a plus for positive values', () => {
        expect(formatOffset(1)).toBe('+1.0s');
        expect(formatOffset(0.5)).toBe('+0.5s');
    });
    it('keeps the minus for negative values', () => {
        expect(formatOffset(-0.5)).toBe('-0.5s');
    });
    it('rounds to one decimal', () => {
        expect(formatOffset(1.234)).toBe('+1.2s');
    });
    it('treats junk as zero', () => {
        expect(formatOffset(undefined)).toBe('0.0s');
        expect(formatOffset(NaN)).toBe('0.0s');
    });
});
