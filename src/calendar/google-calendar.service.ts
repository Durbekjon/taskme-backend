import { Injectable, Logger } from '@nestjs/common';
import { AssignmentStatus, BookingStatus, Prisma } from '@prisma/client';
import { google, type calendar_v3 } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service';
import { env } from '../config/env';

export interface ExternalEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
}

/** One Google event we want to exist for a (user, booking) pair. */
interface DesiredEvent {
  key: string; // stable within a booking: "part:<sortOrder>" or "day"
  body: calendar_v3.Schema$Event;
}

const TAG_BOOKING = 'taskmeBookingId';
const TAG_KEY = 'taskmeKey';

const BOOKING_FOR_SYNC = {
  id: true,
  title: true,
  eventType: true,
  eventDate: true,
  location: true,
  status: true,
  managerId: true,
  studioId: true,
  studio: { select: { name: true, timezone: true } },
  eventParts: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      sortOrder: true,
      partType: true,
      customName: true,
      startAt: true,
      endAt: true,
      venueName: true,
      address: true,
      city: true,
    },
  },
  assignments: {
    select: {
      status: true,
      role: true,
      callTime: true,
      worker: { select: { userId: true } },
      assignedParts: { select: { eventPartId: true } },
    },
  },
} satisfies Prisma.BookingSelect;

/**
 * Keeps Google Calendar in step with Task.me bookings.
 *
 *  - Studio side: every booking appears in the calendars of the studio's
 *    owners and the booking's manager — one event per event part (or one
 *    all‑day event when the booking only has a date).
 *  - Crew side: as soon as a creative is assigned to a booking, the parts
 *    they are on appear in their calendar ("Pending" until they accept);
 *    declining or being removed takes them away again.
 *
 * Event parts are recreated on every booking edit, so we never store Google
 * event ids. Each event carries private extended properties (booking id +
 * a stable key), and `syncBooking` reconciles: list what is there, then
 * insert / patch / delete to match what should be there. It is idempotent
 * and safe to call after any change.
 *
 * Everything here is best effort: Google being down or a revoked grant must
 * never fail the booking or assignment request that triggered it.
 */
@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(private readonly prisma: PrismaService) {}

  /* ── Auth ─────────────────────────────────────────────────────── */

  private async clientFor(
    userId: string,
  ): Promise<calendar_v3.Calendar | null> {
    if (!env.googleOAuthEnabled) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { googleAccessToken: true, googleRefreshToken: true },
    });
    if (!user?.googleRefreshToken && !user?.googleAccessToken) return null;

    const auth = new google.auth.OAuth2(
      env.googleClientId,
      env.googleClientSecret,
      env.googleCallbackUrl,
    );
    auth.setCredentials({
      access_token: user.googleAccessToken ?? undefined,
      refresh_token: user.googleRefreshToken ?? undefined,
    });
    // Keep the freshest access token so the next call can skip a refresh.
    auth.on('tokens', (t) => {
      if (!t.access_token) return;
      this.prisma.user
        .update({
          where: { id: userId },
          data: {
            googleAccessToken: t.access_token,
            ...(t.refresh_token ? { googleRefreshToken: t.refresh_token } : {}),
          },
        })
        .catch((e) => this.logger.warn(`token save failed: ${String(e)}`));
    });
    return google.calendar({ version: 'v3', auth });
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { googleRefreshToken: true, googleAccessToken: true },
    });
    return {
      available: env.googleOAuthEnabled,
      connected: !!(user?.googleRefreshToken || user?.googleAccessToken),
    };
  }

  /* ── Pull ─────────────────────────────────────────────────────── */

  /** The user's own events between two instants, primary calendar only. */
  async listEvents(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<ExternalEvent[]> {
    const cal = await this.clientFor(userId);
    if (!cal) return [];
    const res = await cal.events.list({
      calendarId: 'primary',
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });
    return (
      (res.data.items ?? [])
        .filter((e) => e.status !== 'cancelled' && e.start)
        // Hide events we created ourselves; Task.me already shows those.
        .filter((e) => !e.extendedProperties?.private?.[TAG_BOOKING])
        .map((e) => ({
          id: e.id!,
          title: e.summary ?? '(busy)',
          startAt: new Date(
            e.start!.dateTime ?? `${e.start!.date}T00:00:00`,
          ).toISOString(),
          endAt: e.end
            ? new Date(e.end.dateTime ?? `${e.end.date}T00:00:00`).toISOString()
            : null,
          allDay: !e.start!.dateTime,
        }))
    );
  }

  /* ── Push ─────────────────────────────────────────────────────── */

  /**
   * Bring every affected calendar in line with the booking's current state.
   *
   * `alsoUserIds` covers people who were just taken off the booking (deleted
   * assignment) and so no longer show up when we read it back.
   */
  async syncBooking(
    bookingId: string,
    alsoUserIds: string[] = [],
  ): Promise<void> {
    try {
      const booking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
        select: BOOKING_FOR_SYNC,
      });
      const plan = new Map<string, DesiredEvent[]>();
      for (const id of alsoUserIds) plan.set(id, []);

      if (booking) {
        for (const id of await this.studioCalendarOwners(
          booking.studioId,
          booking.managerId,
        )) {
          plan.set(id, this.studioEvents(booking));
        }
        for (const a of booking.assignments) {
          const uid = a.worker.userId;
          const events = this.crewEvents(booking, a);
          // Someone can be both studio owner and crew; crew view wins.
          plan.set(uid, events);
        }
      }

      await Promise.all(
        [...plan].map(([userId, desired]) =>
          this.reconcile(userId, bookingId, desired),
        ),
      );
    } catch (e) {
      this.logger.warn(
        `syncBooking(${bookingId}) failed: ${(e as Error).message}`,
      );
    }
  }

  /**
   * A booking is about to be deleted: remember whose calendars hold it so
   * `clearBooking` can clean them once the row is gone.
   */
  async calendarUsersFor(bookingId: string): Promise<string[]> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        studioId: true,
        managerId: true,
        assignments: { select: { worker: { select: { userId: true } } } },
      },
    });
    if (!booking) return [];
    const owners = await this.studioCalendarOwners(
      booking.studioId,
      booking.managerId,
    );
    return [
      ...new Set([
        ...owners,
        ...booking.assignments.map((a) => a.worker.userId),
      ]),
    ];
  }

  async clearBooking(bookingId: string, userIds: string[]): Promise<void> {
    await Promise.all(
      userIds.map((u) =>
        this.reconcile(u, bookingId, []).catch((e: Error) =>
          this.logger.warn(
            `clearBooking(${bookingId}, ${u}) failed: ${e.message}`,
          ),
        ),
      ),
    );
  }

  private async studioCalendarOwners(
    studioId: string,
    managerId: string | null,
  ) {
    const owners = await this.prisma.studioMember.findMany({
      where: { studioId, role: 'OWNER', status: 'ACTIVE' },
      select: { userId: true },
    });
    const ids = new Set(owners.map((o) => o.userId));
    if (managerId) ids.add(managerId);
    return [...ids];
  }

  private studioEvents(b: SyncBooking): DesiredEvent[] {
    if (b.status === BookingStatus.CANCELLED) return [];
    const title = b.title ?? b.eventType ?? 'Booking';
    return this.eventsFor(b, b.eventParts, (partName) => ({
      summary: partName ? `${title} · ${partName}` : title,
      description: `Booking in Task.me${b.status === BookingStatus.DRAFT ? ' (draft)' : ''}`,
      status: b.status === BookingStatus.DRAFT ? 'tentative' : 'confirmed',
    }));
  }

  private crewEvents(
    b: SyncBooking,
    a: SyncBooking['assignments'][number],
  ): DesiredEvent[] {
    if (b.status === BookingStatus.CANCELLED) return [];
    if (a.status === AssignmentStatus.DECLINED) return [];
    const onParts = a.assignedParts.length
      ? b.eventParts.filter((p) =>
          a.assignedParts.some((ap) => ap.eventPartId === p.id),
        )
      : b.eventParts;
    const pending = a.status === AssignmentStatus.ASSIGNED;
    const title = b.title ?? b.eventType ?? 'Booking';
    return this.eventsFor(b, onParts, (partName) => ({
      summary: `${pending ? '[Pending] ' : ''}${title}${partName ? ` · ${partName}` : ''}${
        a.role ? ` (${a.role})` : ''
      }`,
      description: [
        b.studio?.name ? `Studio: ${b.studio.name}` : null,
        a.callTime ? `Call time: ${a.callTime.toISOString()}` : null,
        pending
          ? 'Invitation pending — accept it in Task.me'
          : 'Confirmed in Task.me',
      ]
        .filter(Boolean)
        .join('\n'),
      status: pending ? 'tentative' : 'confirmed',
    }));
  }

  /** One event per timed part; a single all‑day event when there are none. */
  private eventsFor(
    b: SyncBooking,
    parts: SyncBooking['eventParts'],
    describe: (
      partName: string | null,
    ) => Pick<calendar_v3.Schema$Event, 'summary' | 'description' | 'status'>,
  ): DesiredEvent[] {
    const tz = b.studio?.timezone ?? undefined;
    const timed = parts.filter((p) => p.startAt);
    const named = (p: SyncBooking['eventParts'][number]) =>
      p.customName ?? p.partType ?? null;
    const where = (p?: SyncBooking['eventParts'][number]) =>
      [p?.venueName, p?.address, p?.city].filter(Boolean).join(', ') ||
      b.location ||
      undefined;

    if (timed.length) {
      return timed.map((p) => {
        const start = p.startAt!;
        const end =
          p.endAt && p.endAt > start
            ? p.endAt
            : new Date(start.getTime() + 3600_000);
        return {
          key: `part:${p.sortOrder}`,
          body: {
            ...describe(timed.length > 1 ? named(p) : null),
            location: where(p),
            start: { dateTime: start.toISOString(), timeZone: tz },
            end: { dateTime: end.toISOString(), timeZone: tz },
          },
        };
      });
    }

    if (b.eventDate) {
      const day = b.eventDate.toISOString().slice(0, 10);
      const next = new Date(b.eventDate.getTime() + 86_400_000)
        .toISOString()
        .slice(0, 10);
      return [
        {
          key: 'day',
          body: {
            ...describe(null),
            location: where(parts[0]),
            start: { date: day },
            end: { date: next },
          },
        },
      ];
    }
    return [];
  }

  private async reconcile(
    userId: string,
    bookingId: string,
    desired: DesiredEvent[],
  ) {
    const cal = await this.clientFor(userId);
    if (!cal) return;

    const existing = await cal.events.list({
      calendarId: 'primary',
      privateExtendedProperty: [`${TAG_BOOKING}=${bookingId}`],
      maxResults: 100,
      showDeleted: false,
    });
    const byKey = new Map<string, calendar_v3.Schema$Event>();
    const extras: string[] = [];
    for (const e of existing.data.items ?? []) {
      const key = e.extendedProperties?.private?.[TAG_KEY];
      if (key && !byKey.has(key)) byKey.set(key, e);
      else if (e.id) extras.push(e.id); // duplicates or untagged leftovers
    }

    for (const d of desired) {
      const requestBody: calendar_v3.Schema$Event = {
        ...d.body,
        extendedProperties: {
          private: { [TAG_BOOKING]: bookingId, [TAG_KEY]: d.key },
        },
      };
      const current = byKey.get(d.key);
      byKey.delete(d.key);
      if (current?.id) {
        await cal.events.patch({
          calendarId: 'primary',
          eventId: current.id,
          requestBody,
        });
      } else {
        await cal.events.insert({ calendarId: 'primary', requestBody });
      }
    }

    const stale = [...[...byKey.values()].map((e) => e.id!), ...extras];
    for (const id of stale) {
      await cal.events
        .delete({ calendarId: 'primary', eventId: id })
        .catch((e: { code?: number }) => {
          if (e.code !== 404 && e.code !== 410) throw e;
        });
    }
  }

  /* ── Disconnect ───────────────────────────────────────────────── */

  /** Revoke Google's grant and forget the tokens. */
  async disconnect(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { googleRefreshToken: true, googleAccessToken: true },
    });
    const token = user?.googleRefreshToken ?? user?.googleAccessToken;
    if (token) {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      ).catch((e) => this.logger.warn(`revoke failed: ${String(e)}`));
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        googleAccessToken: null,
        googleRefreshToken: null,
        calendarSyncToken: null,
      },
    });
    return { connected: false };
  }
}

type SyncBooking = Prisma.BookingGetPayload<{
  select: typeof BOOKING_FOR_SYNC;
}>;
