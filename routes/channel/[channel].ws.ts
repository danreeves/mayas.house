import * as v from 'valibot';
import { defineRoom } from 'void/ws';
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
]);

const CHAT_HISTORY_KEY = 'chat_history_v1';
const MAX_CHAT_HISTORY = 50;

function sanitizeName(raw: string): string {
  const cleaned = raw.trim().slice(0, 20);
  return cleaned || 'Mapler';
}

export default defineRoom({
  name: 'maya-channel',
  messages: {
    client: ClientMessage,
    server: ServerMessage,
  },
  async onConnect(ctx) {
    const channel = ctx.params.channel || '1';
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

    if (event.type === 'player.join') {
      const name = sanitizeName(event.name || event.character.name);
      const character: MapleSimCharacter = {
        ...event.character,
        name,
      };
      // One player per browser: the tab's stable identity becomes the player id, so
      // two tabs of the same browser are the same character rather than a duplicate.
      const playerId = event.clientId ?? ctx.connection.id;

      const player: PlayerState = {
        id: playerId,
        name,
        character,
        x: Math.max(-500, Math.min(700, event.x)),
        y: Math.max(-300, Math.min(400, event.y)),
        vx: 0,
        vy: 0,
        action: event.action,
        emotion: event.emotion,
        flipX: event.flipX,
        footholdId: event.footholdId,
        updatedAt: now,
      };

      ctx.connection.setState(player);
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
    }
  },
  async onClose(ctx) {
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
