// Per-globe memory cache. Byte estimates are not JS heap measurements.
export const MiB = 1024 * 1024;

export function createWeightedCache(maxBytes, maxEntries = Infinity) {
  const entries = new Map();
  let bytes = 0;
  let evictions = 0;
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value, weight) {
      this.delete(key);
      if (weight > maxBytes || maxEntries === 0) return;
      entries.set(key, { value, weight });
      bytes += weight;
      while (bytes > maxBytes || entries.size > maxEntries) {
        this.delete(entries.keys().next().value);
        evictions++;
      }
    },
    delete(key) {
      const entry = entries.get(key);
      if (entry) {
        bytes -= entry.weight;
        entries.delete(key);
      }
    },
    clear() {
      entries.clear();
      bytes = 0;
    },
    stats: () => ({ entries: entries.size, bytes, evictions }),
  };
}

// Coordinate storage estimate, including array overhead.
export function estimateGeometryBytes(geometry) {
  let bytes = 128;
  const visit = (value) => {
    if (Array.isArray(value)) {
      bytes += 32 + value.length * 8;
      for (const child of value) if (Array.isArray(child)) visit(child);
    }
  };
  visit(geometry?.coordinates);
  return bytes;
}

export function createGeometryCache({
  fetcher = globalThis.fetch,
  baseUrl = globalThis.location?.href,
  maxBytes = 256 * MiB,
} = {}) {
  const ready = createWeightedCache(maxBytes);
  const pending = new Map();
  const lifetime = new AbortController();
  let hits = 0, joined = 0, downloads = 0, failures = 0;
  const counts = new Map();
  function load(url) {
    const key = new URL(url, baseUrl).href;
    if (lifetime.signal.aborted)
      return Promise.reject(new DOMException("Disposed", "AbortError"));
    const cached = ready.get(key);
    if (cached) {
      hits++;
      return Promise.resolve(cached);
    }
    if (pending.has(key)) {
      joined++;
      return pending.get(key);
    }
    downloads++;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const promise = Promise.resolve()
      .then(() => fetcher(key, { signal: lifetime.signal }))
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Geometry HTTP " + response.status + ": " + key);
        const text = await response.text();
        const bytes = new TextEncoder().encode(text).length;
        const value = { data: JSON.parse(text), bytes };
        if (!lifetime.signal.aborted) ready.set(key, value, bytes * 4 + 128);
        return value;
      })
      .catch((error) => {
        failures++;
        throw error;
      })
      .finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }
  return {
    load,
    fetch: async (url) => {
      const { data } = await load(url);
      return { ok: true, json: async () => data };
    },
    stats: () => ({
      ...ready.stats(),
      hits, joined, downloads, failures,
      pending: pending.size,
      byUrl: Object.fromEntries(counts),
    }),
    dispose() {
      lifetime.abort();
      pending.clear();
      ready.clear();
    },
  };
}

export function createRegionalFrameCache() {
  const cache = createWeightedCache(16 * MiB, 8);
  return {
    get: (level) => cache.get(level),
    set: (level, frame) =>
      cache.set(level, frame, estimateGeometryBytes(frame.geometry)),
    clear: () => cache.clear(),
  };
}
