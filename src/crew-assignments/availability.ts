import { AssignmentStatus } from '@prisma/client';

/** A half-open time interval. `end` may be null when only a start is known. */
export interface Window {
  start: Date;
  end: Date | null;
}

export type AvailabilityStatus = 'AVAILABLE' | 'TENTATIVE' | 'BUSY' | 'UNKNOWN';

/**
 * One clashing assignment, deliberately thin.
 *
 * A studio checking whether an outside creative is free must not learn who
 * else is hiring them: `title` and `studioName` are filled in only when the
 * clashing booking belongs to the studio doing the asking.
 */
export interface Conflict {
  /**
   * ISO instants, not wall-clock strings. The server cannot know the viewer's
   * timezone, so formatting is the client's job - returning "09:00" here would
   * show a US studio the UTC hour rather than the hour they booked.
   */
  startAt: string;
  endAt: string | null;
  status: AssignmentStatus;
  isOwnStudio: boolean;
  title: string | null;
  studioName: string | null;
}

/**
 * Derives the time span a booking occupies.
 *
 * Event parts carry the real schedule; `eventDate` is the fallback for
 * bookings that have not been broken into parts yet, and covers the whole day
 * so a same-day clash is still caught.
 */
export function bookingWindow(booking: {
  eventDate: Date | null;
  eventParts: { startAt: Date | null; endAt: Date | null }[];
}): Window | null {
  const starts = booking.eventParts
    .map((p) => p.startAt)
    .filter((d): d is Date => !!d);

  if (starts.length) {
    const ends = booking.eventParts.map((p) => p.endAt).filter((d): d is Date => !!d);
    return {
      start: new Date(Math.min(...starts.map((d) => d.getTime()))),
      end: ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null,
    };
  }

  if (booking.eventDate) {
    const start = new Date(booking.eventDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  return null;
}

/** Treats a window with no end as lasting an hour, so it can still clash. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

function endOf(window: Window): number {
  return (window.end ?? new Date(window.start.getTime() + DEFAULT_DURATION_MS)).getTime();
}

export function overlaps(a: Window, b: Window): boolean {
  return a.start.getTime() < endOf(b) && b.start.getTime() < endOf(a);
}

/** A declined assignment frees the slot; everything else occupies it. */
export function blocksTime(status: AssignmentStatus): boolean {
  return status !== AssignmentStatus.DECLINED;
}

/**
 * CONFIRMED or COMPLETED work is a hard clash. An invitation the creative has
 * not answered yet is only a maybe, so it downgrades to TENTATIVE rather than
 * blocking the studio from inviting them anyway.
 */
export function summarize(conflicts: Conflict[], hasWindow: boolean): AvailabilityStatus {
  if (!hasWindow) return 'UNKNOWN';
  if (!conflicts.length) return 'AVAILABLE';
  const hard = conflicts.some(
    (c) =>
      c.status === AssignmentStatus.CONFIRMED || c.status === AssignmentStatus.COMPLETED,
  );
  return hard ? 'BUSY' : 'TENTATIVE';
}

export function toIso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}
