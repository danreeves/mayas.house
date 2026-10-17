import { defineHandler } from 'void';

export const ssr = false;

export const loader = defineHandler(async () => {
  return {
    mapId: 100000001,
    mapName: "Maya's House",
    streetName: 'Henesys',
    defaultChannel: '1',
  };
});
