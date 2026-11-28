# Globe geometry caching

Both globe entry points use a per-instance, URL-keyed memory cache for built-in world atlases, regional catalogs, Geo Packs inventory and world envelopes, and regional topology downloads. Pending fetches are shared and successful parsed JSON is retained under an estimated 256 MiB LRU budget. Failed HTTP/JSON operations remain retryable. Browser HTTP caching is still available beneath this cache. The cache owns its cancellation signal; source selection no longer cancels shared downloads. Disposal clears it.

Regional workers use separate active (6 international) and warm (6 international) limits. The two US workers remain resident after first use. Hidden warm workers do not render or request new LOD frames. On eviction, original mesh and latest frame are retained in a separate estimated 256 MiB LRU, keyed by URL and extraction policy. Reactivation restores those meshes before rebuilding the engine. Each live regional worker retains up to eight successful LOD frames under an estimated 16 MiB budget. These estimates exclude engine internals and transient structured clones; they are not hard browser heap limits. World source switches reuse downloads but rebuild world engines in this iteration.

Diagnostics reports cache hits, joined requests, fetch attempts per URL, eviction counts, regional builds and worker counts through the text panel and globeDebug.cacheStats(). Fetch attempts are not a measurement of network transfers; HTTP caching may satisfy them.

## Acceptance

1. Open the CDN globe with DevTools HTTP cache disabled. Zoom into Canada at least 3x, zoom out below 2.7x and back in ten times. Confirm the Canadian URL has one fetch attempt and the regional build count does not rise while warm.
2. Explore more than six inactive regional datasets; return to an evicted country. Confirm the prepared cache hit increments, the original mesh is immediately available, and no new source fetch is needed while cached.
3. Switch world atlases 50m/110m several times and verify one fetch per URL. Check regional data remains reusable.
4. Simulate fetch failure, leave the region, and reenter after restoring connectivity. Verify a retry.
5. Repeat on mobile and record actual memory usage; tune budgets if needed. No persistent storage or offline guarantee.
