import { describe, expect, it } from 'vitest';
import { formatLectureDate } from './dates';

describe('formatLectureDate', () => {
  it('formats date-only strings without a timezone shift', () => {
    expect(formatLectureDate('2023-10-31')).toBe('31 Oct 2023');
    expect(formatLectureDate('2023-10-31', 'long')).toBe('Tuesday 31 October 2023');
  });

  it('labels missing dates as Undated', () => {
    expect(formatLectureDate(null)).toBe('Undated');
    expect(formatLectureDate(null, 'long')).toBe('Undated');
  });
});
