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

export function loadCachedImage(url: string): CachedImage {
  const existing = imageCache.get(url);
  if (existing) return existing;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  const entry: CachedImage = {
    img,
    loaded: false,
    failed: false,
    retries: 0,
  };

  img.onload = () => {
    entry.loaded = true;
    entry.failed = false;
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
    }
  };
  img.src = url;
  imageCache.set(url, entry);
  return entry;
}

export function preloadCharacterCommonFrames(character: MapleSimCharacter): void {
  const commonActions: Array<{ action: CharacterAction; frames: number[] }> = [
    { action: 'stand1', frames: [0, 1, 2] },
    { action: 'walk1', frames: [0, 1, 2, 3] },
    { action: 'jump', frames: [0] },
    { action: 'prone', frames: [0] },
    { action: 'sit', frames: [0] },
    { action: 'ladder', frames: [0, 1] },
  ];

  for (const { action, frames } of commonActions) {
    for (const frame of frames) {
      const url = buildCharacterSpriteUrl(character, action, frame, 'default');
      loadCachedImage(url);
    }
  }
}

export function preloadCharacterEmotionFrames(
  character: MapleSimCharacter,
  emotion: CharacterEmotion,
): void {
  const commonActions: Array<{ action: CharacterAction; frames: number[] }> = [
    { action: 'stand1', frames: [0, 1, 2] },
    { action: 'walk1', frames: [0, 1, 2, 3] },
    { action: 'jump', frames: [0] },
    { action: 'prone', frames: [0] },
    { action: 'sit', frames: [0] },
  ];

  for (const { action, frames } of commonActions) {
    for (const frame of frames) {
      loadCachedImage(buildCharacterSpriteUrl(character, action, frame, emotion));
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
