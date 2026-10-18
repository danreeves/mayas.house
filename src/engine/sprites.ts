import { buildCharacterSpriteUrl } from '../character/parser';
import type {
  CharacterAction,
  CharacterEmotion,
  MapleSimCharacter,
} from '../types/maple';

interface CachedImage {
  img: HTMLImageElement;
  loaded: boolean;
  failed: boolean;
  retries: number;
  settledCallbacks: Array<() => void>;
}

const imageCache = new Map<string, CachedImage>();

export const ACTION_FRAME_COUNTS: Record<CharacterAction, number> = {
  stand1: 3,
  stand2: 3,
  walk1: 4,
  walk2: 4,
  jump: 1,
  prone: 1,
  ladder: 2,
  rope: 2,
  sit: 1,
  alert: 3,
};

export const ACTION_FRAME_DURATION_MS: Record<CharacterAction, number> = {
  stand1: 500,
  stand2: 500,
  walk1: 180,
  walk2: 180,
  jump: 500,
  prone: 500,
  ladder: 260,
  rope: 260,
  sit: 500,
  alert: 400,
};

// Every animation the game can draw for a character, with the frame indices
// getCharacterFrameImage cycles through. Ordered by how likely each is to be seen, so
// the poses in play arrive first. Ladder/rope always render with a default face, so
// they never need a per-emotion copy.
const ACTION_PRELOADS: Array<{ action: CharacterAction; frames: number[] }> = [
  { action: 'stand1', frames: [0, 1, 2] },
  { action: 'walk1', frames: [0, 1, 2, 3] },
  { action: 'jump', frames: [0] },
  { action: 'prone', frames: [0] },
  { action: 'sit', frames: [0] },
  { action: 'ladder', frames: [0, 1] },
  { action: 'rope', frames: [0, 1] },
  { action: 'stand2', frames: [0, 1, 2] },
  { action: 'walk2', frames: [0, 1, 2, 3] },
  { action: 'alert', frames: [0, 1, 2] },
];

// Poses an emoting character can be caught in while the expression is up: an emote
// lasts a few seconds, and the player can be walking, jumping, sitting or prone in it.
const EMOTE_PRELOADS: Array<{ action: CharacterAction; frames: number[] }> = [
  { action: 'stand1', frames: [0, 1, 2] },
  { action: 'walk1', frames: [0, 1, 2, 3] },
  { action: 'jump', frames: [0] },
  { action: 'prone', frames: [0] },
  { action: 'sit', frames: [0] },
];

// Emotions the room's emote bar can trigger. The page builds its hotkey list from
// this, so the two can never drift apart.
export const EMOTE_PALETTE: CharacterEmotion[] = [
  'hit',
  'smile',
  'troubled',
  'cry',
  'angry',
  'bewildered',
  'stunned',
];

// The render API draws every frame on demand, so warming a character means ~95
// images. Trickling them through a small queue keeps the poses that are on screen
// right now ahead of the emote variants, instead of firing everything at once.
const MAX_CONCURRENT_PRELOADS = 4;
const preloadQueues: { high: string[]; low: string[] } = { high: [], low: [] };
const queuedPreloads = new Set<string>();
let activePreloads = 0;

function pumpPreloadQueue(): void {
  while (activePreloads < MAX_CONCURRENT_PRELOADS) {
    const url = preloadQueues.high.shift() ?? preloadQueues.low.shift();
    if (!url) return;
    queuedPreloads.delete(url);

    const cached = imageCache.get(url);
    if (cached && (cached.loaded || cached.failed)) continue;

    activePreloads += 1;
    loadCachedImage(url, () => {
      activePreloads -= 1;
      pumpPreloadQueue();
    });
  }
}

function enqueuePreload(url: string, priority: 'high' | 'low'): void {
  const cached = imageCache.get(url);
  if (cached && (cached.loaded || cached.failed)) return;
  if (queuedPreloads.has(url)) return;

  queuedPreloads.add(url);
  preloadQueues[priority].push(url);
  pumpPreloadQueue();
}

/**
 * @param onSettled Called once the image has loaded or exhausted its retries.
 */
export function loadCachedImage(
  url: string,
  onSettled?: () => void,
): CachedImage {
  const existing = imageCache.get(url);
  if (existing) {
    if (onSettled) {
      if (existing.loaded || existing.failed) {
        // Never call back synchronously: callers pump queues from the callback.
        setTimeout(onSettled, 0);
      } else {
        existing.settledCallbacks.push(onSettled);
      }
    }
    return existing;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  const entry: CachedImage = {
    img,
    loaded: false,
    failed: false,
    retries: 0,
    settledCallbacks: onSettled ? [onSettled] : [],
  };

  const settle = () => {
    for (const callback of entry.settledCallbacks.splice(0)) callback();
  };

  img.onload = () => {
    entry.loaded = true;
    entry.failed = false;
    settle();
  };
  img.onerror = () => {
    if (entry.retries < 4) {
      entry.retries += 1;
      setTimeout(() => {
        const sep = url.includes('?') ? '&' : '?';
        img.src = `${url}${sep}_retry=${entry.retries}`;
      }, 1200 * entry.retries);
    } else {
      entry.failed = true;
      settle();
    }
  };
  img.src = url;
  imageCache.set(url, entry);
  return entry;
}

/**
 * Warm everything a character can be drawn with: every animation frame up front, then
 * the emote variants the emote bar can trigger. Called when a character spawns and
 * again whenever it changes, so animations and emotes never pop in mid-play.
 */
export function preloadCharacterFrames(character: MapleSimCharacter): void {
  for (const { action, frames } of ACTION_PRELOADS) {
    for (const frame of frames) {
      enqueuePreload(
        buildCharacterSpriteUrl(character, action, frame, 'default'),
        'high',
      );
    }
  }

  for (const emotion of EMOTE_PALETTE) {
    for (const { action, frames } of EMOTE_PRELOADS) {
      for (const frame of frames) {
        enqueuePreload(
          buildCharacterSpriteUrl(character, action, frame, emotion),
          'low',
        );
      }
    }
  }
}

/**
 * Warm the frames for a single emotion, e.g. one someone just used that is not in the
 * room's emote palette.
 */
export function preloadCharacterEmotionFrames(
  character: MapleSimCharacter,
  emotion: CharacterEmotion,
): void {
  if (emotion === 'default') return;

  for (const { action, frames } of EMOTE_PRELOADS) {
    for (const frame of frames) {
      enqueuePreload(
        buildCharacterSpriteUrl(character, action, frame, emotion),
        'low',
      );
    }
  }
}

export function getCharacterFrameImage(
  character: MapleSimCharacter,
  action: CharacterAction,
  emotion: CharacterEmotion,
  nowMs: number,
  isMovingOnLadder = false,
): HTMLImageElement | null {
  const frameCount = ACTION_FRAME_COUNTS[action] || 1;
  const frameDuration = ACTION_FRAME_DURATION_MS[action] || 400;

  let frameIndex = 0;
  if (action === 'stand1' || action === 'stand2') {
    // MapleStory stand1 ping-pongs 0 -> 1 -> 2 -> 1
    const cycle = [0, 1, 2, 1];
    frameIndex = cycle[Math.floor(nowMs / frameDuration) % cycle.length];
  } else if (action === 'ladder' || action === 'rope') {
    frameIndex = isMovingOnLadder ? Math.floor(nowMs / frameDuration) % 2 : 0;
  } else if (frameCount > 1) {
    frameIndex = Math.floor(nowMs / frameDuration) % frameCount;
  }

  const primaryUrl = buildCharacterSpriteUrl(character, action, frameIndex, emotion);
  const primary = loadCachedImage(primaryUrl);
  if (primary.loaded) {
    return primary.img;
  }

  // Keep the exact same action and animation frame index using default emotion while the emote frame loads
  if (emotion !== 'default') {
    const sameFrameDefault = loadCachedImage(
      buildCharacterSpriteUrl(character, action, frameIndex, 'default'),
    );
    if (sameFrameDefault.loaded) {
      return sameFrameDefault.img;
    }
  }

  // Fallback to frame 0 of the SAME action (never swap to stand1, otherwise a
  // sitting/climbing character would visually stand up while a frame loads)
  if (frameIndex !== 0) {
    const frame0Emote = loadCachedImage(
      buildCharacterSpriteUrl(character, action, 0, emotion),
    );
    if (frame0Emote.loaded) return frame0Emote.img;
  }

  const sameActionDefault = loadCachedImage(
    buildCharacterSpriteUrl(character, action, 0, 'default'),
  );
  if (sameActionDefault.loaded) {
    return sameActionDefault.img;
  }

  const standFallback = loadCachedImage(
    buildCharacterSpriteUrl(character, 'stand1', 0, 'default'),
  );
  if (standFallback.loaded) {
    return standFallback.img;
  }

  return null;
}
