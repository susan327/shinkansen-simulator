"use strict";

/** 疎結合な機能連携用イベントバス。 */
window.ATCEventBus = (() => {
  const listeners = new Map();
  return Object.freeze({
    on(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
      return () => listeners.get(type)?.delete(handler);
    },
    emit(type, detail = {}) {
      listeners.get(type)?.forEach(handler => {
        try { handler(detail); } catch (error) { console.error(`[event:${type}]`, error); }
      });
    },
    clear(type) {
      type ? listeners.delete(type) : listeners.clear();
    }
  });
})();
