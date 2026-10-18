import { defineDurableState } from 'void/durable';

/**
 * Global fame registry.
 *
 * Fame belongs to a player's *connection IP*, not to their per-browser client id:
 * the same person rejoining with a fresh browser still keeps the fame they were
 * given. Because the channel room is one Durable Object per channel, this has to
 * live in its own singleton object so the count is shared across every channel.
 */

/** One week: how long an IP must wait before it can hand out fame again. */
export const FAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_REPORTS = 200;

export interface ReportedMessage {
  at: number;
  text: string;
}

export interface FameReport {
  id: string;
  at: number;
  reporterId: string;
  reporterName: string;
  reporterIp: string;
  targetId: string;
  targetName: string;
  targetIp: string;
  reason: string;
  /** The reported player's fame total at the time of the report. */
  targetFame: number;
  /** The reported player's most recent chat lines, captured with the report. */
  recentMessages: ReportedMessage[];
}

/** A moderated IP: blocked from connecting to any channel. */
export interface FameBan {
  ip: string;
  reason: string;
  /** How the ban was made; the admin panel labels it "admin". */
  by: string;
  at: number;
}

export interface FameState {
  /** Connection IP -> total fame received. */
  counts: Record<string, number>;
  /** Connection IP -> timestamp of the last fame it handed out. */
  lastGivenAt: Record<string, number>;
  /** Most recent player reports, newest last. */
  reports: FameReport[];
  /** Banned connection IP -> ban details. */
  bans: Record<string, FameBan>;
}

/**
 * `bans` was added after the first deploy, so an already-stored object may not
 * have it yet. Normalize on access instead of migrating the persisted shape.
 */
function bansOf(state: FameState): Record<string, FameBan> {
  if (!state.bans) state.bans = {};
  return state.bans;
}

export type FameFailureReason = 'unknown-player' | 'self' | 'cooldown';

/** Fame can be moved either way; the running total is a signed integer. */
export type FameDirection = 'up' | 'down';

export type FameResult =
  | { ok: true; fame: number; nextAt: number }
  | { ok: false; reason: FameFailureReason; fame: number; nextAt: number };

export type FameStatus = { fame: number; canFame: boolean; nextAt: number };

function statusFor(
  state: FameState,
  giverIp: string,
  targetIp: string,
  now: number,
): FameStatus {
  const fame = state.counts[targetIp] ?? 0;
  if (!giverIp || !targetIp || giverIp === targetIp) {
    return { fame, canFame: false, nextAt: 0 };
  }
  const nextAt = (state.lastGivenAt[giverIp] ?? 0) + FAME_COOLDOWN_MS;
  return { fame, canFame: now >= nextAt, nextAt };
}

export const Fame = defineDurableState({
  name: 'fame-registry',
  initialState: (): FameState => ({
    counts: {},
    lastGivenAt: {},
    reports: [],
    bans: {},
  }),
  methods: {
    /** Fame total and this IP's eligibility, for the player-info window. */
    status(context, giverIp: string, targetIp: string, now: number): FameStatus {
      return statusFor(context.state, giverIp, targetIp, now);
    },

    /**
     * Move a player's fame by `direction`. A giver IP may only fame once every
     * `FAME_COOLDOWN_MS` (up or down), and never itself.
     */
    fame(
      context,
      giverIp: string,
      targetIp: string,
      direction: FameDirection,
      now: number,
    ): FameResult {
      if (!targetIp || !giverIp) {
        return { ok: false, reason: 'unknown-player', fame: 0, nextAt: 0 };
      }
      if (giverIp === targetIp) {
        return {
          ok: false,
          reason: 'self',
          fame: context.state.counts[targetIp] ?? 0,
          nextAt: 0,
        };
      }

      const nextAt = (context.state.lastGivenAt[giverIp] ?? 0) + FAME_COOLDOWN_MS;
      if (now < nextAt) {
        return {
          ok: false,
          reason: 'cooldown',
          fame: context.state.counts[targetIp] ?? 0,
          nextAt,
        };
      }

      const fame =
        (context.state.counts[targetIp] ?? 0) + (direction === 'down' ? -1 : 1);
      context.state.counts[targetIp] = fame;
      context.state.lastGivenAt[giverIp] = now;
      return { ok: true, fame, nextAt: now + FAME_COOLDOWN_MS };
    },

    report(context, entry: FameReport): { ok: true } {
      context.state.reports.push(entry);
      if (context.state.reports.length > MAX_REPORTS) {
        context.state.reports.splice(
          0,
          context.state.reports.length - MAX_REPORTS,
        );
      }
      return { ok: true };
    },

    /** Newest reports first, for the moderation panel. */
    listReports(context, limit: number): FameReport[] {
      return context.state.reports.slice(-Math.max(0, limit)).reverse();
    },

    clearReports(context): { ok: true } {
      context.state.reports = [];
      return { ok: true };
    },

    /** Newest bans first. */
    listBans(context): FameBan[] {
      return Object.values(bansOf(context.state)).sort((a, b) => b.at - a.at);
    },

    ban(context, ip: string, reason: string, by: string, now: number): FameBan {
      const entry: FameBan = { ip, reason, by, at: now };
      bansOf(context.state)[ip] = entry;
      return entry;
    },

    unban(context, ip: string): boolean {
      const bans = bansOf(context.state);
      if (!bans[ip]) return false;
      delete bans[ip];
      return true;
    },

    /** Whether an IP is blocked from connecting. */
    isBanned(context, ip: string): boolean {
      if (!ip) return false;
      return Boolean(bansOf(context.state)[ip]);
    },

    /** Fame total for an IP, independent of who is asking. */
    fameOf(context, ip: string): number {
      if (!ip) return 0;
      return context.state.counts[ip] ?? 0;
    },
  },
});

export default Fame;
