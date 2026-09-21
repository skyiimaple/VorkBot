class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

Object.defineProperty(window, "scrollTo", {
  value: () => undefined,
  writable: true
});

const memoryStore = new Map<string, string>();
const localStorageStub: Storage = {
  get length() {
    return memoryStore.size;
  },
  clear() {
    memoryStore.clear();
  },
  getItem(key) {
    return memoryStore.has(key) ? memoryStore.get(key)! : null;
  },
  key(index) {
    return [...memoryStore.keys()][index] ?? null;
  },
  removeItem(key) {
    memoryStore.delete(key);
  },
  setItem(key, value) {
    memoryStore.set(key, String(value));
  }
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageStub,
  configurable: true
});
Object.defineProperty(window, "localStorage", {
  value: localStorageStub,
  configurable: true
});
