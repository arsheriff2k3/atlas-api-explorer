/** Read a rebranded browser preference without losing data saved by Atlas. */
export function readBrandStorage(key: string, legacyKey: string): string | null {
  try {
    const current = localStorage.getItem(key);
    if (current !== null) return current;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) localStorage.setItem(key, legacy);
    return legacy;
  } catch {
    return null;
  }
}
