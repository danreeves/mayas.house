import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { connect } from 'void/ws';
import { generateRandomCharacter } from '../src/character/generator';
import { normalizeMapleSimCharacter } from '../src/character/parser';
import { CharacterModal } from '../src/components/CharacterModal';
import {
  type InputState,
  type LocalPhysicsState,
  findFootholdBelow,
  getSpawnPoint,
  getWalkableFootholds,
  stepPhysics,
} from '../src/engine/physics';
import {
  type ActiveChatBubble,
  preloadMapAssets,
  renderScene,
} from '../src/engine/renderer';
import {
  EMOTE_PALETTE,
  preloadCharacterEmotionFrames,
  preloadCharacterFrames,
} from '../src/engine/sprites';
import '../src/styles/maple.css';
import type {
  CharacterAction,
  CharacterEmotion,
  ChatMessage,
  MapleMapData,
  MapleSimCharacter,
  PlayerState,
} from '../src/types/maple';

const STORAGE_CHAR_KEY = 'mayas_house_character_v1';
const STORAGE_CHANNEL_KEY = 'mayas_house_channel_v1';
const STORAGE_CLIENT_ID_KEY = 'mayas_house_client_id_v1';
const CHANNELS = Array.from({ length: 19 }, (_, i) => String(i + 1));

const EMOTE_LABELS: Record<CharacterEmotion, string> = {
  default: 'Default',
  hit: 'Hit',
  smile: 'Smile',
  troubled: 'Troubled',
  cry: 'Cry',
  angry: 'Angry',
  bewildered: 'Bewildered',
  stunned: 'Stunned',
  blaze: 'Blaze',
  blink: 'Blink',
  bowing: 'Bowing',
  cheers: 'Cheers',
  chu: 'Chu',
  dam: 'Dam',
  despair: 'Despair',
  glitter: 'Glitter',
  hot: 'Hot',
  hum: 'Hum',
  love: 'Love',
  oops: 'Oops',
  pain: 'Pain',
  qBlue: 'Q Blue',
  shine: 'Shine',
  vomit: 'Vomit',
  wink: 'Wink',
};

// F1..F7 map onto the palette the sprite cache preloads.
const EMOTE_HOTKEYS: Array<{
  key: string;
  emotion: CharacterEmotion;
  label: string;
}> = EMOTE_PALETTE.map((emotion, index) => ({
  key: `F${index + 1}`,
  emotion,
  label: EMOTE_LABELS[emotion] ?? emotion,
}));

const MAYA_DIALOGUES = [
  '*Cough... Cough...* Ah... My head... Can somebody help me...?',
  '*Cough, cough...* I need the Weird Medicine from Teo in Lith Harbor...',
  'Thanks for stopping by my house in Henesys. Stay and chat awhile!',
];

// Map data debugging is only useful while developing, so the toggle stays hidden
// in production builds.
function isLocalDevHost(): boolean {
  if (typeof location === 'undefined') return false;
  const host = location.hostname;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host.endsWith('.localhost')
  );
}

function loadSavedCharacter(): MapleSimCharacter {
  try {
    const saved = localStorage.getItem(STORAGE_CHAR_KEY);
    if (saved) {
      return normalizeMapleSimCharacter(JSON.parse(saved));
    }
  } catch {
    // Ignore invalid localStorage entry
  }
  const generated = generateRandomCharacter();
  try {
    localStorage.setItem(STORAGE_CHAR_KEY, JSON.stringify(generated));
  } catch {
    // Ignore storage quota errors
  }
  return generated;
}

/**
 * Stable per-browser identity. Every tab of this browser joins as the same player,
 * so opening a second tab hands the character over to it instead of spawning a
 * duplicate that both tabs can drive independently.
 */
function loadClientId(): string {
  try {
    const saved = localStorage.getItem(STORAGE_CLIENT_ID_KEY);
    if (saved && saved.length >= 8) return saved;
  } catch {
    // Ignore storage errors
  }

  const generated =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `client-${Math.random().toString(36).slice(2)}${Date.now()}`;

  try {
    localStorage.setItem(STORAGE_CLIENT_ID_KEY, generated);
  } catch {
    // Ignore storage quota errors
  }
  return generated;
}

export default function MayasHousePage() {
  const [channel, setChannel] = createSignal<string>('1');
  const [connected, setConnected] = createSignal(false);
  const [selfId, setSelfId] = createSignal('local');
  // Set when another tab of this browser takes the character over.
  const [sessionReplaced, setSessionReplaced] = createSignal(false);
  const [character, setCharacter] = createSignal<MapleSimCharacter>(
    generateRandomCharacter(),
  );
  const [mapData, setMapData] = createSignal<MapleMapData | null>(null);
  const [remotePlayers, setRemotePlayers] = createSignal<PlayerState[]>([]);
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [chatText, setChatText] = createSignal('');
  const [charModalOpen, setCharModalOpen] = createSignal(false);
  const [showControls, setShowControls] = createSignal(false);
  const [showFootholds, setShowFootholds] = createSignal(false);
  const [bgmEnabled, setBgmEnabled] = createSignal(false);
  const [activeEmotion, setActiveEmotion] =
    createSignal<CharacterEmotion>('default');
  const [isSitting, setIsSitting] = createSignal(false);

  let canvasRef: HTMLCanvasElement | undefined;
  let chatInputRef: HTMLInputElement | undefined;
  let chatHistoryRef: HTMLDivElement | undefined;
  let bgmAudioRef: HTMLAudioElement | undefined;

  const remotePlayerMap = new Map<string, PlayerState>();
  const chatBubbles = new Map<string, ActiveChatBubble>();
  let npcBubble: ActiveChatBubble | null = {
    text: MAYA_DIALOGUES[0],
    expiresAt: Date.now() + 7000,
  };
  let emotionTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSocket: ReturnType<typeof connect<'/channel/:channel'>> | null =
    null;

  const inputState: InputState = {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    sit: false,
  };

  const physicsState: LocalPhysicsState = {
    x: 0,
    y: 274,
    vx: 0,
    vy: 0,
    footholdId: 11,
    onLadder: null,
    action: 'stand1',
    flipX: false,
    sitting: false,
    ignoreFootholdId: null,
    ignoreFootholdUntil: 0,
    ladderCooldownUntil: 0,
  };

  let cameraX = 0;
  let cameraY = 120;

  // Remote positions only arrive every ~55ms. Packets are buffered with their
  // arrival time and the drawn position is interpolated a short, fixed delay
  // behind the newest one: that plays back at the real walking speed instead of
  // easing towards each packet, which trails and reads as floaty.
  interface RemoteSample {
    t: number;
    x: number;
    y: number;
    action: CharacterAction;
    flipX: boolean;
  }
  const remoteSamples = new Map<string, RemoteSample[]>();
  const REMOTE_RENDER_DELAY_MS = 90;
  const REMOTE_EXTRAPOLATE_MS = 70;
  const REMOTE_SAMPLE_LIMIT = 24;

  // Channel changes fade out, respawn at the map's spawn portal, then fade back in
  // while the new channel's socket connects.
  const CHANNEL_FADE_MS = 260;
  // How long to wait for the channel snapshot before joining anyway.
  const JOIN_AFTER_INIT_TIMEOUT_MS = 1500;
  let fadeAlpha = 0;
  let fadeToBlack = false;
  let channelSwitchTimer: ReturnType<typeof setTimeout> | null = null;

  const cameraTargetFor = (x: number, y: number) => ({
    x: Math.max(-180, Math.min(260, x)),
    y: Math.max(20, Math.min(165, y - 75)),
  });

  const trackRemoteSample = (
    id: string,
    x: number,
    y: number,
    action: CharacterAction,
    flipX: boolean,
    at = performance.now(),
  ) => {
    let samples = remoteSamples.get(id);
    if (!samples) {
      samples = [];
      remoteSamples.set(id, samples);
    }
    samples.push({ t: at, x, y, action, flipX });
    if (samples.length > REMOTE_SAMPLE_LIMIT) {
      samples.splice(0, samples.length - REMOTE_SAMPLE_LIMIT);
    }
  };

  // Play a tracked position back slightly behind the newest packet so it runs at the
  // real walking speed and stays smooth despite the low update rate.
  const interpolatePlayback = (
    id: string,
    target: { x: number; y: number; action: CharacterAction; flipX: boolean },
    renderTime: number,
  ) => {
    const samples = remoteSamples.get(id);
    if (!samples || samples.length === 0) return;

    const newest = samples[samples.length - 1];
    if (samples.length === 1) {
      target.x = newest.x;
      target.y = newest.y;
      target.action = newest.action;
      target.flipX = newest.flipX;
      return;
    }

    // Only predict past the newest packet while they are actually moving, and never by
    // much: a standing player must not keep sliding forward.
    const moving = newest.action === 'walk1' || newest.action === 'jump';
    const t = Math.min(
      renderTime,
      newest.t + (moving ? REMOTE_EXTRAPOLATE_MS : 0),
    );

    let i = 0;
    while (i < samples.length - 2 && samples[i + 1].t <= t) i += 1;
    const a = samples[i];
    const b = samples[i + 1];
    const span = b.t - a.t;
    const alpha = span > 0 ? (t - a.t) / span : 1;

    if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > 200) {
      // A jump this large is a teleport/respawn, not movement: don't slide.
      target.x = b.x;
      target.y = b.y;
    } else {
      target.x = a.x + (b.x - a.x) * alpha;
      target.y = a.y + (b.y - a.y) * alpha;
    }

    // Pose comes from the start of the segment being interpolated, but once the stream
    // goes quiet (player standing still) time clamps onto the newest sample, so that
    // one wins: otherwise they stay stuck in their last moving pose (mid-jump, ...).
    const pose = t >= b.t ? b : a;
    target.action = pose.action;
    target.flipX = pose.flipX;
  };

  const syncRemoteList = () => {
    setRemotePlayers(Array.from(remotePlayerMap.values()));
  };

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (chatHistoryRef) {
        chatHistoryRef.scrollTop = chatHistoryRef.scrollHeight;
      }
    });
  };

  const appendSystemMessage = (text: string) => {
    setMessages((prev) => [
      ...prev.slice(-79),
      {
        id: `sys-${Date.now()}-${Math.random()}`,
        userId: 'system',
        userName: 'Notice',
        text,
        timestamp: Date.now(),
        system: true,
      },
    ]);
    scrollToBottom();
  };

  const triggerEmotion = (emotion: CharacterEmotion) => {
    setActiveEmotion(emotion);
    preloadCharacterEmotionFrames(character(), emotion);
    activeSocket?.send({
      type: 'player.emote',
      emotion,
    });
    if (emotionTimer) {
      clearTimeout(emotionTimer);
      emotionTimer = null;
    }
    if (emotion !== 'default') {
      emotionTimer = setTimeout(() => {
        setActiveEmotion('default');
        activeSocket?.send({
          type: 'player.emote',
          emotion: 'default',
        });
      }, 3000);
    }
  };

  const respawnAtSpawn = () => {
    const spawn = getSpawnPoint(mapData());
    physicsState.x = spawn.x;
    physicsState.y = spawn.y;
    physicsState.vx = 0;
    physicsState.vy = 0;
    physicsState.action = 'stand1';
    physicsState.flipX = false;
    physicsState.sitting = false;
    physicsState.onLadder = null;
    physicsState.ignoreFootholdId = null;
    physicsState.ignoreFootholdUntil = 0;
    physicsState.ladderCooldownUntil = 0;
    setIsSitting(false);

    // Arrive airborne, exactly like the real spawn portal drop-in: the physics
    // step then applies gravity and lands the character on the floor below.
    physicsState.footholdId = null;

    // Snap the camera behind the black-out so the fade-in already shows the spawn.
    const target = cameraTargetFor(physicsState.x, physicsState.y);
    cameraX = target.x;
    cameraY = target.y;
  };

  // Take the character's authoritative state from the server. Whenever this tab takes
  // it over (or rejoins), the character stays where it actually is instead of snapping
  // back to where this tab was when it lost control.
  const adoptServerState = (server: PlayerState) => {
    physicsState.x = server.x;
    physicsState.y = server.y;
    physicsState.vx = 0;
    physicsState.vy = 0;
    physicsState.action = server.action;
    physicsState.flipX = server.flipX;
    physicsState.footholdId = server.footholdId;
    physicsState.sitting = server.action === 'sit';
    physicsState.ignoreFootholdId = null;
    physicsState.ignoreFootholdUntil = 0;
    physicsState.ladderCooldownUntil = 0;

    // Was the other tab mid-climb? Grab the same ladder, or the character would drop
    // off it the moment this tab takes over.
    if (server.action === 'ladder' || server.action === 'rope') {
      physicsState.onLadder =
        (mapData()?.ladderRopes || []).find(
          (ladder) =>
            Math.abs(server.x - ladder.x) <= 20 &&
            server.y >= ladder.y1 - 8 &&
            server.y <= ladder.y2 + 8,
        ) ?? null;
    } else {
      physicsState.onLadder = null;
    }

    setIsSitting(physicsState.sitting);

    // Put the camera straight on the character so taking over does not pan the map.
    const target = cameraTargetFor(physicsState.x, physicsState.y);
    cameraX = target.x;
    cameraY = target.y;
  };

  const sendJoin = (sock: ReturnType<typeof connect<'/channel/:channel'>> | null) => {
    if (!sock) return;
    const curChar = character();
    sock.send({
      type: 'player.join',
      clientId: selfId(),
      name: curChar.name || 'Mapler',
      character: curChar,
      x: Math.round(physicsState.x),
      y: Math.round(physicsState.y),
      action: physicsState.action,
      emotion: activeEmotion(),
      flipX: physicsState.flipX,
      footholdId: physicsState.footholdId,
    });
  };

  const connectToChannel = (targetChannel: string) => {
    if (activeSocket) {
      activeSocket.close();
      activeSocket = null;
    }
    remotePlayerMap.clear();
    remoteSamples.clear();
    syncRemoteList();
    setConnected(false);

    const sock = connect('/channel/:channel', {
      params: { channel: targetChannel },
    });
    activeSocket = sock;

    // The channel snapshot is what tells a tab taking the character over where it
    // already is, so we announce ourselves only once it has arrived. Falls back to a
    // blind join if it never shows up.
    let joined = false;
    let joinFallback: ReturnType<typeof setTimeout> | null = null;
    const joinWhenReady = () => {
      if (joined) return;
      joined = true;
      if (joinFallback) {
        clearTimeout(joinFallback);
        joinFallback = null;
      }
      if (!sessionReplaced()) sendJoin(sock);
    };

    sock.on('open', () => {
      setConnected(true);
      // A tab that lost its character to a newer tab stays parked: joining again here
      // would start a takeover ping-pong.
      if (sessionReplaced()) return;
      joined = false;
      joinFallback = setTimeout(joinWhenReady, JOIN_AFTER_INIT_TIMEOUT_MS);
    });

    sock.on('close', () => {
      setConnected(false);
      // Do not let a pending fallback join fire at a dead socket.
      if (joinFallback) {
        clearTimeout(joinFallback);
        joinFallback = null;
      }
    });

    sock.on('message', (event) => {
      if (event.type === 'channel.init') {
        remotePlayerMap.clear();
        remoteSamples.clear();
        for (const p of event.players) {
          // Our own player is identified by this browser's id, not the connection.
          if (p.id === selfId()) {
            // Another tab of this browser already has the character: pick up exactly
            // where it is, so joining does not drag the character here.
            adoptServerState(p);
            continue;
          }
          remotePlayerMap.set(p.id, p);
          trackRemoteSample(p.id, p.x, p.y, p.action, p.flipX);
          preloadCharacterFrames(p.character);
        }
        syncRemoteList();
        setMessages(event.messages);
        if (!sessionReplaced()) {
          appendSystemMessage(
            `Connected to Maya's House — Channel ${event.channel}.`,
          );
        }
        joinWhenReady();
        return;
      }

      if (event.type === 'session.replaced') {
        // Another tab of this browser claimed the character. Close our own socket so we
        // stop receiving updates the tab that is actually playing already gets, and so
        // the client cannot reconnect and start a takeover ping-pong.
        setSessionReplaced(true);
        inputState.left = false;
        inputState.right = false;
        inputState.up = false;
        inputState.down = false;
        inputState.jump = false;
        inputState.sit = false;
        appendSystemMessage(
          "You're playing in another tab — press Play in this tab to move back here.",
        );
        activeSocket?.close();
        activeSocket = null;
        return;
      }

      if (event.type === 'player.joined') {
        if (event.player.id === selfId()) {
          // Our own echo, including when this tab just took the character back over:
          // the server decided which position wins, so follow exactly what it settled
          // on instead of keeping this tab's stale one.
          adoptServerState(event.player);
          return;
        }
        remotePlayerMap.set(event.player.id, event.player);
        trackRemoteSample(
          event.player.id,
          event.player.x,
          event.player.y,
          event.player.action,
          event.player.flipX,
        );
        preloadCharacterFrames(event.player.character);
        syncRemoteList();
        return;
      }

      if (event.type === 'player.moved') {
        // The server never sends us our own moves; a parked tab has no socket at all.
        if (event.id === selfId()) return;
        const existing = remotePlayerMap.get(event.id);
        if (existing) {
          existing.vx = event.vx;
          existing.vy = event.vy;
          existing.footholdId = event.footholdId;
          existing.updatedAt = event.updatedAt;
          trackRemoteSample(
            event.id,
            event.x,
            event.y,
            event.action,
            event.flipX,
          );
          syncRemoteList();
        }
        return;
      }

      if (event.type === 'player.emoted') {
        if (event.id === selfId()) return;
        const existing = remotePlayerMap.get(event.id);
        if (existing) {
          existing.emotion = event.emotion;
          existing.character = {
            ...existing.character,
            emotion: event.emotion,
          };
          preloadCharacterEmotionFrames(existing.character, event.emotion);
        }
        return;
      }

      if (event.type === 'player.updated') {
        if (event.player.id === selfId()) return;
        // Keep the currently drawn position so a look change doesn't teleport them.
        const existing = remotePlayerMap.get(event.player.id);
        const next = existing
          ? { ...event.player, x: existing.x, y: existing.y }
          : event.player;
        remotePlayerMap.set(event.player.id, next);
        trackRemoteSample(
          event.player.id,
          event.player.x,
          event.player.y,
          event.player.action,
          event.player.flipX,
        );
        preloadCharacterFrames(event.player.character);
        syncRemoteList();
        return;
      }

      if (event.type === 'player.left') {
        remotePlayerMap.delete(event.id);
        remoteSamples.delete(event.id);
        chatBubbles.delete(event.id);
        syncRemoteList();
        return;
      }

      if (event.type === 'chat.message') {
        setMessages((prev) => [...prev.slice(-79), event.message]);
        chatBubbles.set(event.message.userId, {
          text: event.message.text,
          expiresAt: Date.now() + 5500,
        });
        scrollToBottom();
      }
    });
  };

  onMount(() => {
    preloadMapAssets();

    const clientId = loadClientId();
    setSelfId(clientId);

    // Load saved character & channel
    const savedChar = loadSavedCharacter();
    setCharacter(savedChar);
    physicsState.x = Math.max(-350, Math.min(350, savedChar.position?.x || 0));
    physicsState.y = 274;
    physicsState.flipX = Boolean(savedChar.flipX);
    cameraX = physicsState.x;
    preloadCharacterFrames(savedChar);

    const savedChannel = localStorage.getItem(STORAGE_CHANNEL_KEY) || '1';
    setChannel(savedChannel);

    // Fetch Maya's House map metadata via our Cloudflare proxy
    fetch('/api/maple/GMS/93/map/100000001')
      .then((res) => res.json() as Promise<MapleMapData>)
      .then((data) => {
        setMapData(data);
      })
      .catch((err) => {
        console.error('Failed to load map metadata:', err);
      });

    connectToChannel(savedChannel);

    // Periodic Maya cough/dialogue bubble
    const mayaInterval = setInterval(() => {
      const line =
        MAYA_DIALOGUES[Math.floor(Math.random() * MAYA_DIALOGUES.length)];
      npcBubble = {
        text: line,
        expiresAt: Date.now() + 6000,
      };
    }, 18000);

    // Keyboard controls
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isTyping = activeTag === 'input' || activeTag === 'textarea';

      if (e.key === 'Enter') {
        if (!isTyping && !charModalOpen()) {
          e.preventDefault();
          chatInputRef?.focus();
          return;
        }
      }

      if (e.key === 'Escape') {
        if (isTyping) {
          (document.activeElement as HTMLElement)?.blur();
          return;
        }
        if (charModalOpen()) {
          setCharModalOpen(false);
          return;
        }
      }

      if (isTyping || charModalOpen()) return;

      // A parked tab does not drive the character; the tab that owns it does.
      if (sessionReplaced()) return;

      // F1 - F7 Emotes
      const emoteMatch = EMOTE_HOTKEYS.find((em) => em.key === e.key);
      if (emoteMatch) {
        e.preventDefault();
        triggerEmotion(emoteMatch.emotion);
        return;
      }

      switch (e.code) {
        case 'ArrowLeft':
          e.preventDefault();
          inputState.left = true;
          break;
        case 'ArrowRight':
          e.preventDefault();
          inputState.right = true;
          break;
        case 'ArrowUp':
          e.preventDefault();
          inputState.up = true;
          break;
        case 'ArrowDown':
          e.preventDefault();
          inputState.down = true;
          break;
        case 'AltLeft':
        case 'AltRight':
        case 'Space':
          e.preventDefault();
          inputState.jump = true;
          break;
        case 'KeyX':
          e.preventDefault();
          inputState.sit = true;
          physicsState.sitting = !physicsState.sitting;
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'ArrowLeft':
          inputState.left = false;
          break;
        case 'ArrowRight':
          inputState.right = false;
          break;
        case 'ArrowUp':
          inputState.up = false;
          break;
        case 'ArrowDown':
          inputState.down = false;
          break;
        case 'AltLeft':
        case 'AltRight':
        case 'Space':
          inputState.jump = false;
          break;
        case 'KeyX':
          inputState.sit = false;
          break;
      }
    };

    const handleBlur = () => {
      inputState.left = false;
      inputState.right = false;
      inputState.up = false;
      inputState.down = false;
      inputState.jump = false;
      inputState.sit = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    // 60fps Game & Canvas Render Loop
    let animId = 0;
    let lastTime = performance.now();
    let lastBroadcastTime = 0;
    let lastSentX = physicsState.x;
    let lastSentY = physicsState.y;
    let lastSentAction = physicsState.action;
    let lastSentFlipX = physicsState.flipX;

    const frameLoop = (nowPerf: number) => {
      const dt = Math.min(0.05, (nowPerf - lastTime) / 1000);
      lastTime = nowPerf;
      const nowWall = Date.now();

      const map = mapData();
      const remoteRenderTime = nowPerf - REMOTE_RENDER_DELAY_MS;

      if (map) {
        stepPhysics(physicsState, inputState, map, dt, nowWall);
        if (isSitting() !== physicsState.sitting) {
          setIsSitting(physicsState.sitting);
        }
      }

      for (const remote of remotePlayerMap.values()) {
        interpolatePlayback(remote.id, remote, remoteRenderTime);
      }

      // Smooth camera tracking clamped to Maya's House bounds
      const camTarget = cameraTargetFor(physicsState.x, physicsState.y);
      cameraX += (camTarget.x - cameraX) * Math.min(1, dt * 7);
      cameraY += (camTarget.y - cameraY) * Math.min(1, dt * 7);

      // Channel-change fade easing
      const fadeTarget = fadeToBlack ? 1 : 0;
      if (fadeAlpha !== fadeTarget) {
        const fadeStep = dt / (CHANNEL_FADE_MS / 1000);
        fadeAlpha =
          fadeTarget > fadeAlpha
            ? Math.min(fadeTarget, fadeAlpha + fadeStep)
            : Math.max(fadeTarget, fadeAlpha - fadeStep);
      }

      // Broadcast movement to channel if position or action changed
      const movedDist =
        Math.abs(physicsState.x - lastSentX) +
        Math.abs(physicsState.y - lastSentY);
      const stateChanged =
        physicsState.action !== lastSentAction ||
        physicsState.flipX !== lastSentFlipX;

      if (
        activeSocket &&
        !sessionReplaced() &&
        ((movedDist >= 1.5 && nowPerf - lastBroadcastTime >= 55) ||
          stateChanged)
      ) {
        lastBroadcastTime = nowPerf;
        lastSentX = physicsState.x;
        lastSentY = physicsState.y;
        lastSentAction = physicsState.action;
        lastSentFlipX = physicsState.flipX;

        activeSocket.send({
          type: 'player.move',
          x: Math.round(physicsState.x),
          y: Math.round(physicsState.y),
          vx: Math.round(physicsState.vx),
          vy: Math.round(physicsState.vy),
          action: physicsState.action,
          flipX: physicsState.flipX,
          footholdId: physicsState.footholdId,
        });
      }

      // Render Canvas
      if (canvasRef) {
        if (
          canvasRef.width !== window.innerWidth ||
          canvasRef.height !== window.innerHeight
        ) {
          canvasRef.width = window.innerWidth;
          canvasRef.height = window.innerHeight;
        }
        const ctx = canvasRef.getContext('2d');
        if (ctx) {
          const curChar = character();
          const selfPlayer: PlayerState = {
            id: selfId(),
            name: curChar.name || 'Mapler',
            character: curChar,
            x: physicsState.x,
            y: physicsState.y,
            vx: physicsState.vx,
            vy: physicsState.vy,
            action: physicsState.action,
            emotion: activeEmotion(),
            flipX: physicsState.flipX,
            footholdId: physicsState.footholdId,
            updatedAt: nowWall,
          };

          renderScene(
            ctx,
            canvasRef.width,
            canvasRef.height,
            {
              mapData: map,
              selfPlayer,
              remotePlayers: remotePlayerMap,
              chatBubbles,
              npcBubble,
              showFootholds: showFootholds(),
              cameraX,
              cameraY,
              isMovingOnLadder:
                Boolean(physicsState.onLadder) &&
                (inputState.up || inputState.down),
            },
            nowWall,
          );

          // Channel-change black-out, drawn over everything else
          if (fadeAlpha > 0.001) {
            ctx.fillStyle = `rgba(0, 0, 0, ${fadeAlpha.toFixed(3)})`;
            ctx.fillRect(0, 0, canvasRef.width, canvasRef.height);
          }
        }
      }

      animId = requestAnimationFrame(frameLoop);
    };

    animId = requestAnimationFrame(frameLoop);

    onCleanup(() => {
      cancelAnimationFrame(animId);
      clearInterval(mayaInterval);
      if (channelSwitchTimer) {
        clearTimeout(channelSwitchTimer);
        channelSwitchTimer = null;
      }
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      activeSocket?.close();
    });
  });

  // Sync BGM playback
  createEffect(() => {
    const enabled = bgmEnabled();
    if (!bgmAudioRef) return;
    if (enabled) {
      bgmAudioRef.volume = 0.35;
      bgmAudioRef.play().catch(() => {
        setBgmEnabled(false);
      });
    } else {
      bgmAudioRef.pause();
    }
  });

  const handleChannelChange = (nextChannel: string) => {
    if (nextChannel === channel() || channelSwitchTimer) return;
    setChannel(nextChannel);
    try {
      localStorage.setItem(STORAGE_CHANNEL_KEY, nextChannel);
    } catch {
      // Ignore storage error
    }

    // Black the screen out, respawn at the map's spawn portal, then join the new
    // channel and fade back in while the socket connects.
    fadeToBlack = true;
    channelSwitchTimer = setTimeout(() => {
      channelSwitchTimer = null;
      respawnAtSpawn();
      connectToChannel(nextChannel);
      fadeToBlack = false;
    }, CHANNEL_FADE_MS);
  };

  const handleReclaimSession = () => {
    setSessionReplaced(false);
    // Reconnecting is what takes the character back. The fresh channel snapshot is
    // what tells us where the character is, so it never has to move to us.
    connectToChannel(channel());
  };

  const handleSendChat = (e: Event) => {
    e.preventDefault();
    const trimmed = chatText().trim();
    if (!trimmed) {
      chatInputRef?.blur();
      return;
    }
    activeSocket?.send({
      type: 'chat.message',
      text: trimmed,
    });
    setChatText('');
    chatInputRef?.blur();
  };

  const handleSaveCharacter = (updated: MapleSimCharacter) => {
    setCharacter(updated);
    preloadCharacterFrames(updated);
    try {
      localStorage.setItem(STORAGE_CHAR_KEY, JSON.stringify(updated));
    } catch {
      // Ignore storage error
    }
    activeSocket?.send({
      type: 'player.update',
      name: updated.name || 'Mapler',
      character: updated,
    });
    appendSystemMessage(`Updated character to ${updated.name}.`);
  };

  // Convert world (x, y) to percentage on MiniMap
  const worldToMinimapPct = (wx: number, wy: number) => {
    const m = mapData()?.miniMap;
    const cx = m?.centerX ?? 527;
    const cy = m?.centerY ?? 415;
    const w = m?.width ?? 1231;
    const h = m?.height ?? 1025;
    const left = Math.max(4, Math.min(96, ((wx + cx) / w) * 100));
    const top = Math.max(4, Math.min(96, ((wy + cy) / h) * 100));
    return { left: `${left}%`, top: `${top}%` };
  };

  const totalOnline = createMemo(() => remotePlayers().length + 1);

  return (
    <div class="ms-app">
      <canvas
        ref={canvasRef}
        class="ms-canvas"
        onClick={() => {
          // Clicking NPC Maya area triggers a fresh dialogue line
          const line =
            MAYA_DIALOGUES[Math.floor(Math.random() * MAYA_DIALOGUES.length)];
          npcBubble = {
            text: line,
            expiresAt: Date.now() + 6000,
          };
        }}
      />

      <audio
        ref={bgmAudioRef}
        src="/api/maple/GMS/93/music/Bgm00/FloralLife"
        loop
        preload="none"
      />

      {/* Top-Left MiniMap & Channel Selector Window */}
      <div class="ms-window ms-minimap-panel">
        <div class="ms-window-titlebar">
          <span>MINI MAP</span>
          <span class="ms-status-pill">
            <span
              class={`ms-status-dot ${connected() ? '' : 'offline'}`}
              title={connected() ? 'Connected' : 'Reconnecting...'}
            />
            Ch. {channel()}
          </span>
        </div>

        <div class="ms-minimap-subbar">
          <div class="ms-map-title">
            <span class="ms-map-street">
              {mapData()?.streetName || 'Henesys'}
            </span>
            <span class="ms-map-name">
              {mapData()?.name || "Maya's House"}
            </span>
          </div>

          <select
            class="ms-channel-select"
            value={channel()}
            onChange={(e) => handleChannelChange(e.currentTarget.value)}
            aria-label="Select Channel"
          >
            <For each={CHANNELS}>
              {(ch) => <option value={ch}>Channel {ch}</option>}
            </For>
          </select>
        </div>

        <div class="ms-minimap-canvas-wrap">
          <div class="ms-minimap-img-box">
            <Show when={mapData()?.miniMap?.canvas}>
              <img
                src={`data:image/png;base64,${mapData()!.miniMap.canvas}`}
                alt="MiniMap"
                class="ms-minimap-img ms-pixelated"
              />
            </Show>

            {/* NPC Maya Dot (Green) */}
            <div
              class="ms-minimap-dot ms-dot-npc"
              style={worldToMinimapPct(-17, 39)}
              title="NPC: Maya"
            />

            {/* Remote Players (Red) */}
            <For each={remotePlayers()}>
              {(p) => (
                <div
                  class="ms-minimap-dot ms-dot-other"
                  style={worldToMinimapPct(p.x, p.y)}
                  title={p.name}
                />
              )}
            </For>

            {/* Self Dot (Yellow) */}
            <div
              class="ms-minimap-dot ms-dot-self"
              style={worldToMinimapPct(physicsState.x, physicsState.y)}
              title={character().name}
            />
          </div>
        </div>

        <div class="ms-minimap-footer">
          <span>👥 {totalOnline()} in Channel {channel()}</span>
          <span>ID: 100000001</span>
        </div>
      </div>

      {/* Top-Right Quick Toolbar */}
      <div class="ms-topright-panel">
        <div class="ms-toolbar">
          <button
            type="button"
            class="ms-btn ms-btn-gold"
            onClick={() => setCharModalOpen(true)}
          >
            👕 Character / Import JSON
          </button>
          <button
            type="button"
            class="ms-btn"
            onClick={() => {
              const randomized = generateRandomCharacter(character().name);
              randomized.position = {
                x: Math.round(physicsState.x),
                y: Math.round(physicsState.y),
              };
              handleSaveCharacter(randomized);
            }}
          >
            🎲 Randomize
          </button>
          <button
            type="button"
            class="ms-btn"
            onClick={() => setBgmEnabled((v) => !v)}
          >
            {bgmEnabled() ? '🔊 BGM: On' : '🔇 BGM: Off'}
          </button>
          <Show when={isLocalDevHost()}>
            <button
              type="button"
              class="ms-btn"
              onClick={() => setShowFootholds((v) => !v)}
            >
              {showFootholds() ? '📐 Footholds: On' : '📐 Footholds'}
            </button>
          </Show>
          <button
            type="button"
            class="ms-btn"
            onClick={() => setShowControls((v) => !v)}
          >
            ⌨️ Controls
          </button>
        </div>

        <Show when={showControls()}>
          <div class="ms-window ms-controls-card">
            <div class="ms-controls-row">
              <span>Move Left / Right</span>
              <span class="ms-key">← / →</span>
            </div>
            <div class="ms-controls-row">
              <span>Climb Ladder</span>
              <span class="ms-key">↑ / ↓</span>
            </div>
            <div class="ms-controls-row">
              <span>Jump</span>
              <span class="ms-key">Alt / Space</span>
            </div>
            <div class="ms-controls-row">
              <span>Jump Down Platform</span>
              <span class="ms-key">↓ + Alt</span>
            </div>
            <div class="ms-controls-row">
              <span>Prone / Sit</span>
              <span class="ms-key">↓ / X</span>
            </div>
            <div class="ms-controls-row">
              <span>Facial Expressions</span>
              <span class="ms-key">F1 – F7</span>
            </div>
            <div class="ms-controls-row">
              <span>Chat</span>
              <span class="ms-key">Enter</span>
            </div>
          </div>
        </Show>
      </div>

      {/* Bottom HUD: Chat Box & Emotes */}
      <div class="ms-bottom-hud">
        <div class="ms-window ms-chat-panel">
          <div ref={chatHistoryRef} class="ms-chat-history">
            <For each={messages()}>
              {(msg) => (
                <div class={`ms-chat-line ${msg.system ? 'system' : ''}`}>
                  <Show
                    when={!msg.system}
                    fallback={<span>[Notice] {msg.text}</span>}
                  >
                    <span
                      class={`ms-chat-author ${msg.userId === selfId() ? 'self' : ''}`}
                    >
                      {msg.userName}
                    </span>
                    <span>: {msg.text}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>

          <form class="ms-chat-input-row" onSubmit={handleSendChat}>
            <span class="ms-chat-badge">To All</span>
            <input
              ref={chatInputRef}
              type="text"
              class="ms-chat-input"
              maxLength={200}
              value={chatText()}
              onInput={(e) => setChatText(e.currentTarget.value)}
              placeholder="Press Enter to chat in Maya's House..."
            />
            <button type="submit" class="ms-btn ms-btn-blue">
              Send
            </button>
          </form>
        </div>

        <div class="ms-action-dock">
          <div class="ms-window ms-emote-bar">
            <button
              type="button"
              class={`ms-emote-btn ${isSitting() ? 'active' : ''}`}
              onClick={() => {
                physicsState.sitting = !physicsState.sitting;
                setIsSitting(physicsState.sitting);
              }}
              title="Sit on Chair (X)"
            >
              <span class="ms-emote-fkey">X</span>
              <span>🪑 Sit</span>
            </button>
            <For each={EMOTE_HOTKEYS}>
              {(em) => (
                <button
                  type="button"
                  class={`ms-emote-btn ${activeEmotion() === em.emotion ? 'active' : ''}`}
                  onClick={() => triggerEmotion(em.emotion)}
                  title={`${em.label} (${em.key})`}
                >
                  <span class="ms-emote-fkey">{em.key}</span>
                  <span>{em.label}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </div>

      {/* Another tab of this browser took the character over */}
      <Show when={sessionReplaced()}>
        <div class="ms-session-overlay">
          <div class="ms-window ms-session-card">
            <div class="ms-window-titlebar">
              <span>PLAYING IN ANOTHER TAB</span>
            </div>
            <div class="ms-session-body">
              <p class="ms-session-text">
                Your character is being played in another tab of this browser.
              </p>
              <button
                type="button"
                class="ms-btn ms-btn-gold"
                onClick={handleReclaimSession}
              >
                Play in this tab
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* Character & maples.im JSON Modal */}
      <Show when={charModalOpen()}>
        <CharacterModal
          character={character()}
          onSave={handleSaveCharacter}
          onClose={() => setCharModalOpen(false)}
        />
      </Show>
    </div>
  );
}
