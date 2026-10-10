/** Tiny pub/sub for shell state such as theme and sidebar. */

const state = {};
const listeners = new Map();

export const store = {
  get(key) {
    return state[key];
  },
  set(key, value) {
    state[key] = value;
    (listeners.get(key) || []).forEach((fn) => {
      try {
        fn(value);
      } catch {
        /* a listener should not break the shell */
      }
    });
    return value;
  },
  on(key, fn) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    return () => listeners.get(key)?.delete(fn);
  },
};
