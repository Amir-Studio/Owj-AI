const PREFIX = 'owj-ai-memory:v1:';

export function createMemoryStorage(adapter = memoryAdapter()) {
  if (!adapter || !['getItem', 'setItem', 'removeItem'].every(key => typeof adapter[key] === 'function')) {
    throw new TypeError('Storage adapter must implement getItem, setItem and removeItem');
  }

  const keyFor = userId => {
    if (typeof userId !== 'string' || !userId.trim()) throw new TypeError('userId is required');
    return PREFIX + encodeURIComponent(userId.trim());
  };

  return Object.freeze({
    async get(userId) {
      const raw = await adapter.getItem(keyFor(userId));
      if (!raw) return null;

      try {
        const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
        // v1 is retained for safe migration from the first engine release.
        // v2 is the current engine memory schema.
        return value && (value.schemaVersion === 1 || value.schemaVersion === 2)
          ? value
          : null;
      } catch {
        return null;
      }
    },

    async set(userId, value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('memory value must be an object');
      }
      await adapter.setItem(keyFor(userId), JSON.stringify(value));
    },

    async remove(userId) {
      await adapter.removeItem(keyFor(userId));
    }
  });
}

export function createBrowserMemoryStorage() {
  if (typeof globalThis.localStorage === 'undefined') {
    throw new Error('localStorage unavailable');
  }

  return createMemoryStorage({
    getItem: async key => globalThis.localStorage.getItem(key),
    setItem: async (key, value) => globalThis.localStorage.setItem(key, value),
    removeItem: async key => globalThis.localStorage.removeItem(key)
  });
}

function memoryAdapter() {
  const map = new Map();
  return {
    getItem: async key => map.get(key) ?? null,
    setItem: async (key, value) => map.set(key, value),
    removeItem: async key => map.delete(key)
  };
}
