import * as v from 'valibot';
import { defineRoom } from 'void/ws';
import { Fame } from '../../durable-objects/fame';
import type {
  CharacterAction,
  CharacterEmotion,
  ChatMessage,
  MapleSimCharacter,
  PlayerState,
} from '../../src/types/maple';

const CharacterActionSchema = v.picklist([
  'stand1',
  'stand2',
  'walk1',
  'walk2',
  'jump',
  'prone',
  'ladder',
  'rope',
  'sit',
  'alert',
]);

const CharacterEmotionSchema = v.picklist([
  'default',
  'hit',
  'smile',
  'troubled',
  'cry',
  'angry',
  'bewildered',
  'stunned',
  'blaze',
  'blink',
  'bowing',
  'cheers',
  'chu',
  'dam',
  'despair',
  'glitter',
  'hot',
  'hum',
  'love',
  'oops',
  'pain',
  'qBlue',
  'shine',
  'vomit',
  'wink',
]);

const CharacterSchema = v.object({
  id: v.number(),
  type: v.literal('character'),
  action: v.string(),
  emotion: v.string(),
  skin: v.number(),
  zoom: v.number(),
  frame: v.number(),
  mercEars: v.boolean(),
  illiumEars: v.boolean(),
  highFloraEars: v.optional(v.boolean()),
  selectedItems: v.record(v.string(), v.any()),
  visible: v.boolean(),
  position: v.object({
    x: v.number(),
    y: v.number(),
  }),
  fhSnap: v.boolean(),
  flipX: v.boolean(),
  name: v.string(),
  includeBackground: v.boolean(),
});

const PlayerStateSchema = v.object({
  id: v.string(),
  name: v.string(),
  character: CharacterSchema,
  x: v.number(),
  y: v.number(),
  vx: v.number(),
  vy: v.number(),
  action: CharacterActionSchema,
  emotion: CharacterEmotionSchema,
  flipX: v.boolean(),
  footholdId: v.nullable(v.number()),
  updatedAt: v.number(),
});

const ChatMessageSchema = v.object({
  id: v.string(),
  userId: v.string(),
  userName: v.string(),
  text: v.string(),
  timestamp: v.number(),
  system: v.optional(v.boolean()),
});

const ClientMessage = v.variant('type', [
  v.object({
    type: v.literal('player.join'),
    // Stable per-browser identity so a second tab is the same player instead of a
    // duplicate character. Optional: older cached clients fall back to their
    // connection id and simply behave like they used to.
    clientId: v.optional(v.pipe(v.string(), v.minLength(8), v.maxLength(64))),
    name: v.string(),
    character: CharacterSchema,
    x: v.number(),
    y: v.number(),
    action: CharacterActionSchema,
    emotion: CharacterEmotionSchema,
    flipX: v.boolean(),
    footholdId: v.nullable(v.number()),
  }),
  v.object({
    type: v.literal('player.move'),
    x: v.number(),
    y: v.number(),
    vx: v.number(),
    vy: v.number(),
    action: CharacterActionSchema,
    flipX: v.boolean(),
    footholdId: v.nullable(v.number()),
  }),
  v.object({
    type: v.literal('player.emote'),
    emotion: CharacterEmotionSchema,
  }),
  v.object({
    type: v.literal('player.update'),
    name: v.string(),
    character: CharacterSchema,
  }),
  v.object({
    type: v.literal('chat.message'),
    text: v.pipe(v.string(), v.minLength(1), v.maxLength(240)),
  }),
  v.object({
    type: v.literal('player.fame.query'),
    id: v.string(),
  }),
  v.object({
    type: v.literal('player.fame.give'),
    id: v.string(),
    direction: v.picklist(['up', 'down']),
  }),
  v.object({
    type: v.literal('player.report'),
    id: v.string(),
    reason: v.optional(v.pipe(v.string(), v.maxLength(200))),
  }),
]);

const ServerMessage = v.variant('type', [
  v.object({
    type: v.literal('channel.init'),
    selfId: v.string(),
    channel: v.string(),
    players: v.array(PlayerStateSchema),
    messages: v.array(ChatMessageSchema),
  }),
  v.object({
    type: v.literal('player.joined'),
    player: PlayerStateSchema,
  }),
  v.object({
    type: v.literal('player.moved'),
    id: v.string(),
    x: v.number(),
    y: v.number(),
    vx: v.number(),
    vy: v.number(),
    action: CharacterActionSchema,
    flipX: v.boolean(),
    footholdId: v.nullable(v.number()),
    updatedAt: v.number(),
  }),
  v.object({
    type: v.literal('player.emoted'),
    id: v.string(),
    emotion: CharacterEmotionSchema,
  }),
  v.object({
    type: v.literal('player.updated'),
    player: PlayerStateSchema,
  }),
  v.object({
    type: v.literal('player.left'),
    id: v.string(),
    name: v.string(),
  }),
  // Sent to a connection that just lost its identity to a newer tab of the same
  // browser; the tab stops playing until the user reclaims it.
  v.object({
    type: v.literal('session.replaced'),
  }),
  v.object({
    type: v.literal('chat.message'),
    message: ChatMessageSchema,
  }),
  // Fame total and whether this connection's IP may fame again, for one player.
  v.object({
    type: v.literal('player.fame'),
    id: v.string(),
    fame: v.number(),
    canFame: v.boolean(),
    nextAt: v.number(),
  }),
  // Fame changed for a player; broadcast so every open info window updates.
  v.object({
    type: v.literal('player.fame.changed'),
    id: v.string(),
    fame: v.number(),
  }),
  // Feedback for actions taken in the player-info window (fame/report errors...).
  v.object({
    type: v.literal('server.notice'),
    text: v.string(),
    tone: v.optional(v.picklist(['info', 'error'])),
  }),
]);

const CHAT_HISTORY_KEY = 'chat_history_v1';
const MAX_CHAT_HISTORY = 50;
/** How many of the reported player's recent lines a report keeps for context. */
const MAX_REPORT_MESSAGES = 12;

function sanitizeName(raw: string): string {
  const cleaned = raw.trim().slice(0, 20);
  return cleaned || 'Mapler';
}

/**
 * The client IP behind a connection. Cloudflare always sets `cf-connecting-ip`;
 * the other headers are there for proxies / local development.
 *
 * Loopback addresses are not real public identities: with everything on
 * 127.0.0.1 every player would look like the same person (breaking fame and the
 * self check), so local connections fall back to a per-socket key instead.
 */
function requestIp(request: Request, fallbackId: string): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const header = (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    (forwarded ? forwarded.split(',')[0] : '') ||
    ''
  ).trim();
  if (!header || isLoopbackIp(header)) return `local:${fallbackId}`;
  return header;
}

function isLoopbackIp(ip: string): boolean {
  const value = ip.toLowerCase();
  return (
    value === '::1' ||
    value === 'localhost' ||
    value === '::ffff:127.0.0.1' ||
    value.startsWith('127.')
  );
}

export default defineRoom({
  name: 'maya-channel',
  messages: {
    client: ClientMessage,
    server: ServerMessage,
  },
  async onBeforeConnect(ctx) {
    // The request is the only place the client IP exists. Block banned IPs
    // before the upgrade so they never reach a channel.
    const ip = requestIp(ctx.request, ctx.connection.id);
    if (await Fame.get('global').isBanned(ip)) {
      return new Response("You've been blocked from Maya's House.", {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  },
  async onConnect(ctx) {
    const channel = ctx.params.channel || '1';
    // The request is the only place headers (and therefore the client IP) exist;
    // later hooks only see a placeholder. Keep it keyed by connection so fame and
    // reports can resolve who is acting.
    await ctx.storage.put(
      `conn_ip:${ctx.connection.id}`,
      requestIp(ctx.request, ctx.connection.id),
    );
    const players: PlayerState[] = [];
    for (const conn of ctx.room.getConnections()) {
      if (conn.state && typeof conn.state === 'object') {
        players.push(conn.state as PlayerState);
      }
    }
    const messages = (await ctx.storage.get<ChatMessage[]>(CHAT_HISTORY_KEY)) ?? [];

    await ctx.connection.send({
      type: 'channel.init',
      selfId: ctx.connection.id,
      channel,
      players,
      messages,
    });
  },
  async onMessage(ctx, event) {
    const now = Date.now();

    const actingIp = async (): Promise<string> =>
      (await ctx.storage.get<string>(`conn_ip:${ctx.connection.id}`)) ??
      `local:${ctx.connection.id}`;

    const playerName = (id: string): string => {
      for (const conn of ctx.room.getConnections()) {
        const state = conn.state as PlayerState | undefined;
        if (state && state.id === id) return state.name;
      }
      return 'that player';
    };

    // A ban can land while a socket is already open (the admin panel is a
    // separate request). Re-check on the lower-frequency messages and drop the
    // connection instead of cutting the ban only at the next reconnect.
    const kickIfBanned = async (): Promise<boolean> => {
      if (!(await Fame.get('global').isBanned(await actingIp()))) return false;
      await ctx.connection
        .send({
          type: 'server.notice',
          text: "You've been blocked from Maya's House.",
          tone: 'error',
        })
        .catch(() => {});
      ctx.connection.close(4003, 'banned');
      return true;
    };

    if (event.type === 'player.join') {
      const name = sanitizeName(event.name || event.character.name);
      const character: MapleSimCharacter = {
        ...event.character,
        name,
      };
      // One player per browser: the tab's stable identity becomes the player id, so
      // two tabs of the same browser are the same character rather than a duplicate.
      const playerId = event.clientId ?? ctx.connection.id;

      if (await kickIfBanned()) return;

      // The character belongs to the browser, not to whichever tab sent the join. If
      // the identity is already playing, keep where it is: a tab taking the character
      // over (or a brand new one) has to adopt that position rather than drag the
      // character back to where this tab last saw it.
      let existing: PlayerState | undefined;
      for (const conn of ctx.room.getConnections()) {
        if (conn.id === ctx.connection.id) continue;
        const other = conn.state as PlayerState | undefined;
        if (other && other.id === playerId) existing = other;
      }

      const player: PlayerState = {
        id: playerId,
        name,
        character,
        x: existing ? existing.x : Math.max(-500, Math.min(700, event.x)),
        y: existing ? existing.y : Math.max(-300, Math.min(400, event.y)),
        vx: 0,
        vy: 0,
        action: existing ? existing.action : event.action,
        emotion: event.emotion,
        flipX: existing ? existing.flipX : event.flipX,
        footholdId: existing ? existing.footholdId : event.footholdId,
        updatedAt: now,
      };

      ctx.connection.setState(player);
      // Remember which IP is playing this player so fame/report can target them
      // even though later hooks can no longer read the request headers.
      await ctx.storage.put(`player_ip:${playerId}`, await actingIp());
      // Broadcast before handing the identity over: closing another socket and then
      // broadcasting in the same event silently drops the message for everyone.
      await ctx.room.broadcast({
        type: 'player.joined',
        player,
      });

      // Newest tab wins: park any other connection still playing this identity. The
      // tab closes its own socket when it gets this, which also avoids a dead socket
      // sitting in the room.
      for (const conn of ctx.room.getConnections()) {
        if (conn.id === ctx.connection.id) continue;
        const other = conn.state as PlayerState | undefined;
        if (!other || other.id !== playerId) continue;
        // Clearing the state stops it playing and keeps its eventual close from
        // removing the character the new tab now owns.
        conn.setState(null);
        await conn.send({ type: 'session.replaced' }).catch(() => {});
      }
      return;
    }

    const current = ctx.connection.state as PlayerState | undefined;
    if (!current) return;

    if (event.type === 'player.move') {
      const updated: PlayerState = {
        ...current,
        x: Math.max(-500, Math.min(700, event.x)),
        y: Math.max(-300, Math.min(400, event.y)),
        vx: event.vx,
        vy: event.vy,
        action: event.action as CharacterAction,
        flipX: event.flipX,
        footholdId: event.footholdId,
        updatedAt: now,
      };
      ctx.connection.setState(updated);

      await ctx.room.broadcast(
        {
          type: 'player.moved',
          id: current.id,
          x: updated.x,
          y: updated.y,
          vx: updated.vx,
          vy: updated.vy,
          action: updated.action,
          flipX: updated.flipX,
          footholdId: updated.footholdId,
          updatedAt: now,
        },
        [ctx.connection.id],
      );
      return;
    }

    if (event.type === 'player.emote') {
      const updated: PlayerState = {
        ...current,
        emotion: event.emotion as CharacterEmotion,
        character: {
          ...current.character,
          emotion: event.emotion,
        },
        updatedAt: now,
      };
      ctx.connection.setState(updated);

      await ctx.room.broadcast({
        type: 'player.emoted',
        id: current.id,
        emotion: updated.emotion,
      });
      return;
    }

    if (event.type === 'player.update') {
      const name = sanitizeName(event.name || event.character.name);
      const updated: PlayerState = {
        ...current,
        name,
        character: {
          ...event.character,
          name,
        },
        updatedAt: now,
      };
      ctx.connection.setState(updated);

      await ctx.room.broadcast({
        type: 'player.updated',
        player: updated,
      });
      return;
    }

    if (event.type === 'chat.message') {
      if (await kickIfBanned()) return;

      const text = event.text.trim().slice(0, 200);
      if (!text) return;

      const message: ChatMessage = {
        id: crypto.randomUUID(),
        userId: current.id,
        userName: current.name,
        text,
        timestamp: now,
      };

      const history = (await ctx.storage.get<ChatMessage[]>(CHAT_HISTORY_KEY)) ?? [];
      const nextHistory = [...history.slice(-(MAX_CHAT_HISTORY - 1)), message];
      await ctx.storage.put(CHAT_HISTORY_KEY, nextHistory);

      await ctx.room.broadcast({
        type: 'chat.message',
        message,
      });
      return;
    }

    if (event.type === 'player.fame.query') {
      const targetIp =
        (await ctx.storage.get<string>(`player_ip:${event.id}`)) ?? '';
      const status = await Fame.get('global').status(
        await actingIp(),
        targetIp,
        now,
      );
      await ctx.connection.send({
        type: 'player.fame',
        id: event.id,
        fame: status.fame,
        canFame: status.canFame,
        nextAt: status.nextAt,
      });
      return;
    }

    if (event.type === 'player.fame.give') {
      const targetIp =
        (await ctx.storage.get<string>(`player_ip:${event.id}`)) ?? '';
      const result = await Fame.get('global').fame(
        await actingIp(),
        targetIp,
        event.direction,
        now,
      );

      if (result.ok) {
        await ctx.room.broadcast({
          type: 'player.fame.changed',
          id: event.id,
          fame: result.fame,
        });
        await ctx.connection.send({
          type: 'player.fame',
          id: event.id,
          fame: result.fame,
          canFame: false,
          nextAt: result.nextAt,
        });
        await ctx.connection.send({
          type: 'server.notice',
          text:
            event.direction === 'down'
              ? `You defamed ${playerName(event.id)}.`
              : `You famed ${playerName(event.id)}!`,
          tone: 'info',
        });
      } else {
        await ctx.connection.send({
          type: 'player.fame',
          id: event.id,
          fame: result.fame,
          canFame: false,
          nextAt: result.nextAt,
        });
        const message =
          result.reason === 'self'
            ? "You can't fame yourself."
            : result.reason === 'cooldown'
              ? 'You can only fame someone once a week.'
              : 'That player is no longer here.';
        await ctx.connection.send({
          type: 'server.notice',
          text: message,
          tone: 'error',
        });
      }
      return;
    }

    if (event.type === 'player.report') {
      const targetIp =
        (await ctx.storage.get<string>(`player_ip:${event.id}`)) ?? '';
      // Freeze the reported player's recent lines and fame so a moderator can
      // judge the report even after the chat scrolls away.
      const history =
        (await ctx.storage.get<ChatMessage[]>(CHAT_HISTORY_KEY)) ?? [];
      const recentMessages = history
        .filter((message) => message.userId === event.id && !message.system)
        .slice(-MAX_REPORT_MESSAGES)
        .map((message) => ({ at: message.timestamp, text: message.text }));
      const targetFame = await Fame.get('global').fameOf(targetIp);

      await Fame.get('global').report({
        id: crypto.randomUUID(),
        at: now,
        reporterId: current.id,
        reporterName: current.name,
        reporterIp: await actingIp(),
        targetId: event.id,
        targetName: playerName(event.id),
        targetIp,
        reason: (event.reason ?? '').trim().slice(0, 200),
        targetFame,
        recentMessages,
      });
      await ctx.connection.send({
        type: 'server.notice',
        text: `Reported ${playerName(event.id)}. Thanks for keeping Maya's House safe.`,
        tone: 'info',
      });
    }
  },
  async onClose(ctx) {
    // Per-connection IPs are only needed while the socket lives; player IPs stay
    // so fame keeps following the same person after they reconnect.
    await ctx.storage.delete(`conn_ip:${ctx.connection.id}`);

    const current = ctx.connection.state as PlayerState | undefined;
    // A connection parked by a newer tab has no state, so closing it must not
    // remove the character the new tab is now playing.
    if (current) {
      await ctx.room.broadcast(
        {
          type: 'player.left',
          id: current.id,
          name: current.name,
        },
        [ctx.connection.id],
      );
    }
  },
});
