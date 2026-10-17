import type {
  CharacterAction,
  CharacterEmotion,
  MapleSelectedItem,
  MapleSimCharacter,
} from '../types/maple';

const DEFAULT_VERSION = '270';
const DEFAULT_REGION = 'GMS';

export function createBaseSelectedItems(
  skin: number,
  region = DEFAULT_REGION,
  version = DEFAULT_VERSION,
): Record<string, MapleSelectedItem> {
  const skinId = Number.isFinite(skin) && skin >= 2000 && skin < 3000 ? skin : 2000;
  return {
    Body: {
      name: 'Body',
      noIcon: true,
      id: skinId,
      region,
      version,
      typeInfo: {
        overallCategory: 'Character',
        category: 'Character',
        subCategory: 'Body',
        lowItemId: 2000,
        highItemId: 2999,
      },
    },
    Head: {
      name: 'Head',
      noIcon: true,
      id: skinId + 10000,
      region,
      version,
      typeInfo: {
        overallCategory: 'Character',
        category: 'Character',
        subCategory: 'Head',
        lowItemId: 12000,
        highItemId: 12999,
      },
    },
  };
}

export function normalizeMapleSimCharacter(
  raw: unknown,
  fallbackName?: string,
): MapleSimCharacter {
  let obj: Record<string, unknown> = {};

  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null) {
    obj = raw[0] as Record<string, unknown>;
  } else if (typeof raw === 'object' && raw !== null) {
    const candidate = raw as Record<string, unknown>;
    if (Array.isArray(candidate.characters) && candidate.characters.length > 0) {
      obj = candidate.characters[0] as Record<string, unknown>;
    } else {
      obj = candidate;
    }
  } else {
    throw new Error('Invalid character JSON format.');
  }

  const skin = typeof obj.skin === 'number' && obj.skin >= 2000 ? obj.skin : 2000;
  const baseItems = createBaseSelectedItems(skin);
  const selectedItems: Record<string, MapleSelectedItem> = { ...baseItems };

  if (obj.selectedItems && typeof obj.selectedItems === 'object') {
    const entries = Array.isArray(obj.selectedItems)
      ? obj.selectedItems
      : Object.entries(obj.selectedItems as Record<string, unknown>).map(([key, val]) => {
          if (typeof val === 'object' && val !== null) {
            return { _key: key, ...(val as Record<string, unknown>) };
          }
          return null;
        });

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      const id = Number(item.id ?? item.Id ?? item.itemId);
      if (!Number.isFinite(id) || id <= 0) continue;

      const typeInfoRaw = (item.typeInfo ?? item.TypeInfo) as Record<string, unknown> | undefined;
      const subCategory = String(
        typeInfoRaw?.subCategory ??
          typeInfoRaw?.SubCategory ??
          item._key ??
          inferSubCategory(id),
      );

      selectedItems[subCategory] = {
        name: typeof item.name === 'string' ? item.name : subCategory,
        noIcon: Boolean(item.noIcon),
        id,
        region: typeof item.region === 'string' && item.region ? item.region : DEFAULT_REGION,
        version:
          typeof item.version === 'string' && item.version && item.version !== 'latest'
            ? item.version
            : DEFAULT_VERSION,
        typeInfo: {
          overallCategory: String(typeInfoRaw?.overallCategory ?? 'Equip'),
          category: String(typeInfoRaw?.category ?? 'Armor'),
          subCategory,
          lowItemId: Number(typeInfoRaw?.lowItemId ?? 0),
          highItemId: Number(typeInfoRaw?.highItemId ?? 0),
        },
        ...(typeof item.hue === 'number' ? { hue: item.hue } : {}),
        ...(typeof item.saturation === 'number' ? { saturation: item.saturation } : {}),
        ...(typeof item.contrast === 'number' ? { contrast: item.contrast } : {}),
        ...(typeof item.brightness === 'number' ? { brightness: item.brightness } : {}),
        ...(typeof item.alpha === 'number' ? { alpha: item.alpha } : {}),
        ...(typeof item.visible === 'boolean' ? { visible: item.visible } : {}),
      };
    }
  }

  const posRaw = obj.position as Record<string, unknown> | undefined;
  const rawName = typeof obj.name === 'string' ? obj.name.trim() : '';

  return {
    id: typeof obj.id === 'number' ? obj.id : Date.now(),
    type: 'character',
    action: typeof obj.action === 'string' && obj.action ? obj.action : 'stand1',
    emotion: typeof obj.emotion === 'string' && obj.emotion ? obj.emotion : 'default',
    skin,
    zoom: typeof obj.zoom === 'number' ? obj.zoom : 1,
    frame: typeof obj.frame === 'number' ? obj.frame : 0,
    mercEars: Boolean(obj.mercEars),
    illiumEars: Boolean(obj.illiumEars),
    highFloraEars: Boolean(obj.highFloraEars),
    selectedItems,
    visible: obj.visible !== undefined ? Boolean(obj.visible) : true,
    position: {
      x: typeof posRaw?.x === 'number' ? posRaw.x : 0,
      y: typeof posRaw?.y === 'number' ? posRaw.y : 274,
    },
    fhSnap: obj.fhSnap !== undefined ? Boolean(obj.fhSnap) : true,
    flipX: Boolean(obj.flipX),
    name: rawName || fallbackName || 'Mapler',
    includeBackground: obj.includeBackground !== undefined ? Boolean(obj.includeBackground) : true,
  };
}

function inferSubCategory(id: number): string {
  if (id >= 2000 && id < 3000) return 'Body';
  if (id >= 12000 && id < 13000) return 'Head';
  if (id >= 20000 && id < 30000) return 'Face';
  if (id >= 30000 && id < 50000) return 'Hair';
  if (id >= 1000000 && id < 1010000) return 'Hat';
  if (id >= 1010000 && id < 1020000) return 'Face Accessory';
  if (id >= 1020000 && id < 1030000) return 'Eye Decoration';
  if (id >= 1030000 && id < 1040000) return 'Earrings';
  if (id >= 1040000 && id < 1050000) return 'Top';
  if (id >= 1050000 && id < 1060000) return 'Overall';
  if (id >= 1060000 && id < 1070000) return 'Bottom';
  if (id >= 1070000 && id < 1080000) return 'Shoes';
  if (id >= 1080000 && id < 1090000) return 'Gloves';
  if (id >= 1090000 && id < 1100000) return 'Shield';
  if (id >= 1100000 && id < 1110000) return 'Cape';
  return `Item_${id}`;
}

export function getCharacterItemEntries(
  character: MapleSimCharacter,
  emotionOverride?: CharacterEmotion,
  action: CharacterAction = 'stand1',
): Array<Record<string, unknown>> {
  const emotion = emotionOverride || (character.emotion as CharacterEmotion) || 'default';
  let items = Object.values(character.selectedItems || {}).filter(
    (item) => item && item.id && (item.visible === undefined || item.visible),
  );

  // Only include Chair items (3010000..3019999) when action === 'sit'
  const isChair = (id: number) => id >= 3010000 && id < 3020000;
  if (action === 'sit') {
    const hasChair = items.some((i) => isChair(i.id));
    if (!hasChair) {
      // Default to classic MapleStory chair: The Relaxer (3010000)
      items = [
        ...items,
        {
          id: 3010000,
          name: 'The Relaxer',
          region: DEFAULT_REGION,
          version: DEFAULT_VERSION,
        },
      ];
    }
  } else {
    items = items.filter((i) => !isChair(i.id));
  }

  // Ensure Body and Head are always present
  const hasBody = items.some((i) => i.id >= 2000 && i.id < 3000);
  const hasHead = items.some((i) => i.id >= 12000 && i.id < 13000);
  const skin = character.skin || 2000;
  if (!hasBody) {
    items.unshift({ id: skin, region: DEFAULT_REGION, version: DEFAULT_VERSION });
  }
  if (!hasHead) {
    items.unshift({ id: skin + 10000, region: DEFAULT_REGION, version: DEFAULT_VERSION });
  }

  return items.map((item) => {
    const entry: Record<string, unknown> = {
      itemId: Number(item.id),
    };
    if ((item.id >= 20000 && item.id < 30000) || (item.id >= 1010000 && item.id < 1020000)) {
      entry.animationName = emotion;
    }
    if (item.region && item.region.toLowerCase() !== 'gms') {
      entry.region = item.region;
    }
    const ver = item.version && item.version.toLowerCase() !== 'latest' ? item.version : DEFAULT_VERSION;
    entry.version = ver;

    if (item.hue) entry.hue = item.hue;
    if (item.saturation !== undefined && item.saturation !== 1) entry.saturation = item.saturation;
    if (item.contrast !== undefined && item.contrast !== 1) entry.contrast = item.contrast;
    if (item.brightness !== undefined && item.brightness !== 1) entry.brightness = item.brightness;
    if (item.alpha !== undefined && item.alpha !== 1) entry.alpha = item.alpha;
    return entry;
  });
}

/**
 * `FeetCenter` asks maplestory.io to pad the sprite so the character's feet land
 * exactly on the canvas centre, instead of cropping the canvas tight to the drawn
 * pixels. Without it, any layer that reaches past the feet (capes, wings, sun/aura
 * effects) inflates the bounds, and anchoring on the image box makes the character
 * float up and to the left of its real position.
 */
export type CharacterRenderMode = 'Full' | 'FeetCenter';

export function buildCharacterSpriteUrl(
  character: MapleSimCharacter,
  action: CharacterAction = 'stand1',
  frame: number | 'animated' = 0,
  emotionOverride?: CharacterEmotion,
  renderMode: CharacterRenderMode = 'FeetCenter',
): string {
  // Notice ladder/rope frames have no face emotion; normalize emotion to default on ladder/rope so all frames share cache
  const isBackAction = action === 'ladder' || action === 'rope';
  const effectiveEmotion = isBackAction ? 'default' : emotionOverride;
  const entries = getCharacterItemEntries(character, effectiveEmotion, action);
  const serialized = JSON.stringify(entries);
  const finalEncoded = encodeURIComponent(serialized.slice(1, -1));

  const params = new URLSearchParams({
    showears: String(Boolean(character.mercEars)),
    showLefEars: String(Boolean(character.illiumEars)),
    showHighLefEars: String(Boolean(character.highFloraEars)),
    resize: '1',
    name: '',
    flipX: 'false',
  });
  if (renderMode === 'FeetCenter') params.set('renderMode', 'FeetCenter');

  return `/api/maple/character/${finalEncoded}/${action}/${frame}?${params.toString()}`;
}
