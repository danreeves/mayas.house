#!/usr/bin/env node
/**
 * Harvest a MapleStory map's own artwork data so the renderer can compose the map
 * from the WZ files instead of relying on a third-party baked render.
 *
 * maplestory.io only hands out one node of the WZ tree per request (a node gives its
 * child *names*, never their values), so a full map costs several hundred small
 * requests. That is fine to do once per map/version here, and far too slow to do in
 * the browser, which is why this writes a single JSON the client loads instead.
 *
 * Usage:
 *   node scripts/harvest-map.mjs [--region GMS] [--version 93] [--mapId 100000001]
 *                                [--base https://maplestory.io/api/wz] [--out <file>]
 *
 * To pick up a different version of the same map (the whole point of this), run it
 * with a different --version; the output lands in public/map-data/<region>-<ver>-<id>.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const REGION = arg('region', 'GMS');
const VERSION = arg('version', '93');
const MAP_ID = arg('mapId', '100000001');
const BASE = arg('base', 'https://maplestory.io/api/wz').replace(/\/$/, '');
const OUT = arg(
  'out',
  path.join('public', 'map-data', `${REGION}-${VERSION}-${MAP_ID}.json`),
);

const CONCURRENCY = Number(arg('concurrency', '10'));
const RETRIES = 4;

const MAP_IMG = `Map/Map/Map1/${MAP_ID}.img`;

let requestCount = 0;
let retryCount = 0;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch one WZ node as JSON, retrying the 5xx/524 flakes maplestory.io is known for. */
async function node(wzPath) {
  const url = `${BASE}/${REGION}/${VERSION}/${wzPath}`;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    requestCount++;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: { Accept: 'application/json' },
      });
      if (res.ok) return await res.json();
      if (res.status < 500 && res.status !== 429) {
        throw new Error(`${res.status} for ${wzPath}`);
      }
    } catch (err) {
      if (attempt === RETRIES) throw err;
    }
    retryCount++;
    await wait(400 * (attempt + 1) + Math.random() * 300);
  }
  throw new Error(`Gave up on ${wzPath}`);
}

/** The scalar children of a node, fetched concurrently. */
async function fields(wzPath, keys) {
  const out = {};
  await Promise.all(
    keys.map(async (key) => {
      const child = await node(`${wzPath}/${key}`);
      out[key] = child && typeof child === 'object' ? child.value : child;
    }),
  );
  return out;
}

/** Read every named child of a node into { name: value }. */
async function allFields(wzPath) {
  const parent = await node(wzPath);
  const keys = (parent && parent.children) || [];
  const values = await fields(wzPath, keys);
  return { keys, values };
}

/** Map a plain object of { child: value } while keeping a cap on in-flight requests. */
async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

const asBool = (v) => v === true || v === 1 || v === '1';
const asNum = (v, fallback = 0) => (typeof v === 'number' ? v : fallback);

/**
 * Sprite frame origins live on the sprite itself rather than on the placement, so
 * every distinct object/tile sprite is resolved once and shared by all placements.
 */
const spriteCache = new Map();

async function objectSprite(oS, l0, l1, l2) {
  const key = `${oS}|${l0}|${l1}|${l2}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const promise = (async () => {
    const treePath = `Map/Obj/${oS}.img/${l0}/${l1}/${l2}`;
    const tree = await node(treePath);
    const frameNames = (tree && tree.children) || [];
    const frames = await mapPool(frameNames, 4, async (frameName) => {
      const { values } = await allFields(`${treePath}/${frameName}`);
      const origin = values.origin || {};
      return {
        originX: Math.round(asNum(origin.x)),
        originY: Math.round(asNum(origin.y)),
        delay: asNum(values.delay, 0),
      };
    });
    return { frames };
  })();
  spriteCache.set(key, promise);
  return promise;
}

const tileCache = new Map();

async function tileSprite(tS, u, no) {
  const key = `${tS}|${u}|${no}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const promise = (async () => {
    const tilePath = `Map/Tile/${tS}.img/${u}/${no}`;
    const { values } = await allFields(tilePath);
    const origin = values.origin || {};
    return {
      originX: Math.round(asNum(origin.x)),
      originY: Math.round(asNum(origin.y)),
    };
  })();
  tileCache.set(key, promise);
  return promise;
}

async function harvestBack() {
  const { keys } = await allFields(`${MAP_IMG}/back`);
  return mapPool(keys, CONCURRENCY, async (name) => {
    const { values } = await allFields(`${MAP_IMG}/back/${name}`);
    const bS = values.bS;
    const no = asNum(values.no, 0);
    let originX = 0;
    let originY = 0;
    if (bS) {
      const { values: sprite } = await allFields(`Map/Back/${bS}.img/back/${no}`);
      originX = Math.round(asNum((sprite.origin || {}).x));
      originY = Math.round(asNum((sprite.origin || {}).y));
    }
    return {
      bS,
      no,
      x: asNum(values.x),
      y: asNum(values.y),
      rx: asNum(values.rx),
      ry: asNum(values.ry),
      type: asNum(values.type),
      front: asNum(values.front),
      ani: asNum(values.ani),
      cx: asNum(values.cx),
      cy: asNum(values.cy),
      a: asNum(values.a, 255),
      flipX: asBool(values.f),
      originX,
      originY,
    };
  });
}

async function harvestLayer(layerName) {
  const info = await node(`${MAP_IMG}/${layerName}/info`).catch(() => null);
  let tileSet = null;
  if (info && (info.children || []).includes('tS')) {
    tileSet = (await node(`${MAP_IMG}/${layerName}/info/tS`)).value;
  }

  const objParent = await node(`${MAP_IMG}/${layerName}/obj`).catch(() => null);
  const tileParent = await node(`${MAP_IMG}/${layerName}/tile`).catch(() => null);

  const objs = await mapPool((objParent && objParent.children) || [], 4, async (name) => {
    const { values } = await allFields(`${MAP_IMG}/${layerName}/obj/${name}`);
    const sprite = await objectSprite(values.oS, values.l0, values.l1, values.l2);
    return {
      oS: values.oS,
      l0: String(values.l0),
      l1: String(values.l1),
      l2: String(values.l2),
      x: asNum(values.x),
      y: asNum(values.y),
      z: asNum(values.z),
      flipX: asBool(values.f),
      frames: sprite.frames,
    };
  });

  const tiles = await mapPool((tileParent && tileParent.children) || [], 4, async (name) => {
    const { values } = await allFields(`${MAP_IMG}/${layerName}/tile/${name}`);
    const u = values.u;
    const no = asNum(values.no, 0);
    const sprite = tileSet ? await tileSprite(tileSet, u, no) : { originX: 0, originY: 0 };
    return {
      u,
      no,
      x: asNum(values.x),
      y: asNum(values.y),
      z: asNum(values.zM),
      originX: sprite.originX,
      originY: sprite.originY,
    };
  });

  return {
    index: Number(layerName),
    tileSet,
    // The client draws tiles first and objects on top, each in z order.
    tiles: tiles.sort((a, b) => a.z - b.z),
    obj: objs.sort((a, b) => a.z - b.z),
  };
}

async function main() {
  const mapRoot = await node(MAP_IMG);
  const rootChildren = (mapRoot && mapRoot.children) || [];
  const layerNames = rootChildren.filter((c) => /^\d+$/.test(c));

  console.log(
    `Harvesting ${REGION}/${VERSION}/map/${MAP_ID} (${layerNames.length} layers)`,
  );

  const back = rootChildren.includes('back') ? await harvestBack() : [];
  const layers = [];
  for (const layerName of layerNames) {
    // Sequential per layer keeps the sprite caches warm and the load on the API sane.
    layers.push(await harvestLayer(layerName));
  }

  const data = {
    region: REGION,
    version: Number(VERSION),
    mapId: Number(MAP_ID),
    harvestedAt: new Date().toISOString(),
    counts: {
      back: back.length,
      objects: layers.reduce((n, l) => n + l.obj.length, 0),
      tiles: layers.reduce((n, l) => n + l.tiles.length, 0),
      distinctObjectSprites: spriteCache.size,
      distinctTileSprites: tileCache.size,
    },
    back,
    layers,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(data)}\n`, 'utf8');

  console.log(
    `Wrote ${OUT}\n` +
      `  back ${data.counts.back}, objects ${data.counts.objects} ` +
      `(${data.counts.distinctObjectSprites} sprites), tiles ${data.counts.tiles} ` +
      `(${data.counts.distinctTileSprites} sprites)\n` +
      `  ${requestCount} requests, ${retryCount} retries`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
