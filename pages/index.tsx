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
  stepPhysics,
} from '../src/engine/physics';
import {
  type ActiveChatBubble,
  preloadMapAssets,
  renderScene,
} from '../src/engine/renderer';
import {
  preloadCharacterCommonFrames,
  preloadCharacterEmotionFrames,
} from '../src/engine/sprites';
import '../src/styles/maple.css';
import type {
  CharacterEmotion,
  ChatMessage,
  MapleMapData,
  MapleSimCharacter,
  PlayerState,
} from '../src/types/maple';

const STORAGE_CHAR_KEY = 'mayas_house_character_v1';
const STORAGE_CHANNEL_KEY = 'mayas_house_channel_v1';
const CHANNELS = Array.from({ length: 19 }, (_, i) => String(i + 1));

const EMOTE_HOTKEYS: Array<{
  key: string;
  emotion: CharacterEmotion;
  label: string;
}> = [
  { key: 'F1', emotion: 'hit', label: 'Hit' },
  { key: 'F2', emotion: 'smile', label: 'Smile' },
  { key: 'F3', emotion: 'troubled', label: 'Troubled' },
  { key: 'F4', emotion: 'cry', label: 'Cry' },
  { key: 'F5', emotion: 'angry', label: 'Angry' },
  { key: 'F6', emotion: 'bewildered', label: 'Bewildered' },
  { key: 'F7', emotion: 'stunned', label: 'Stunned' },
];

const MAYA_DIALOGUES = [
  '*Cough... Cough...* Ah... My head... Can somebody help me...?',
  '*Cough, cough...* I need the Weird Medicine from Teo in Lith Harbor...',
  'Thanks for stopping by my house in Henesys. Stay and chat awhile!',
];

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

export default function MayasHousePage() {
  const [channel, setChannel] = createSignal<string>('1');
  const [connected, setConnected] = createSignal(false);
  const [selfId, setSelfId] = createSignal('local');
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

  const connectToChannel = (targetChannel: string) => {
    if (activeSocket) {
      activeSocket.close();
      activeSocket = null;
    }
    remotePlayerMap.clear();
    syncRemoteList();
    setConnected(false);

    const sock = connect('/channel/:channel', {
      params: { channel: targetChannel },
    });
    activeSocket = sock;

    sock.on('open', () => {
      setConnected(true);
      const curChar = character();
      sock.send({
        type: 'player.join',
        name: curChar.name || 'Mapler',
        character: curChar,
        x: Math.round(physicsState.x),
        y: Math.round(physicsState.y),
        action: physicsState.action,
        emotion: activeEmotion(),
        flipX: physicsState.flipX,
        footholdId: physicsState.footholdId,
      });
    });

    sock.on('close', () => {
      setConnected(false);
    });

    sock.on('message', (event) => {
      if (event.type === 'channel.init') {
        setSelfId(event.selfId);
        remotePlayerMap.clear();
        for (const p of event.players) {
          if (p.id !== event.selfId) {
            remotePlayerMap.set(p.id, p);
            preloadCharacterCommonFrames(p.character);
          }
        }
        syncRemoteList();
        setMessages(event.messages);
        appendSystemMessage(
          `Connected to Maya's House — Channel ${event.channel}.`,
        );
        return;
      }

      if (event.type === 'player.joined') {
        if (event.player.id === selfId()) return;
        remotePlayerMap.set(event.player.id, event.player);
        preloadCharacterCommonFrames(event.player.character);
        syncRemoteList();
        return;
      }

      if (event.type === 'player.moved') {
        const existing = remotePlayerMap.get(event.id);
        if (existing) {
          existing.x = event.x;
          existing.y = event.y;
          existing.vx = event.vx;
          existing.vy = event.vy;
          existing.action = event.action;
          existing.flipX = event.flipX;
          existing.footholdId = event.footholdId;
          existing.updatedAt = event.updatedAt;
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
        remotePlayerMap.set(event.player.id, event.player);
        preloadCharacterCommonFrames(event.player.character);
        syncRemoteList();
        return;
      }

      if (event.type === 'player.left') {
        remotePlayerMap.delete(event.id);
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

    // Load saved character & channel
    const savedChar = loadSavedCharacter();
    setCharacter(savedChar);
    physicsState.x = Math.max(-350, Math.min(350, savedChar.position?.x || 0));
    physicsState.y = 274;
    physicsState.flipX = Boolean(savedChar.flipX);
    cameraX = physicsState.x;
    preloadCharacterCommonFrames(savedChar);

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
      if (map) {
        stepPhysics(physicsState, inputState, map, dt, nowWall);
        if (isSitting() !== physicsState.sitting) {
          setIsSitting(physicsState.sitting);
        }
      }

      // Smoothly interpolate remote players slightly along velocity
      for (const remote of remotePlayerMap.values()) {
        if (remote.action === 'walk1' || remote.action === 'jump') {
          remote.x += remote.vx * dt * 0.35;
        }
      }

      // Smooth camera tracking clamped to Maya's House bounds
      const targetCamX = Math.max(-180, Math.min(260, physicsState.x));
      const targetCamY = Math.max(20, Math.min(165, physicsState.y - 75));
      cameraX += (targetCamX - cameraX) * Math.min(1, dt * 7);
      cameraY += (targetCamY - cameraY) * Math.min(1, dt * 7);

      // Broadcast movement to channel if position or action changed
      const movedDist =
        Math.abs(physicsState.x - lastSentX) +
        Math.abs(physicsState.y - lastSentY);
      const stateChanged =
        physicsState.action !== lastSentAction ||
        physicsState.flipX !== lastSentFlipX;

      if (
        activeSocket &&
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
        }
      }

      animId = requestAnimationFrame(frameLoop);
    };

    animId = requestAnimationFrame(frameLoop);

    onCleanup(() => {
      cancelAnimationFrame(animId);
      clearInterval(mayaInterval);
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
    if (nextChannel === channel()) return;
    setChannel(nextChannel);
    try {
      localStorage.setItem(STORAGE_CHANNEL_KEY, nextChannel);
    } catch {
      // Ignore storage error
    }
    connectToChannel(nextChannel);
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
    preloadCharacterCommonFrames(updated);
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
          <button
            type="button"
            class="ms-btn"
            onClick={() => setShowFootholds((v) => !v)}
          >
            {showFootholds() ? '📐 Footholds: On' : '📐 Footholds'}
          </button>
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
