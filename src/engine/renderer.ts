import type { MapleMapData, PlayerState } from '../types/maple';
import { getCharacterFrameImage, loadCachedImage } from './sprites';

// World-space origin of GMS/94/map/100000001/render (1135 x 827)
export const MAP_RENDER_ORIGIN_X = -479;
export const MAP_RENDER_ORIGIN_Y = -265;
export const MAP_RENDER_WIDTH = 1135;
export const MAP_RENDER_HEIGHT = 827;

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
  drawHenesysBackground(ctx, width, height, state.cameraX, state.cameraY, nowMs);

  // Convert world coordinates to screen coordinates
  // Screen center follows cameraX, cameraY
  const offsetX = Math.round(width / 2 - state.cameraX);
  const offsetY = Math.round(height / 2 - state.cameraY);

  ctx.save();
  ctx.translate(offsetX, offsetY);

  // 2. Draw Maya's House Map Render
  const mapImg = loadCachedImage(MAP_RENDER_URL);
  if (mapImg.loaded) {
    ctx.drawImage(mapImg.img, MAP_RENDER_ORIGIN_X, MAP_RENDER_ORIGIN_Y);
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

function drawHenesysBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cameraX: number,
  cameraY: number,
  nowMs: number,
): void {
  // Base sky gradient matching Henesys grassySoil
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#5ea9e6');
  grad.addColorStop(0.55, '#a8dbf8');
  grad.addColorStop(1, '#d7f0fc');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Scrolling clouds (back/1)
  const clouds = loadCachedImage(BG_CLOUDS_URL);
  if (clouds.loaded && clouds.img.width > 0) {
    const cw = clouds.img.width;
    const drift = ((nowMs * 0.015) + cameraX * 0.08) % cw;
    const cloudY = Math.round(height * 0.14 - cameraY * 0.04);
    for (let x = -drift - cw; x < width + cw; x += cw) {
      ctx.drawImage(clouds.img, Math.round(x), cloudY);
    }
  }

  // Distant hills (back/2)
  const hills = loadCachedImage(BG_HILLS_URL);
  if (hills.loaded && hills.img.width > 0) {
    const hw = hills.img.width;
    const hh = hills.img.height;
    const parallaxX = ((cameraX * 0.18) % hw + hw) % hw;
    const hillY = Math.round(height * 0.48 - cameraY * 0.08);
    // Fill grassy tone below the hill horizon so tall viewports don't show sky below hills
    ctx.fillStyle = '#7da442';
    ctx.fillRect(0, hillY + hh - 4, width, Math.max(0, height - (hillY + hh - 4)));
    for (let x = -parallaxX - hw; x < width + hw; x += hw) {
      ctx.drawImage(hills.img, Math.round(x), hillY);
    }
  }
}

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

  let headTopY = py - 68;

  if (sprite && sprite.width > 0 && sprite.height > 0) {
    const sw = sprite.width;
    const sh = sprite.height;
    // Foot anchor: prone lowers body to ground, normal stands with feet at py + 2
    const footYOffset = player.action === 'prone' ? 4 : 2;
    const drawY = py - sh + footYOffset;
    headTopY = drawY;

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
