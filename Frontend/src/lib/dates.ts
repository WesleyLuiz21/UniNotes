import { format, formatDistanceToNowStrict, isToday, isYesterday, parseISO } from 'date-fns';

/** Lecture dates are date-only strings; parse them as local calendar dates (no timezone shift). */
export const parseDateOnly = (value: string) => parseISO(value);
export const toDateOnly = (d: Date) => format(d, 'yyyy-MM-dd');
export const todayDateOnly = () => toDateOnly(new Date());

export function formatLectureDate(value: string, style: 'short' | 'long' = 'short') {
  const d = parseDateOnly(value);
  if (style === 'long') return format(d, 'EEEE d MMMM yyyy');
  return format(d, 'd MMM yyyy');
}

/** Relative time for UTC timestamps (e.g. "5 minutes ago"). */
export function formatRelative(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 45_000) return 'just now';
  if (isToday(d) || diff < 86_400_000) return `${formatDistanceToNowStrict(d)} ago`;
  if (isYesterday(d)) return `yesterday at ${format(d, 'HH:mm')}`;
  return format(d, 'd MMM yyyy, HH:mm');
}

export const formatDateTime = (iso: string) => format(new Date(iso), 'd MMM yyyy, HH:mm');

/** Academic year label for a date, e.g. 2025/26 (UK-style years starting in September). */
export function academicYearFor(d = new Date()) {
  const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
}
