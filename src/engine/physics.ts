import type {
  CharacterAction,
  MapleFoothold,
  MapleLadderRope,
  MapleMapData,
} from '../types/maple';

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  sit: boolean;
}

export interface LocalPhysicsState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  footholdId: number | null;
  onLadder: MapleLadderRope | null;
  action: CharacterAction;
  flipX: boolean;
  sitting: boolean;
  ignoreFootholdId: number | null;
  ignoreFootholdUntil: number;
  ladderCooldownUntil: number;
}

const WALK_SPEED = 125; // px/sec (MapleStory 100% speed)
const CLIMB_SPEED = 100; // px/sec on ladders/ropes
const JUMP_VELOCITY = -345; // px/sec upward impulse
const GRAVITY = 980; // px/sec^2
const MAX_FALL_SPEED = 540;
const MAP_LEFT_BOUND = -440;
const MAP_RIGHT_BOUND = 620;

export function getWalkableFootholds(mapData: MapleMapData): MapleFoothold[] {
  // In MapleStory WZ, walkable top surfaces always have x1 < x2:
  // - Footholds 1..12: grass ground floor (y = 274)
  // - Foothold 16: bottom indoor wooden floor of Maya's House (y = 245, x = -151..258)
  // - Foothold 20: upper loft floor of Maya's House (y = 39, x = -173..107)
  return Object.values(mapData.footholds).filter((fh) => fh.x1 < fh.x2);
}

export interface SpawnPoint {
  x: number;
  y: number;
}

// Maya's House spawn portal (GMS/93 map 100000001) is x 364, y 204, but keep a
// sane fallback for the moment before the map metadata has loaded.
const FALLBACK_SPAWN: SpawnPoint = { x: 364, y: 204 };

/**
 * The map's `type === 0` portal is the invisible spawn point the client drops you
 * in through, which is where MapleStory respawns you after a channel change.
 */
export function getSpawnPoint(mapData: MapleMapData | null): SpawnPoint {
  const spawn = (mapData?.portals ?? []).find(
    (portal) =>
      portal &&
      (portal.type === 0 || portal.portalName === 'sp') &&
      Number.isFinite(portal.x) &&
      Number.isFinite(portal.y),
  );
  return spawn ? { x: spawn.x, y: spawn.y } : { ...FALLBACK_SPAWN };
}

export function getFootholdYAtX(fh: MapleFoothold, x: number): number {
  if (fh.x2 === fh.x1 || fh.y1 === fh.y2) return fh.y1;
  const t = (x - fh.x1) / (fh.x2 - fh.x1);
  return fh.y1 + t * (fh.y2 - fh.y1);
}

export function findFootholdBelow(
  footholds: MapleFoothold[],
  x: number,
  y: number,
  ignoreFootholdId: number | null = null,
): { foothold: MapleFoothold; yAtX: number } | null {
  let best: { foothold: MapleFoothold; yAtX: number } | null = null;
  for (const fh of footholds) {
    if (fh.id === ignoreFootholdId) continue;
    if (x < fh.x1 || x > fh.x2) continue;
    const yAtX = getFootholdYAtX(fh, x);
    if (yAtX >= y - 4) {
      if (!best || yAtX < best.yAtX) {
        best = { foothold: fh, yAtX };
      }
    }
  }
  return best;
}

export function stepPhysics(
  state: LocalPhysicsState,
  input: InputState,
  mapData: MapleMapData,
  dt: number,
  now: number,
): void {
  const walkable = getWalkableFootholds(mapData);
  const ladders = mapData.ladderRopes || [];

  if (state.ignoreFootholdUntil && now > state.ignoreFootholdUntil) {
    state.ignoreFootholdId = null;
    state.ignoreFootholdUntil = 0;
  }

  // 1. Handle Ladder Climbing
  if (state.onLadder) {
    const ladder = state.onLadder;
    state.x = ladder.x;
    state.vx = 0;
    state.vy = 0;
    state.sitting = false;

    // Jump off ladder with Left/Right + Jump
    if (input.jump && (input.left || input.right)) {
      state.onLadder = null;
      state.vx = input.left ? -WALK_SPEED * 0.85 : WALK_SPEED * 0.85;
      state.vy = JUMP_VELOCITY * 0.72;
      state.flipX = input.right;
      state.action = 'jump';
      state.ladderCooldownUntil = now + 260;
      return;
    }

    if (input.up) {
      state.vy = -CLIMB_SPEED;
      state.y += state.vy * dt;
    } else if (input.down) {
      state.vy = CLIMB_SPEED;
      const nextY = state.y + state.vy * dt;

      // Climbing down: step off the ladder as soon as the feet reach a floor.
      // The floor is looked up strictly below the feet so the platform the
      // character just left (e.g. the loft above the ladder) is ignored.
      const landingFh = findFootholdBelow(walkable, ladder.x, state.y + 1);
      if (landingFh && nextY >= landingFh.yAtX) {
        state.onLadder = null;
        state.y = landingFh.yAtX;
        state.vy = 0;
        state.footholdId = landingFh.foothold.id;
        state.action = 'stand1';
        state.ladderCooldownUntil = now + 220;
        return;
      }

      // Nothing beneath the ladder: keep dangling past the bottom rung, then
      // drop off the end once the feet clear it.
      if (!landingFh && nextY > ladder.y2 + 8) {
        state.onLadder = null;
        state.footholdId = null;
        state.vy = 40;
        state.action = 'jump';
        state.ladderCooldownUntil = now + 220;
        return;
      }

      state.y = nextY;
    }

    // Reached top of ladder -> dismount onto upper foothold
    if (state.y <= ladder.y1) {
      state.onLadder = null;
      const topFh = findFootholdBelow(walkable, ladder.x, ladder.y1 - 8);
      if (topFh) {
        state.y = topFh.yAtX;
        state.footholdId = topFh.foothold.id;
      } else {
        state.y = ladder.y1;
      }
      state.action = 'stand1';
      state.ladderCooldownUntil = now + 220;
      return;
    }

    state.action = ladder.isLadder ? 'ladder' : 'rope';
    return;
  }

  // 2. Check if grabbing a ladder/rope via Up or Down arrow
  if ((input.up || input.down) && now >= state.ladderCooldownUntil) {
    for (const ladder of ladders) {
      if (Math.abs(state.x - ladder.x) <= 20) {
        if (input.up && state.y >= ladder.y1 + 2 && state.y <= ladder.y2 + 40) {
          state.onLadder = ladder;
          state.footholdId = null;
          state.sitting = false;
          state.x = ladder.x;
          // Keep the feet where they are: grabbing on from below leaves the
          // character dangling off the bottom rung instead of snapping up.
          state.vx = 0;
          state.vy = 0;
          state.action = ladder.isLadder ? 'ladder' : 'rope';
          return;
        }
        // Standing on upper platform above ladder and pressing Down
        if (
          input.down &&
          !input.jump &&
          state.footholdId !== null &&
          Math.abs(state.y - ladder.y1) <= 12
        ) {
          state.onLadder = ladder;
          state.footholdId = null;
          state.sitting = false;
          state.x = ladder.x;
          state.y = ladder.y1 + 4;
          state.vx = 0;
          state.vy = 0;
          state.action = ladder.isLadder ? 'ladder' : 'rope';
          return;
        }
      }
    }
  }

  // 3. Grounded on a Foothold
  if (state.footholdId !== null) {
    const currentFh = walkable.find((f) => f.id === state.footholdId) || null;
    if (!currentFh) {
      state.footholdId = null;
    } else {
      state.vy = 0;

      // Down + Jump -> Drop down through upper platform if another platform exists below
      if (input.down && input.jump) {
        const below = findFootholdBelow(walkable, state.x, state.y + 4, currentFh.id);
        if (below) {
          state.ignoreFootholdId = currentFh.id;
          state.ignoreFootholdUntil = now + 350;
          state.footholdId = null;
          state.sitting = false;
          state.vy = -80;
          state.y += 4;
          state.action = 'jump';
          return;
        }
      }

      // Normal Jump
      if (input.jump) {
        state.footholdId = null;
        state.sitting = false;
        state.vy = JUMP_VELOCITY;
        if (input.left) {
          state.vx = -WALK_SPEED;
          state.flipX = false;
        } else if (input.right) {
          state.vx = WALK_SPEED;
          state.flipX = true;
        }
        state.action = 'jump';
        return;
      }

      // Sit toggle / cancel on movement
      if (input.sit && !input.left && !input.right && !input.down) {
        state.sitting = true;
      }
      if (input.left || input.right || input.down) {
        state.sitting = false;
      }

      // Prone (holding Down on ground)
      if (input.down && !input.left && !input.right) {
        state.vx = 0;
        state.action = 'prone';
        return;
      }

      // Walk Left / Right
      if (input.left && !input.right) {
        state.vx = -WALK_SPEED;
        state.flipX = false;
        state.action = 'walk1';
      } else if (input.right && !input.left) {
        state.vx = WALK_SPEED;
        state.flipX = true;
        state.action = 'walk1';
      } else {
        state.vx = 0;
        state.action = state.sitting ? 'sit' : 'stand1';
      }

      if (state.vx !== 0) {
        let nextX = Math.max(MAP_LEFT_BOUND, Math.min(MAP_RIGHT_BOUND, state.x + state.vx * dt));
        // Check if still within currentFh or adjacent walkable foothold
        if (nextX >= currentFh.x1 && nextX <= currentFh.x2) {
          state.x = nextX;
          state.y = getFootholdYAtX(currentFh, nextX);
        } else {
          // Try finding adjacent foothold at the same level
          const adjacent = walkable.find(
            (fh) =>
              fh.id !== currentFh.id &&
              nextX >= fh.x1 &&
              nextX <= fh.x2 &&
              Math.abs(getFootholdYAtX(fh, nextX) - state.y) <= 10,
          );
          if (adjacent) {
            state.footholdId = adjacent.id;
            state.x = nextX;
            state.y = getFootholdYAtX(adjacent, nextX);
          } else {
            // Walked off edge of platform -> become airborne or clamp at map boundary
            const steppedBelow = findFootholdBelow(walkable, nextX, state.y - 4);
            if (!steppedBelow && (nextX <= MAP_LEFT_BOUND || nextX >= MAP_RIGHT_BOUND)) {
              state.x = Math.max(currentFh.x1, Math.min(currentFh.x2, nextX));
              state.vx = 0;
            } else {
              state.x = nextX;
              state.footholdId = null;
              state.vy = 0;
              state.action = 'jump';
            }
          }
        }
      }
      return;
    }
  }

  // 4. Airborne (Jumping / Falling)
  state.sitting = false;
  state.action = 'jump';

  // Subtle air control on direction if jumping straight up
  if (input.left && !input.right) {
    state.flipX = false;
    if (state.vx === 0) state.vx = -WALK_SPEED * 0.5;
  } else if (input.right && !input.left) {
    state.flipX = true;
    if (state.vx === 0) state.vx = WALK_SPEED * 0.5;
  }

  const prevY = state.y;
  state.vy = Math.min(MAX_FALL_SPEED, state.vy + GRAVITY * dt);
  state.x = Math.max(MAP_LEFT_BOUND, Math.min(MAP_RIGHT_BOUND, state.x + state.vx * dt));
  state.y += state.vy * dt;

  // Landing check when falling downward (vy >= 0)
  if (state.vy >= 0) {
    for (const fh of walkable) {
      if (fh.id === state.ignoreFootholdId) continue;
      if (state.x < fh.x1 || state.x > fh.x2) continue;
      const fhY = getFootholdYAtX(fh, state.x);
      if (prevY <= fhY + 6 && state.y >= fhY - 2) {
        state.y = fhY;
        state.vy = 0;
        state.footholdId = fh.id;
        state.action = input.left || input.right ? 'walk1' : 'stand1';
        return;
      }
    }
  }

  // Safety floor recovery if player ever falls below bottom floor (y > 310)
  if (state.y > 310) {
    const floor = findFootholdBelow(walkable, state.x, 260);
    if (floor) {
      state.y = floor.yAtX;
      state.vy = 0;
      state.footholdId = floor.foothold.id;
      state.action = 'stand1';
    } else {
      state.x = 0;
      state.y = 274;
      state.vy = 0;
      state.footholdId = 11;
      state.action = 'stand1';
    }
  }
}
