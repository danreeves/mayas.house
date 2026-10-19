import type { CharacterAction, MapleMapData, PlayerState } from '../types/maple';
import { getCharacterFrameImage, loadCachedImage } from './sprites';

// ---------------------------------------------------------------------------
// Map artwork
//
// The map is composed from its own WZ data instead of a third-party baked render.
// scripts/harvest-map.mjs walks Map/Map/Map1/<id>.img once and writes a compact
// JSON (public/map-data/<region>-<version>-<mapId>.json) holding the back entries,
// every layer's tiles and objects, and the sprite origins the client anchors them
// by. Pointing the page at a different file is all it takes to change client
// version, so nothing below is specific to one version of one map.
// ---------------------------------------------------------------------------

export interface MapFrame {
  originX: number;
  originY: number;
  delay: number;
}

export interface MapBackEntry {
  bS: string;
  no: number;
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** 0 draw once, 1 tile across, 2 tile down, 3 tile both, 4 tile across. */
  type: number;
  /** 0 = behind the map layers, 1 = in front of them. */
  front: number;
  ani: number;
  cx: number;
  cy: number;
  a: number;
  flipX: boolean;
  originX: number;
  originY: number;
}

export interface MapObjEntry {
  oS: string;
  l0: string;
  l1: string;
  l2: string;
  x: number;
  y: number;
  z: number;
  flipX: boolean;
  frames: MapFrame[];
}

export interface MapTileEntry {
  u: string;
  no: number;
  x: number;
  y: number;
  z: number;
  originX: number;
  originY: number;
}

export interface MapLayerData {
  index: number;
  tileSet: string | null;
  tiles: MapTileEntry[];
  obj: MapObjEntry[];
}

export interface MapArtData {
  region: string;
  version: number;
  mapId: number;
  back: MapBackEntry[];
  layers: MapLayerData[];
}

let mapArt: MapArtData | null = null;

export function setMapArt(data: MapArtData | null): void {
  mapArt = data;
}

export function getMapArt(): MapArtData | null {
  return mapArt;
}

function wzImageBase(): string {
  return `/api/maple/wz/img/${mapArt ? mapArt.region : 'GMS'}/${mapArt ? mapArt.version : 93}`;
}

export function backImageUrl(entry: MapBackEntry): string {
  return `${wzImageBase()}/Map/Back/${entry.bS}.img/back/${entry.no}`;
}

export function objImageUrl(entry: MapObjEntry, frame: number): string {
  return `${wzImageBase()}/Map/Obj/${entry.oS}.img/${entry.l0}/${entry.l1}/${entry.l2}/${frame}`;
}

export function tileImageUrl(layer: MapLayerData, tile: MapTileEntry): string {
  return `${wzImageBase()}/Map/Tile/${layer.tileSet}.img/${tile.u}/${tile.no}`;
}

// How much bigger than "one world pixel per CSS pixel" the view should be.
//
// This is a whole number so that the scaling stays on whole square pixels: the page
// sizes the canvas to `viewport / VIEW_ZOOM` and CSS magnifies it by exactly
// VIEW_ZOOM with nearest-neighbour filtering, turning every world pixel into a square
// VIEW_ZOOM x VIEW_ZOOM block of screen pixels. A fractional zoom makes some source
// pixels one screen pixel wide and others two, which is what leaves pixel art looking
// soft.
//
// The renderer itself always draws at 1:1 into the canvas, so the world is composed on
// whole source pixels and the browser scales the finished bitmap.
//
// Text is the exception: glyphs are not pixel art, so name tags and chat balloons are
// drawn on a second canvas at the page's own pixel size instead of being magnified with
// the artwork (see renderScene).
export const VIEW_ZOOM = 2;
// World-space (canvas-pixel) shift that lowers the camera point below the middle of the
// view, which frames the house the way the game client does. At VIEW_ZOOM = 2 one canvas
// pixel is two screen pixels, so this reads as a 120 screen-pixel drop.
export const WORLD_VERTICAL_BIAS = 60;

export interface ActiveChatBubble {
  text: string;
  expiresAt: number;
}

// Individually switchable parts of the composition, used by the local-only layer
// panel to isolate a single piece of scenery while tuning it. Keys are built from
// whatever the harvested map actually contains, and anything absent counts as
// visible so a new version needs no code changes to show up in full.
export type RenderLayerVisibility = Record<string, boolean>;

export const GROUND_EXTENSION_KEY = 'groundExtension';
export const PORTALS_LAYER_KEY = 'portals';
export const NPC_LAYER_KEY = 'npc';
export const PLAYERS_LAYER_KEY = 'players';
export const backLayerKey = (index: number) => `back:${index}`;
export const mapLayerKey = (index: number) => `layer:${index}`;

export function isLayerVisible(
  visibility: RenderLayerVisibility,
  key: string,
): boolean {
  return visibility[key] !== false;
}

export interface RenderSceneState {
  mapData: MapleMapData | null;
  selfPlayer: PlayerState;
  remotePlayers: Map<string, PlayerState>;
  chatBubbles: Map<string, ActiveChatBubble>;
  npcBubble: ActiveChatBubble | null;
  showFootholds: boolean;
  layers: RenderLayerVisibility;
  cameraX: number;
  cameraY: number;
  isMovingOnLadder: boolean;
}

const NPC_MAYA_URL = '/api/maple/GMS/93/npc/1012101/render/stand/0';
const PORTAL_FRAME_URLS = [
  '/api/maple/wz/img/GMS/93/Map/MapHelper.img/portal/game/pv/0',
  '/api/maple/wz/img/GMS/93/Map/MapHelper.img/portal/game/pv/1',
  '/api/maple/wz/img/GMS/93/Map/MapHelper.img/portal/game/pv/2',
  '/api/maple/wz/img/GMS/93/Map/MapHelper.img/portal/game/pv/3',
  '/api/maple/wz/img/GMS/93/Map/MapHelper.img/portal/game/pv/4',
  '/api/maple/wz/img/GMS/93/Map/MapHelper.img/portal/game/pv/5',
  '/api/maple/wz/img/GMS/93/Map/MapHelper.img/portal/game/pv/6',
  '/api/maple/wz/img/GMS/93/Map/MapHelper.img/portal/game/pv/7',
];

const CHAT_BALLOON_PARTS = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se', 'arrow'] as const;
type ChatBalloonPart = (typeof CHAT_BALLOON_PARTS)[number];

function getBalloonPartUrl(part: ChatBalloonPart): string {
  return `/api/maple/wz/img/GMS/93/UI/ChatBalloon.img/0/${part}`;
}

export function preloadMapAssets(): void {
  if (!mapArt) return;
  for (const entry of mapArt.back) {
    if (entry.bS) loadCachedImage(backImageUrl(entry));
  }
  for (const layer of mapArt.layers) {
    for (const obj of layer.obj) {
      for (let frame = 0; frame < obj.frames.length; frame++) {
        loadCachedImage(objImageUrl(obj, frame));
      }
    }
    if (!layer.tileSet) continue;
    for (const tile of layer.tiles) {
      loadCachedImage(tileImageUrl(layer, tile));
    }
  }
  loadCachedImage(NPC_MAYA_URL);
  for (const url of PORTAL_FRAME_URLS) {
    loadCachedImage(url);
  }
  for (const part of CHAT_BALLOON_PARTS) {
    loadCachedImage(getBalloonPartUrl(part));
  }
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: RenderSceneState,
  nowMs: number,
  overlay?: CanvasRenderingContext2D | null,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  const layers = state.layers;

  // Name tags and chat balloons are glyphs rather than pixel art. Drawn into the 1:1
  // world canvas they get magnified along with the artwork and the strokes land on
  // uneven pixels, which is what makes the text look soft. They are drawn onto the
  // overlay instead: same world coordinates, but rasterised at the page's real pixel
  // size. Without one, text falls back to the world canvas.
  const textCtx = overlay
    ? prepareTextOverlay(overlay, width, height, state.cameraX, state.cameraY)
    : ctx;

  // Visible world rectangle, used to tile the repeating back entries and to keep the
  // ground extended across the whole view.
  const worldLeft = state.cameraX - width / 2 - 2;
  const worldRight = state.cameraX + width / 2 + 2;
  const worldTop = state.cameraY - WORLD_VERTICAL_BIAS - height / 2 - 2;
  const worldBottom = state.cameraY + WORLD_VERTICAL_BIAS + height / 2 + 2;

  // Flat fill first so the canvas is never transparent while the artwork loads.
  drawSkyGradient(ctx, width, height);

  // Convert world coordinates to canvas coordinates. The camera point is pinned to
  // the canvas centre shifted down by the vertical bias. This is a 1:1 mapping: the
  // magnification happens in CSS (see VIEW_ZOOM), so every draw here stays on whole
  // canvas pixels.
  ctx.save();
  ctx.translate(
    Math.round(width / 2 - state.cameraX),
    Math.round(height / 2 + WORLD_VERTICAL_BIAS - state.cameraY),
  );

  const art = mapArt;
  const backBounds: WorldBounds = {
    worldLeft,
    worldRight,
    worldTop,
    worldBottom,
    cameraX: state.cameraX,
    cameraY: state.cameraY,
  };

  if (!art) {
    // Loading placeholder for floor
    ctx.fillStyle = '#5c8a32';
    ctx.fillRect(-450, 274, 1080, 40);
  } else {
    // 1. Sky and the backgrounds that sit behind the map layers.
    art.back.forEach((entry, index) => {
      if (entry.front !== 0) return;
      if (!isLayerVisible(layers, backLayerKey(index))) return;
      drawBackEntry(ctx, entry, backBounds, nowMs);
    });

    // 2. The map's own layers, 0 through 7. Objects and tiles share one z order, so
    // a layer's whole content is interleaved rather than grouped.
    for (const layer of art.layers) {
      if (!isLayerVisible(layers, mapLayerKey(layer.index))) continue;
      drawLayer(ctx, layer, backBounds, layers, nowMs);
    }

    // 3. Backgrounds flagged "front" sit in front of the layers instead.
    art.back.forEach((entry, index) => {
      if (entry.front === 0) return;
      if (!isLayerVisible(layers, backLayerKey(index))) return;
      drawBackEntry(ctx, entry, backBounds, nowMs);
    });
  }

  // 4. Draw visible portals only (type !== 0; type 0 'sp' is an invisible spawn point)
  if (isLayerVisible(layers, PORTALS_LAYER_KEY) && state.mapData?.portals) {
    const portalFrameIdx = Math.floor(nowMs / 120) % PORTAL_FRAME_URLS.length;
    const portalImg = loadCachedImage(PORTAL_FRAME_URLS[portalFrameIdx]);
    if (portalImg.loaded) {
      for (const portal of state.mapData.portals) {
        if (portal && portal.type !== 0) {
          ctx.drawImage(
            portalImg.img,
            portal.x - Math.round(portalImg.img.width / 2),
            portal.y - portalImg.img.height + 6,
          );
        }
      }
    }
  }

  // 4. Draw NPC Maya at (-17, 39)
  const mayaImg = loadCachedImage(NPC_MAYA_URL);
  if (isLayerVisible(layers, NPC_LAYER_KEY) && mayaImg.loaded) {
    const mx = -17 - Math.round(mayaImg.img.width / 2);
    const my = 39 - mayaImg.img.height;
    ctx.drawImage(mayaImg.img, mx, my);
    drawMapleNameTag(textCtx, -17, 39, 'Maya', '#ffe600', 'rgba(0, 0, 0, 0.72)');

    if (state.npcBubble && state.npcBubble.expiresAt > nowMs) {
      drawSpeechBubble(ctx, textCtx, -17, my - 10, 'Maya', state.npcBubble.text, true);
    }
  }

  // 5. Optional Foothold & Ladder Debug Overlay
  if (state.showFootholds && state.mapData) {
    ctx.lineWidth = 2;
    for (const fh of Object.values(state.mapData.footholds)) {
      ctx.strokeStyle = fh.x1 < fh.x2 ? '#00ff88' : 'rgba(255, 90, 90, 0.5)';
      ctx.beginPath();
      ctx.moveTo(fh.x1, fh.y1);
      ctx.lineTo(fh.x2, fh.y2);
      ctx.stroke();
    }
    for (const lr of state.mapData.ladderRopes) {
      ctx.strokeStyle = '#ffcc00';
      ctx.beginPath();
      ctx.moveTo(lr.x, lr.y1);
      ctx.lineTo(lr.x, lr.y2);
      ctx.stroke();
    }
  }

  // 6. Draw Remote Players + Self Player (Self on top)
  if (isLayerVisible(layers, PLAYERS_LAYER_KEY)) {
    const allPlayers: Array<{ player: PlayerState; isSelf: boolean }> = [];
    for (const remote of state.remotePlayers.values()) {
      allPlayers.push({ player: remote, isSelf: false });
    }
    allPlayers.push({ player: state.selfPlayer, isSelf: true });

    for (const { player, isSelf } of allPlayers) {
      drawPlayer(
        ctx,
        textCtx,
        player,
        isSelf,
        isSelf ? state.isMovingOnLadder : Math.abs(player.vy) > 1,
        state.chatBubbles.get(player.id),
        nowMs,
      );
    }
  }

  ctx.restore();
  ctx.restore();
}

interface WorldBounds {
  worldLeft: number;
  worldRight: number;
  worldTop: number;
  worldBottom: number;
  cameraX: number;
  cameraY: number;
}

/**
 * Clears the text overlay and gives it the world transform scaled to the overlay's
 * own pixel size, so callers keep drawing in world coordinates and the glyphs come
 * out at the resolution of the page rather than of the world canvas.
 */
function prepareTextOverlay(
  overlay: CanvasRenderingContext2D,
  width: number,
  height: number,
  cameraX: number,
  cameraY: number,
): CanvasRenderingContext2D {
  const scaleX = overlay.canvas.width / width;
  const scaleY = overlay.canvas.height / height;

  overlay.setTransform(1, 0, 0, 1, 0, 0);
  overlay.clearRect(0, 0, overlay.canvas.width, overlay.canvas.height);
  // Chat balloon frames are still pixel art, so keep them hard-edged upscaled.
  overlay.imageSmoothingEnabled = false;
  overlay.setTransform(
    scaleX,
    0,
    0,
    scaleY,
    Math.round(scaleX * (width / 2 - cameraX)),
    Math.round(scaleY * (height / 2 + WORLD_VERTICAL_BIAS - cameraY)),
  );

  return overlay;
}

function drawSkyGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#5ea9e6');
  grad.addColorStop(0.55, '#a8dbf8');
  grad.addColorStop(1, '#d7f0fc');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

// A self-moving background advances rx/16 pixels per step. The client steps the world
// every 8 ms (125/s), which drifts the Henesys clouds at rx = -5 nearly 39 px/s: much
// brisker than the game reads, so the drift advances once per drawn frame (60/s,
// ~19 px/s) instead.
const MOVING_STEPS_PER_SECOND = 60;

/**
 * One back entry, drawn inside the world transform.
 *
 * The client anchors a background to the *screen* rather than the world: it sits at
 * `x + viewWidth/2 + rx * cameraX / 100`, so rx = 0 never moves at all (which is why
 * the sky can simply tile) and rx = -20 slides a fifth as fast as the ground.
 * Inside our world transform that becomes `x + cameraX * (1 + rx / 100)`.
 *
 * Vertically the same entries ride with the world instead. The client's window is
 * 768px tall; ours is whatever the page is, and a screen-anchored sky slides down
 * past the horizon as the window grows, which sinks the clouds and the tree behind
 * the house. Pinning them to the map keeps the client's framing at any page height.
 *
 * Types 4-7 are the exception: they scroll on their own at rx/16 per step and are
 * locked to the world, so the clouds drift regardless of whether anyone moves.
 */
function drawBackEntry(
  ctx: CanvasRenderingContext2D,
  entry: MapBackEntry,
  bounds: WorldBounds,
  nowMs: number,
): void {
  const cached = loadCachedImage(backImageUrl(entry));
  if (!cached.loaded || cached.img.width === 0) return;

  const img = cached.img;
  const seconds = nowMs / 1000;
  const hMoving = entry.type === 4 || entry.type === 6;
  const vMoving = entry.type === 5 || entry.type === 7;

  const left =
    entry.x +
    (hMoving
      ? (seconds * entry.rx * MOVING_STEPS_PER_SECOND) / 16
      : bounds.cameraX * (1 + entry.rx / 100)) -
    entry.originX;
  const top =
    entry.y +
    (vMoving
      ? (seconds * entry.ry * MOVING_STEPS_PER_SECOND) / 16
      : (bounds.cameraY * entry.ry) / 100) -
    entry.originY;

  // Tiling by type: 1 h, 2 v, 3 both, 4 h (self-moving), 5 v (self-moving),
  // 6 and 7 both (self-moving).
  const tileX =
    entry.type === 1 ||
    entry.type === 3 ||
    entry.type === 4 ||
    entry.type === 6 ||
    entry.type === 7;
  const tileY =
    entry.type === 2 ||
    entry.type === 3 ||
    entry.type === 5 ||
    entry.type === 6 ||
    entry.type === 7;
  const startX = tileX
    ? left + Math.floor((bounds.worldLeft - left) / img.width) * img.width
    : left;
  const startY = tileY
    ? top + Math.floor((bounds.worldTop - top) / img.height) * img.height
    : top;
  const endX = tileX ? bounds.worldRight : left + img.width;
  const endY = tileY ? bounds.worldBottom : top + img.height;

  ctx.save();
  if (entry.a < 255) ctx.globalAlpha = Math.max(0, entry.a) / 255;
  for (let y = startY; y < endY; y += img.height) {
    for (let x = startX; x < endX; x += img.width) {
      ctx.drawImage(img, Math.round(x), Math.round(y), img.width, img.height);
    }
  }
  ctx.restore();
}

/**
 * A layer's objects and tiles interleaved, matching the client: they share one z
 * order, and because a layer's WZ children are ordered `info`, `obj`, `tile` a
 * stable sort puts equal-z objects behind the tiles. That is what keeps the bush on
 * layer 1 behind the ground while the house (z 1 and up) stands in front of it.
 */
function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: MapLayerData,
  bounds: WorldBounds,
  visibility: RenderLayerVisibility,
  nowMs: number,
): void {
  const items: Array<{ z: number; draw: () => void }> = [];

  for (const obj of layer.obj) {
    items.push({ z: obj.z, draw: () => drawObject(ctx, obj, nowMs) });
  }

  if (layer.tileSet && layer.tiles.length > 0) {
    // Rows are keyed by depth and image so each keeps its own z order.
    const rows = new Map<string, MapTileEntry[]>();
    for (const tile of layer.tiles) {
      const key = `${tile.z}|${tile.y}|${tile.u}`;
      const row = rows.get(key);
      if (row) row.push(tile);
      else rows.set(key, [tile]);
    }
    const extend = isLayerVisible(visibility, GROUND_EXTENSION_KEY);
    for (const row of rows.values()) {
      row.sort((a, b) => a.x - b.x);
      items.push({
        z: row[0].z,
        draw: () => drawTileRow(ctx, layer, row, bounds, extend),
      });
    }
  }

  items.sort((a, b) => a.z - b.z);
  for (const item of items) item.draw();
}

function drawTileRow(
  ctx: CanvasRenderingContext2D,
  layer: MapLayerData,
  row: MapTileEntry[],
  bounds: WorldBounds,
  extend: boolean,
): void {
  const first = row[0];
  const last = row[row.length - 1];
  const step = row.length > 1 ? Math.round((last.x - first.x) / (row.length - 1)) : 90;
  const span = row.length * step;
  const minX = first.x;

  const drawAt = (baseX: number, mirrored: boolean) => {
    for (const tile of row) {
      const rel = tile.x - minX;
      const x = baseX + (mirrored ? span - step - rel : rel);
      drawTile(ctx, layer, tile, x);
    }
  };

  drawAt(minX, false);
  if (!extend) return;

  for (let k = 1; ; k++) {
    const start = minX - k * span;
    if (start + span < bounds.worldLeft) break;
    drawAt(start, k % 2 === 1);
  }
  for (let k = 1; ; k++) {
    const start = minX + k * span;
    if (start > bounds.worldRight) break;
    drawAt(start, k % 2 === 1);
  }
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  layer: MapLayerData,
  tile: MapTileEntry,
  x: number,
): void {
  const cached = loadCachedImage(tileImageUrl(layer, tile));
  if (!cached.loaded || cached.img.width === 0) return;
  ctx.drawImage(cached.img, x - tile.originX, tile.y - tile.originY);
}

/** One object, animating any sprite that has more than one frame. */
function drawObject(
  ctx: CanvasRenderingContext2D,
  obj: MapObjEntry,
  nowMs: number,
): void {
  const frames = obj.frames;
  if (frames.length === 0) return;
  const frame = frameIndexFor(frames, nowMs);
  const cached = loadCachedImage(objImageUrl(obj, frame));
  if (!cached.loaded || cached.img.width === 0) return;

  const x = obj.x - frames[frame].originX;
  const y = obj.y - frames[frame].originY;
  if (obj.flipX) {
    ctx.save();
    ctx.translate(x + cached.img.width, y);
    ctx.scale(-1, 1);
    ctx.drawImage(cached.img, 0, 0);
    ctx.restore();
  } else {
    ctx.drawImage(cached.img, x, y);
  }
}

function frameIndexFor(frames: MapFrame[], nowMs: number): number {
  if (frames.length < 2) return 0;
  let total = 0;
  for (const frame of frames) total += Math.max(1, frame.delay || 100);
  let t = nowMs % total;
  for (let i = 0; i < frames.length; i++) {
    t -= Math.max(1, frames[i].delay || 100);
    if (t < 0) return i;
  }
  return frames.length - 1;
}

// Sprites are requested with renderMode=FeetCenter, so the character's feet sit on
// the canvas centre and these offsets (measured against the live API per pose) say
// how far below that centre the real ground contact is. Only a chair sit and the
// prone pose contact the ground somewhere other than directly under the feet.
const GROUND_OFFSET_BY_ACTION: Partial<Record<CharacterAction, number>> = {
  prone: 3,
  sit: 8,
};
const DEFAULT_GROUND_OFFSET = 1;

// How far above the feet an average pose reaches at rest, used to keep name tags and
// chat bubbles next to the head when equipment (capes, wings, auras) inflates the
// sprite far past the character.
const HEAD_HEIGHT_BY_ACTION: Partial<Record<CharacterAction, number>> = {
  prone: 41,
  sit: 55,
  ladder: 60,
  rope: 63,
  alert: 66,
  jump: 67,
};
const DEFAULT_HEAD_HEIGHT = 69;

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  textCtx: CanvasRenderingContext2D,
  player: PlayerState,
  isSelf: boolean,
  isMovingOnLadder: boolean,
  bubble: ActiveChatBubble | undefined,
  nowMs: number,
): void {
  const px = Math.round(player.x);
  const py = Math.round(player.y);

  const sprite = getCharacterFrameImage(
    player.character,
    player.action,
    player.emotion,
    nowMs,
    isMovingOnLadder,
  );

  const headHeight =
    HEAD_HEIGHT_BY_ACTION[player.action] ?? DEFAULT_HEAD_HEIGHT;
  let headTopY = py - headHeight;

  if (sprite && sprite.width > 0 && sprite.height > 0) {
    const sw = sprite.width;
    const sh = sprite.height;
    const groundOffset =
      GROUND_OFFSET_BY_ACTION[player.action] ?? DEFAULT_GROUND_OFFSET;
    // FeetCenter: canvas centre is the foot centre, so shift the canvas down by the
    // half-height plus the measured ground offset.
    const drawY = py - Math.floor(sh / 2) - groundOffset;
    headTopY = Math.max(drawY, py - headHeight);

    ctx.save();
    ctx.translate(px, drawY);
    if (player.flipX && player.action !== 'ladder' && player.action !== 'rope') {
      ctx.scale(-1, 1);
    }
    ctx.drawImage(sprite, -Math.round(sw / 2), 0);
    ctx.restore();
  } else {
    // Subtle shadow oval while sprite loads
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(px, py - 4, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Classic MapleStory Name Tag below character's feet
  drawMapleNameTag(
    textCtx,
    px,
    py,
    player.name || 'Mapler',
    isSelf ? '#ffffff' : '#e8f4ff',
    isSelf ? 'rgba(15, 25, 45, 0.82)' : 'rgba(0, 0, 0, 0.68)',
  );

  // Classic MapleStory Chat Bubble above character's head
  if (bubble && bubble.expiresAt > nowMs) {
    drawSpeechBubble(ctx, textCtx, px, headTopY - 8, player.name, bubble.text, false);
  }
}

// --- Hard-edged glyphs ---------------------------------------------------------------
//
// `fillText` always antialiases, and a 2D context has no switch to turn that off (the CSS
// font smoothing properties only reach DOM text). So glyphs are rasterised once into a
// small offscreen canvas, their coverage is thresholded to fully opaque or fully
// transparent pixels, and the result is blitted at the caller's anchor. That gives the
// balloons and name tags the hard bitmap look of the game's own text rather than softened
// type, and nothing is resampled on the way to the screen.

type CrispTextSprite = {
  canvas: HTMLCanvasElement;
  anchorX: number;
  anchorY: number;
};

const CRISP_TEXT_CACHE_LIMIT = 256;
const crispTextCache = new Map<string, CrispTextSprite>();
let crispMeasureCanvas: HTMLCanvasElement | null = null;

function crispMeasureContext(): CanvasRenderingContext2D | null {
  if (!crispMeasureCanvas) crispMeasureCanvas = document.createElement('canvas');
  return crispMeasureCanvas.getContext('2d');
}

function crispTextSprite(
  font: string,
  color: string,
  text: string,
  scale: number,
  align: CanvasTextAlign,
  baseline: CanvasTextBaseline,
): CrispTextSprite | null {
  const key = `${font}|${color}|${text}|${scale.toFixed(4)}|${align}|${baseline}`;
  const cached = crispTextCache.get(key);
  if (cached) return cached;

  const parsed = /^(\d+(?:\.\d+)?)px\s*(.*)$/.exec(font);
  if (!parsed) return null;
  // Glyphs are rasterised at the size they are actually displayed at, so the threshold
  // works on real device pixels instead of on a magnified approximation.
  const deviceFont = `${Math.max(1, Math.round(parseFloat(parsed[1]) * scale))}px ${parsed[2]}`;

  const measure = crispMeasureContext();
  if (!measure) return null;
  measure.font = deviceFont;
  const metrics = measure.measureText(text);
  const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
  const pad = 2;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(metrics.width) + pad * 2);
  canvas.height = Math.max(1, Math.ceil(ascent + descent) + pad * 2);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.font = deviceFont;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, pad, pad + ascent);

  // Any pixel the rasteriser partly covered becomes fully opaque, everything else
  // vanishes: hard edges, no smoothing.
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let i = 3; i < data.length; i += 4) {
    data[i] = data[i] >= 128 ? 255 : 0;
  }
  ctx.putImageData(image, 0, 0);

  const sprite: CrispTextSprite = {
    canvas,
    anchorX:
      pad +
      (align === 'center'
        ? metrics.width / 2
        : align === 'right' || align === 'end'
          ? metrics.width
          : 0),
    anchorY:
      pad +
      (baseline === 'middle'
        ? (ascent + descent) / 2
        : baseline === 'top' || baseline === 'hanging'
          ? 0
          : ascent),
  };

  if (crispTextCache.size >= CRISP_TEXT_CACHE_LIMIT) crispTextCache.clear();
  crispTextCache.set(key, sprite);
  return sprite;
}

/**
 * Draws text without antialiasing, anchored exactly like `fillText` would (honouring the
 * context's current font, fill colour, textAlign, textBaseline and transform).
 */
function fillCrispText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
): void {
  const fill = ctx.fillStyle;
  const transform = ctx.getTransform();
  const scale = Math.abs(transform.a) || 1;
  const sprite =
    typeof fill === 'string' && text
      ? crispTextSprite(ctx.font, fill, text, scale, ctx.textAlign, ctx.textBaseline)
      : null;

  if (!sprite) {
    ctx.fillText(text, x, y);
    return;
  }

  const deviceX = transform.a * x + transform.c * y + transform.e;
  const deviceY = transform.b * x + transform.d * y + transform.f;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(
    sprite.canvas,
    Math.round(deviceX - sprite.anchorX),
    Math.round(deviceY - sprite.anchorY),
  );
  ctx.restore();
}

function drawMapleNameTag(
  ctx: CanvasRenderingContext2D,
  x: number,
  footY: number,
  name: string,
  textColor: string,
  bgColor: string,
): void {
  ctx.save();
  ctx.font = '12px Arial, Helvetica, sans-serif';
  const metrics = ctx.measureText(name);
  const padX = 7;
  const tagWidth = Math.ceil(metrics.width) + padX * 2;
  const tagHeight = 18;
  const tagX = Math.round(x - tagWidth / 2);
  const tagY = Math.round(footY + 4);

  ctx.fillStyle = bgColor;
  roundRect(ctx, tagX, tagY, tagWidth, tagHeight, 3);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1;
  roundRect(ctx, tagX + 0.5, tagY + 0.5, tagWidth - 1, tagHeight - 1, 3);
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fillCrispText(ctx, name, x, tagY + tagHeight / 2 + 0.5);
  ctx.restore();
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  textCtx: CanvasRenderingContext2D,
  x: number,
  bottomY: number,
  speakerName: string,
  text: string,
  _isNpc: boolean,
): void {
  ctx.save();
  ctx.font = '11px Arial, Helvetica, sans-serif';

  // Classic MapleStory chat balloon uses 7 horizontal 12px columns (84px inner, 96px total width)
  const COLS = 7;
  const COL_W = 12;
  const ROW_H = 14;
  const BORDER_W = 6;
  const BORDER_H = 6;
  const innerWidth = COLS * COL_W; // 84px
  const maxTextWidth = innerWidth - 6; // 78px (~7 '@' characters per line)

  const fullText = `${speakerName}: ${text}`;
  const lines = wrapMapleBalloonText(ctx, fullText, maxTextWidth);

  const rows = Math.max(1, lines.length);
  const bodyHeight = rows * ROW_H;
  const boxWidth = BORDER_W * 2 + innerWidth; // 96px
  const boxHeight = BORDER_H * 2 + bodyHeight;
  const boxX = Math.round(x - boxWidth / 2);
  const boxY = Math.round(bottomY - boxHeight - 7);

  const nw = loadCachedImage(getBalloonPartUrl('nw'));
  const n = loadCachedImage(getBalloonPartUrl('n'));
  const ne = loadCachedImage(getBalloonPartUrl('ne'));
  const w = loadCachedImage(getBalloonPartUrl('w'));
  const c = loadCachedImage(getBalloonPartUrl('c'));
  const e = loadCachedImage(getBalloonPartUrl('e'));
  const sw = loadCachedImage(getBalloonPartUrl('sw'));
  const s = loadCachedImage(getBalloonPartUrl('s'));
  const se = loadCachedImage(getBalloonPartUrl('se'));
  const arrow = loadCachedImage(getBalloonPartUrl('arrow'));

  const spritesLoaded =
    nw.loaded &&
    n.loaded &&
    ne.loaded &&
    w.loaded &&
    c.loaded &&
    e.loaded &&
    sw.loaded &&
    s.loaded &&
    se.loaded &&
    arrow.loaded;

  if (spritesLoaded) {
    // Top row: nw, 7x n, ne
    ctx.drawImage(nw.img, boxX, boxY);
    for (let col = 0; col < COLS; col++) {
      ctx.drawImage(n.img, boxX + BORDER_W + col * COL_W, boxY);
    }
    ctx.drawImage(ne.img, boxX + BORDER_W + innerWidth, boxY);

    // Middle rows: w, 7x c, e
    for (let row = 0; row < rows; row++) {
      const ry = boxY + BORDER_H + row * ROW_H;
      ctx.drawImage(w.img, boxX, ry);
      for (let col = 0; col < COLS; col++) {
        ctx.drawImage(c.img, boxX + BORDER_W + col * COL_W, ry);
      }
      ctx.drawImage(e.img, boxX + BORDER_W + innerWidth, ry);
    }

    // Bottom row: sw, 7x s, se
    const bottomRowY = boxY + BORDER_H + bodyHeight;
    ctx.drawImage(sw.img, boxX, bottomRowY);
    for (let col = 0; col < COLS; col++) {
      ctx.drawImage(s.img, boxX + BORDER_W + col * COL_W, bottomRowY);
    }
    ctx.drawImage(se.img, boxX + BORDER_W + innerWidth, bottomRowY);

    // Bottom pointer arrow overlapping bottom border
    ctx.drawImage(
      arrow.img,
      Math.round(x - arrow.img.width / 2),
      bottomRowY,
    );
  } else {
    // Fallback classic narrow balloon while WZ 9-slice images load
    ctx.fillStyle = '#eff1f5';
    roundRect(ctx, boxX, boxY, boxWidth, boxHeight, 4);
    ctx.fill();
    ctx.strokeStyle = '#1e242b';
    ctx.lineWidth = 1;
    roundRect(ctx, boxX + 0.5, boxY + 0.5, boxWidth - 1, boxHeight - 1, 4);
    ctx.stroke();
  }

  // Centered black text per row, matching classic MapleStory chat balloons. The frame
  // stays on the world canvas (its tiles butt up against each other on whole source
  // pixels); only the glyphs move up to the overlay, where they stay sharp.
  textCtx.fillStyle = '#000000';
  textCtx.textAlign = 'center';
  textCtx.textBaseline = 'middle';
  const centerX = boxX + Math.floor(boxWidth / 2);
  for (let i = 0; i < lines.length; i++) {
    const lineCenterY = boxY + BORDER_H + i * ROW_H + Math.floor(ROW_H / 2);
    fillCrispText(textCtx, lines[i], centerX, lineCenterY);
  }
  ctx.restore();
}

function wrapMapleBalloonText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  const pushCharWrapped = (token: string) => {
    for (const ch of token) {
      const candidate = currentLine + ch;
      if (ctx.measureText(candidate).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = ch;
      } else {
        currentLine = candidate;
      }
    }
  };

  for (const word of words) {
    if (!word) continue;
    // If a single word/token is wider than maxWidth (e.g. '@@@@@@@@@@@@' or a long IGN), break by character
    if (ctx.measureText(word).width > maxWidth) {
      if (currentLine) {
        const withSpace = `${currentLine} `;
        if (ctx.measureText(withSpace).width <= maxWidth) {
          currentLine = withSpace;
        } else {
          lines.push(currentLine);
          currentLine = '';
        }
      }
      pushCharWrapped(word);
      continue;
    }

    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }
  return lines.slice(0, 14);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
