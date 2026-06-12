/** 应用级 store 单例：页面经 getStore() 取同一实例（wx storage 持久化）。 */
import { createGameStore } from './gameStore.js';
import { wxStorage } from './wxStorage.js';

let store = null;

export function getStore() {
  if (!store) {
    store = createGameStore({ storage: wxStorage });
  }
  return store;
}
