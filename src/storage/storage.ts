// Section 34/35/56: local persistence with a safe in-memory fallback so the
// game stays fully playable in private-browsing / storage-disabled
// environments (Safari included) instead of throwing/crashing.

const memoryStore = new Map<string, string>();
let localStorageAvailable = true;

function probeLocalStorage(): boolean {
  try {
    const key = '__cw_probe__';
    window.localStorage.setItem(key, '1');
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

localStorageAvailable = typeof window !== 'undefined' && probeLocalStorage();

export function storageGet(key: string): string | null {
  try {
    if (localStorageAvailable) return window.localStorage.getItem(key);
  } catch {
    localStorageAvailable = false;
  }
  return memoryStore.get(key) ?? null;
}

export function storageSet(key: string, value: string): void {
  try {
    if (localStorageAvailable) {
      window.localStorage.setItem(key, value);
      return;
    }
  } catch {
    localStorageAvailable = false;
  }
  memoryStore.set(key, value);
}

export function isPersistent(): boolean {
  return localStorageAvailable;
}
