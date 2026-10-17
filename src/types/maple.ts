export interface MapleItemTypeInfo {
  overallCategory: string;
  category: string;
  subCategory: string;
  lowItemId: number;
  highItemId: number;
}

export interface MapleSelectedItem {
  name?: string;
  noIcon?: boolean;
  id: number;
  region?: string;
  version?: string;
  typeInfo?: MapleItemTypeInfo;
  hue?: number;
  saturation?: number;
  contrast?: number;
  brightness?: number;
  alpha?: number;
  visible?: boolean;
}

export type CharacterAction =
  | 'stand1'
  | 'stand2'
  | 'walk1'
  | 'walk2'
  | 'jump'
  | 'prone'
  | 'ladder'
  | 'rope'
  | 'sit'
  | 'alert';

export type CharacterEmotion =
  | 'default'
  | 'hit'
  | 'smile'
  | 'troubled'
  | 'cry'
  | 'angry'
  | 'bewildered'
  | 'stunned'
  | 'blaze'
  | 'blink'
  | 'bowing'
  | 'cheers'
  | 'chu'
  | 'dam'
  | 'despair'
  | 'glitter'
  | 'hot'
  | 'hum'
  | 'love'
  | 'oops'
  | 'pain'
  | 'qBlue'
  | 'shine'
  | 'vomit'
  | 'wink';

export interface MapleSimCharacter {
  id: number;
  type: 'character';
  action: string;
  emotion: string;
  skin: number;
  zoom: number;
  frame: number;
  mercEars: boolean;
  illiumEars: boolean;
  highFloraEars?: boolean;
  selectedItems: Record<string, MapleSelectedItem>;
  visible: boolean;
  position: {
    x: number;
    y: number;
  };
  fhSnap: boolean;
  flipX: boolean;
  name: string;
  includeBackground: boolean;
}

export interface MapleFoothold {
  id: number;
  next: number;
  prev: number;
  piece: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  layerId: number;
  groupId: number;
}

export interface MapleLadderRope {
  x: number;
  y1: number;
  y2: number;
  isLadder: boolean;
}

export interface MaplePortal {
  portalName: string;
  toName: string;
  type: number;
  toMap: number;
  x: number;
  y: number;
}

export interface MapleNpc {
  id: number;
  x: number;
  y: number;
  walkAreaX1: number;
  walkAreaX2: number;
  footholdId: number;
  flip: boolean;
  hidden: boolean;
}

export interface MapleMiniMap {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  magnification: number;
  canvas: string;
}

export interface MapleMapData {
  id: number;
  name: string;
  streetName: string;
  backgroundMusic: string;
  isTown: boolean;
  mapMark: string;
  miniMap: MapleMiniMap;
  footholds: Record<string, MapleFoothold>;
  ladderRopes: MapleLadderRope[];
  portals: Array<MaplePortal | null>;
  npcs: MapleNpc[];
}

export interface PlayerState {
  id: string;
  name: string;
  character: MapleSimCharacter;
  x: number;
  y: number;
  vx: number;
  vy: number;
  action: CharacterAction;
  emotion: CharacterEmotion;
  flipX: boolean;
  footholdId: number | null;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
  system?: boolean;
}
