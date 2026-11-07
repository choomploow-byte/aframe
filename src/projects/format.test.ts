import { describe, expect, it } from 'vitest';
import { formatBytes, relativeTime } from './format';

const NOW = Date.parse('2026-11-07T12:00:00.000Z');
const ago = (ms: number): number => NOW - ms;

describe('relativeTime', () => {
  it('reads like a person would say it', () => {
    expect(relativeTime(ago(5_000), NOW)).toBe('just now');
    expect(relativeTime(ago(60_000), NOW)).toBe('1 minute ago');
    expect(relativeTime(ago(12 * 60_000), NOW)).toBe('12 minutes ago');
    expect(relativeTime(ago(3_600_000), NOW)).toBe('1 hour ago');
    expect(relativeTime(ago(5 * 3_600_000), NOW)).toBe('5 hours ago');
    expect(relativeTime(ago(26 * 3_600_000), NOW)).toBe('yesterday');
    expect(relativeTime(ago(4 * 86_400_000), NOW)).toBe('4 days ago');
  });

  it('never says something negative for a clock that is slightly ahead', () => {
    expect(relativeTime(NOW + 10_000, NOW)).toBe('just now');
  });

  it('falls back to a date after two weeks', () => {
    expect(relativeTime(ago(40 * 86_400_000), NOW)).toMatch(/\d{4}/);
  });
});

describe('formatBytes', () => {
  it('uses sensible units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(150 * 1024)).toBe('150 KB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });
});
