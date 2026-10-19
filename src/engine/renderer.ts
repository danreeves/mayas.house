import type { CharacterAction, MapleMapData, PlayerState } from '../types/maple';
import { getCharacterFrameImage, loadCachedImage } from './sprites';

// World-space origin of GMS/94/map/100000001/render (1135 x 827)
export const MAP_RENDER_ORIGIN_X = -479;
export const MAP_RENDER_ORIGIN_Y = -265;
export const MAP_RENDER_WIDTH = 1135;
export const MAP_RENDER_HEIGHT = 827;

// The stone platform inside that render, in map-render pixels: the grass line starts
// at y 533 and the wall runs from x 29 to x 1108 down to y 826. The slices used to
// extend it sideways stop short of the house so no scenery gets mirrored outwards.
const GROUND_BAND_TOP = 533;
const GROUND_BAND_HEIGHT = 294;
const GROUND_SLICE_LEFT = 29;
const GROUND_SLICE_RIGHT = 1108;
const GROUND_SLICE_WIDTH = 160;

// How much bigger than "one world pixel per CSS pixel" the view should be.
//
// The renderer itself always draws at 1:1 into the canvas. The page then sizes the
// canvas to `viewport / VIEW_ZOOM` and lets CSS magnify it with nearest-neighbour
// filtering, so the world is composed on whole source pixels and the browser scales
// the finished bitmap. That keeps the artwork sharp at any zoom, including the
// fractional 1.25 used here, where scaling the canvas context instead would leave
// sprite edges and chat balloons landing between pixels.
export const VIEW_ZOOM = 1.25;
// Screen-space (canvas-pixel) shift that lowers the camera point below the middle of
// the view, which frames the house the way the game client does.
export const WORLD_VERTICAL_BIAS = 60;

export interface ActiveChatBubble {
  text: string;
  expiresAt: number;
}

export interface RenderSceneState {
  mapData: MapleMapData | null;
  selfPlayer: PlayerState;
  remotePlayers: Map<string, PlayerState>;
  chatBubbles: Map<string, ActiveChatBubble>;
  npcBubble: ActiveChatBubble | null;
  showFootholds: boolean;
  cameraX: number;
  cameraY: number;
  isMovingOnLadder: boolean;
}

const MAP_RENDER_URL = '/api/maple/GMS/93/map/100000001/render';
const BG_SKY_URL = '/api/maple/wz/img/GMS/93/Map/Back/grassySoil.img/back/0';
const BG_CLOUDS_URL = '/api/maple/wz/img/GMS/93/Map/Back/grassySoil.img/back/1';
const BG_HILLS_URL = '/api/maple/wz/img/GMS/93/Map/Back/grassySoil.img/back/2';
const BG_TREES_URL = '/api/maple/wz/img/GMS/93/Map/Back/grassySoil.img/back/3';
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

// The back entries of GMS 100000001 (background set grassySoil), in draw order.
// x/y are the sprite origins in map coordinates and rx/ry the parallax percentages.
// Types: 0 draw once, 1 tile across, 2 tile down, 3 tile both, 4 tile across.
interface BackLayer {
  url: string;
  x: number;
  y: number;
  originX: number;
  originY: number;
  rx: number;
  ry: number;
  type: number;
  underFill?: string;
}

const BACK_LAYERS: BackLayer[] = [
  // Clouds: origin is the middle of the sprite, tiled across the sky.
  {
    url: BG_CLOUDS_URL,
    x: 112,
    y: 10,
    originX: 512,
    originY: 289,
    rx: -5,
    ry: -3,
    type: 4,
  },
  // Distant grass hills. The strip carries the big tree's lower half, which the
  // client hides behind the house; it is drawn once (type 0) rather than tiled so
  // that half a tree never wanders into open ground.
  {
    url: BG_HILLS_URL,
    x: 324,
    y: 163,
    originX: 1246,
    originY: 170,
    rx: -20,
    ry: 3,
    type: 0,
    underFill: '#7da442',
  },
  // The tree that stands to the right of the house. The map data records the origin
  // at y -141, which would leave it floating above the hills; the client draws it
  // with its base on the ground.
  {
    url: BG_TREES_URL,
    x: 203,
    y: 141,
    originX: 157,
    originY: 134,
    rx: -20,
    ry: 3,
    type: 0,
  },
];

function getBalloonPartUrl(part: ChatBalloonPart): string {
  return `/api/maple/wz/img/GMS/93/UI/ChatBalloon.img/0/${part}`;
}

export function preloadMapAssets(): void {
  loadCachedImage(MAP_RENDER_URL);
  loadCachedImage(BG_SKY_URL);
  loadCachedImage(BG_CLOUDS_URL);
  loadCachedImage(BG_HILLS_URL);
  loadCachedImage(BG_TREES_URL);
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
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // 1. Draw Henesys Sky & Parallax Backgrounds
  drawHenesysBackground(ctx, width, height, state.cameraX, state.cameraY);

  // Convert world coordinates to canvas coordinates. The camera point is pinned to
  // the canvas centre shifted down by the vertical bias. This is a 1:1 mapping: the
  // magnification happens in CSS (see VIEW_ZOOM), so every draw here stays on whole
  // canvas pixels.
  ctx.save();
  ctx.translate(
    Math.round(width / 2 - state.cameraX),
    Math.round(height / 2 + WORLD_VERTICAL_BIAS - state.cameraY),
  );

  // 2. Draw Maya's House Map Render
  const mapImg = loadCachedImage(MAP_RENDER_URL);
  if (mapImg.loaded) {
    ctx.drawImage(mapImg.img, MAP_RENDER_ORIGIN_X, MAP_RENDER_ORIGIN_Y);
    // The view can be wider than the map, so continue the stone platform outwards.
    drawGroundFlanks(
      ctx,
      mapImg.img,
      state.cameraX - width / 2 - 2,
      state.cameraX + width / 2 + 2,
    );
  } else {
    // Loading placeholder for floor
    ctx.fillStyle = '#5c8a32';
    ctx.fillRect(-450, 274, 1080, 40);
  }

  // 3. Draw visible portals only (type !== 0; type 0 'sp' is an invisible spawn point)
  if (state.mapData?.portals) {
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
  if (mayaImg.loaded) {
    const mx = -17 - Math.round(mayaImg.img.width / 2);
    const my = 39 - mayaImg.img.height;
    ctx.drawImage(mayaImg.img, mx, my);
    drawMapleNameTag(ctx, -17, 39, 'Maya', '#ffe600', 'rgba(0, 0, 0, 0.72)');

    if (state.npcBubble && state.npcBubble.expiresAt > nowMs) {
      drawSpeechBubble(ctx, -17, my - 10, 'Maya', state.npcBubble.text, true);
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
  const allPlayers: Array<{ player: PlayerState; isSelf: boolean }> = [];
  for (const remote of state.remotePlayers.values()) {
    allPlayers.push({ player: remote, isSelf: false });
  }
  allPlayers.push({ player: state.selfPlayer, isSelf: true });

  for (const { player, isSelf } of allPlayers) {
    drawPlayer(
      ctx,
      player,
      isSelf,
      isSelf ? state.isMovingOnLadder : Math.abs(player.vy) > 1,
      state.chatBubbles.get(player.id),
      nowMs,
    );
  }

  ctx.restore();
  ctx.restore();
}

// The map render stops at the map's own bounds. When the view is wider than the map
// (any zoom below roughly 1.7 on a 1936px-wide window) the stone platform would end in
// mid-air, so continue it outwards with mirrored slices of its own edge. Mirroring
// about the edge keeps the join seamless instead of butting two copies together.
function drawGroundFlanks(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  worldLeft: number,
  worldRight: number,
): void {
  const top = MAP_RENDER_ORIGIN_Y + GROUND_BAND_TOP;
  const mapLeft = MAP_RENDER_ORIGIN_X + GROUND_SLICE_LEFT;
  const mapRight = MAP_RENDER_ORIGIN_X + GROUND_SLICE_RIGHT;

  // Each copy is drawn flipped about its anchor x, touching the map's edge.
  const copy = (anchorX: number, sourceX: number, destX: number) => {
    ctx.save();
    ctx.translate(anchorX, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
      img,
      sourceX,
      GROUND_BAND_TOP,
      GROUND_SLICE_WIDTH,
      GROUND_BAND_HEIGHT,
      destX,
      top,
      GROUND_SLICE_WIDTH,
      GROUND_BAND_HEIGHT,
    );
    ctx.restore();
  };

  for (let x = mapLeft; x > worldLeft; x -= GROUND_SLICE_WIDTH) {
    copy(x, GROUND_SLICE_LEFT, 0);
  }
  for (let x = mapRight; x < worldRight; x += GROUND_SLICE_WIDTH) {
    copy(x, GROUND_SLICE_RIGHT - GROUND_SLICE_WIDTH, -GROUND_SLICE_WIDTH);
  }
}

function drawHenesysBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cameraX: number,
  cameraY: number,
): void {
  // Base sky gradient matching Henesys grassySoil
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#5ea9e6');
  grad.addColorStop(0.55, '#a8dbf8');
  grad.addColorStop(1, '#d7f0fc');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  for (const layer of BACK_LAYERS) {
    const cached = loadCachedImage(layer.url);
    if (!cached.loaded || cached.img.width === 0) continue;

    const img = cached.img;
    const tw = img.width;
    const th = img.height;

    // rx/ry are the parallax percentages: the layer only shifts by that share of the
    // camera's travel, so distant scenery barely moves.
    const originX = width / 2 + (layer.x + (cameraX * layer.rx) / 100 - cameraX);
    const originY =
      height / 2 +
      WORLD_VERTICAL_BIAS +
      (layer.y + (cameraY * layer.ry) / 100 - cameraY);
    const left = originX - layer.originX;
    const top = originY - layer.originY;

    if (layer.underFill) {
      ctx.fillStyle = layer.underFill;
      ctx.fillRect(0, top + th - 2, width, Math.max(0, height - (top + th - 2)));
    }

    const tileX = layer.type === 1 || layer.type === 3 || layer.type === 4;
    const tileY = layer.type === 2 || layer.type === 3;
    const startX = tileX ? left + Math.floor(-left / tw) * tw : left;
    const startY = tileY ? top + Math.floor(-top / th) * th : top;
    const endX = tileX ? width : left + tw;
    const endY = tileY ? height : top + th;

    for (let y = startY; y < endY; y += th) {
      for (let x = startX; x < endX; x += tw) {
        ctx.drawImage(img, Math.round(x), Math.round(y), Math.round(tw), Math.round(th));
      }
    }
  }
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
    ctx,
    px,
    py,
    player.name || 'Mapler',
    isSelf ? '#ffffff' : '#e8f4ff',
    isSelf ? 'rgba(15, 25, 45, 0.82)' : 'rgba(0, 0, 0, 0.68)',
  );

  // Classic MapleStory Chat Bubble above character's head
  if (bubble && bubble.expiresAt > nowMs) {
    drawSpeechBubble(ctx, px, headTopY - 8, player.name, bubble.text, false);
  }
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
  ctx.font = '12px Tahoma, Verdana, sans-serif';
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
  ctx.fillText(name, x, tagY + tagHeight / 2 + 0.5);
  ctx.restore();
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  bottomY: number,
  speakerName: string,
  text: string,
  _isNpc: boolean,
): void {
  ctx.save();
  ctx.font = '11px Tahoma, Arial, sans-serif';

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

  // Centered black text per row, matching classic MapleStory chat balloons
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const centerX = boxX + Math.floor(boxWidth / 2);
  for (let i = 0; i < lines.length; i++) {
    const lineCenterY = boxY + BORDER_H + i * ROW_H + Math.floor(ROW_H / 2);
    ctx.fillText(lines[i], centerX, lineCenterY);
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
