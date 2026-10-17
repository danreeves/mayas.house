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
      const player: PlayerState = {
        id: ctx.connection.id,
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
      await ctx.room.broadcast({
        type: 'player.joined',
        player,
      });
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
          id: ctx.connection.id,
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
        id: ctx.connection.id,
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
        userId: ctx.connection.id,
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
    if (current) {
      await ctx.room.broadcast(
        {
          type: 'player.left',
          id: ctx.connection.id,
          name: current.name,
        },
        [ctx.connection.id],
      );
    }
  },
});
