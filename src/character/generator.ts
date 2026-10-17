import type { MapleSelectedItem, MapleSimCharacter } from '../types/maple';
import { createBaseSelectedItems } from './parser';

const DEFAULT_REGION = 'GMS';
const DEFAULT_VERSION = '270';

interface PresetItem {
  id: number;
  name: string;
  subCategory: string;
  category: string;
  lowItemId: number;
  highItemId: number;
}

const SKINS = [2000, 2001, 2002, 2003, 2004];

const FACES: PresetItem[] = [
  { id: 20000, name: 'Motivated Look', subCategory: 'Face', category: 'Character', lowItemId: 20000, highItemId: 29999 },
  { id: 20001, name: 'Perplexed Stare', subCategory: 'Face', category: 'Character', lowItemId: 20000, highItemId: 29999 },
  { id: 20002, name: 'Leisure Look', subCategory: 'Face', category: 'Character', lowItemId: 20000, highItemId: 29999 },
  { id: 20005, name: 'Shut-Eye', subCategory: 'Face', category: 'Character', lowItemId: 20000, highItemId: 29999 },
  { id: 21000, name: 'Motivated Look (F)', subCategory: 'Face', category: 'Character', lowItemId: 20000, highItemId: 29999 },
  { id: 21001, name: 'Fearful Stare', subCategory: 'Face', category: 'Character', lowItemId: 20000, highItemId: 29999 },
  { id: 21002, name: 'Leisure Look (F)', subCategory: 'Face', category: 'Character', lowItemId: 20000, highItemId: 29999 },
];

const HAIRS: PresetItem[] = [
  { id: 30000, name: 'Black Toben', subCategory: 'Hair', category: 'Character', lowItemId: 30000, highItemId: 49999 },
  { id: 30020, name: 'Orange Rebel', subCategory: 'Hair', category: 'Character', lowItemId: 30000, highItemId: 49999 },
  { id: 30030, name: 'Brown Buzz', subCategory: 'Hair', category: 'Character', lowItemId: 30000, highItemId: 49999 },
  { id: 31002, name: 'Orange Sammy', subCategory: 'Hair', category: 'Character', lowItemId: 30000, highItemId: 49999 },
  { id: 31040, name: 'Black Edgy', subCategory: 'Hair', category: 'Character', lowItemId: 30000, highItemId: 49999 },
  { id: 31050, name: 'Black Connie', subCategory: 'Hair', category: 'Character', lowItemId: 30000, highItemId: 49999 },
];

const OUTFITS: Array<{
  top?: PresetItem;
  bottom?: PresetItem;
  overall?: PresetItem;
}> = [
  {
    top: { id: 1040036, name: 'White Undershirt', subCategory: 'Top', category: 'Armor', lowItemId: 1040000, highItemId: 1049999 },
    bottom: { id: 1060026, name: 'Blue Jean Shorts', subCategory: 'Bottom', category: 'Armor', lowItemId: 1060000, highItemId: 1069999 },
  },
  {
    top: { id: 1040002, name: 'White Undershirt', subCategory: 'Top', category: 'Armor', lowItemId: 1040000, highItemId: 1049999 },
    bottom: { id: 1060002, name: 'Blue Jean Shorts', subCategory: 'Bottom', category: 'Armor', lowItemId: 1060000, highItemId: 1069999 },
  },
  {
    top: { id: 1041002, name: 'Red Mini-Skirt Top', subCategory: 'Top', category: 'Armor', lowItemId: 1040000, highItemId: 1049999 },
    bottom: { id: 1061002, name: 'Red Mini-Skirt', subCategory: 'Bottom', category: 'Armor', lowItemId: 1060000, highItemId: 1069999 },
  },
  {
    overall: { id: 1050018, name: 'Blue Sauna Robe', subCategory: 'Overall', category: 'Armor', lowItemId: 1050000, highItemId: 1059999 },
  },
  {
    overall: { id: 1051017, name: 'Red Sauna Robe', subCategory: 'Overall', category: 'Armor', lowItemId: 1050000, highItemId: 1059999 },
  },
];

const SHOES: PresetItem[] = [
  { id: 1072001, name: 'Red Rubber Boots', subCategory: 'Shoes', category: 'Armor', lowItemId: 1070000, highItemId: 1079999 },
  { id: 1072005, name: 'Leather Sandals', subCategory: 'Shoes', category: 'Armor', lowItemId: 1070000, highItemId: 1079999 },
  { id: 1072038, name: 'Yellow Rubber Boots', subCategory: 'Shoes', category: 'Armor', lowItemId: 1070000, highItemId: 1079999 },
  { id: 1072003, name: 'Blue Rubber Boots', subCategory: 'Shoes', category: 'Armor', lowItemId: 1070000, highItemId: 1079999 },
  { id: 1072004, name: 'Yellow Snowshoes', subCategory: 'Shoes', category: 'Armor', lowItemId: 1070000, highItemId: 1079999 },
];

const HATS: Array<PresetItem | null> = [
  null,
  null,
  { id: 1002140, name: 'Wizet Invincible Hat', subCategory: 'Hat', category: 'Armor', lowItemId: 1000000, highItemId: 1009999 },
  { id: 1002017, name: 'Red Headband', subCategory: 'Hat', category: 'Armor', lowItemId: 1000000, highItemId: 1009999 },
];

const CAPES: Array<PresetItem | null> = [
  null,
  null,
  { id: 1102041, name: 'Pink Adventurer Cape', subCategory: 'Cape', category: 'Armor', lowItemId: 1100000, highItemId: 1109999 },
];

const NAME_PREFIXES = [
  'Henesys',
  'Maple',
  'Mush',
  'Slime',
  'Snail',
  'Dexless',
  'Lukless',
  'Tiger',
  'Fang',
  'Bera',
  'Scania',
  'Windia',
  'Broa',
  'Khaini',
];

const NAME_SUFFIXES = [
  'Sin',
  'Bandit',
  'Mage',
  'Bow',
  'Hero',
  'Knight',
  'Cleric',
  'Runner',
  'Vibes',
  'Story',
  'Kid',
  'Pro',
];

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function toSelectedItem(preset: PresetItem): MapleSelectedItem {
  return {
    name: preset.name,
    noIcon: false,
    id: preset.id,
    region: DEFAULT_REGION,
    version: DEFAULT_VERSION,
    typeInfo: {
      overallCategory: preset.category === 'Character' ? 'Character' : 'Equip',
      category: preset.category,
      subCategory: preset.subCategory,
      lowItemId: preset.lowItemId,
      highItemId: preset.highItemId,
    },
  };
}

export function generateRandomName(): string {
  const prefix = pickRandom(NAME_PREFIXES);
  const suffix = pickRandom(NAME_SUFFIXES);
  const num = Math.floor(10 + Math.random() * 89);
  return `${prefix}${suffix}${num}`;
}

export function generateRandomCharacter(existingName?: string): MapleSimCharacter {
  const skin = pickRandom(SKINS);
  const face = pickRandom(FACES);
  const hair = pickRandom(HAIRS);
  const outfit = pickRandom(OUTFITS);
  const shoes = pickRandom(SHOES);
  const hat = pickRandom(HATS);
  const cape = pickRandom(CAPES);

  const selectedItems: Record<string, MapleSelectedItem> = {
    ...createBaseSelectedItems(skin, DEFAULT_REGION, DEFAULT_VERSION),
    Face: toSelectedItem(face),
    Hair: toSelectedItem(hair),
    Shoes: toSelectedItem(shoes),
  };

  if (outfit.overall) {
    selectedItems.Overall = toSelectedItem(outfit.overall);
  } else {
    if (outfit.top) selectedItems.Top = toSelectedItem(outfit.top);
    if (outfit.bottom) selectedItems.Bottom = toSelectedItem(outfit.bottom);
  }

  if (hat) {
    selectedItems.Hat = toSelectedItem(hat);
  }
  if (cape) {
    selectedItems.Cape = toSelectedItem(cape);
  }

  // Spawn around the main floor in Maya's House (-220 to +280 at y = 274)
  const spawnX = Math.round(-180 + Math.random() * 400);

  return {
    id: Date.now(),
    type: 'character',
    action: 'stand1',
    emotion: 'default',
    skin,
    zoom: 1,
    frame: 0,
    mercEars: false,
    illiumEars: false,
    selectedItems,
    visible: true,
    position: {
      x: spawnX,
      y: 274,
    },
    fhSnap: true,
    flipX: Math.random() > 0.5,
    name: existingName?.trim() || generateRandomName(),
    includeBackground: true,
  };
}
