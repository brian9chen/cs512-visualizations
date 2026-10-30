(() => {
  "use strict";

  const KEY = "profile:42";
  const VALUES = Object.freeze({ 1: "Away", 2: "Online" });
  const PLACEMENT = Object.freeze({ "profile:42": 0, "profile:77": 2, "profile:105": 1 });

  function sequence(initial) {
    let state = { ...initial };
    const steps = [];
    return {
      steps,
      add(phase, title, detail, patch = {}) {
        state = { ...state, phase, title, detail, ...patch };
        steps.push(structuredClone(state));
      },
    };
  }

  function newCache(key = KEY) {
    return { key, value: null, generation: 0, nextToken: 17, lease: null };
  }

  function leaseGet(cache, client) {
    if (cache.value !== null) return { cache, result: "hit", value: cache.value, token: null };
    if (cache.lease) return { cache, result: "retry", value: null, token: null };
    const label = `L${cache.nextToken}`;
    const token = `${cache.key}:${cache.generation}:${label}`;
    return {
      cache: { ...cache, nextToken: cache.nextToken + 1, lease: { token, label, client } },
      result: "lease", value: null, token,
    };
  }

  function invalidate(cache) {
    return { ...cache, value: null, lease: null, generation: cache.generation + 1 };
  }

  function leaseFill(cache, token, value) {
    if (!cache.lease || cache.lease.token !== token) return { cache, accepted: false };
    return { cache: { ...cache, value, lease: null }, accepted: true };
  }

  function basicsSteps(scenario = "miss") {
    const q = sequence({ db: 1, cache: scenario === "miss" ? null : 1, held: null, returned: null, reads: 0, writes: 0, event: "none" });
    const add = q.add.bind(q);
    add("Start", "The database owns the durable value", "The application manages this look-aside cache. A cache hit can avoid a database query; Memcached does not fetch missing values from the database by itself.");
    if (scenario === "write") {
      add("Write DB", "Send the write to the database first", "The application updates the authoritative profile from v1 (Away) to v2 (Online). The cache is not on the durable write path.", { event: "update" });
      add("Commit", "The database commits v2", "The write is durable. The cached v1 is now older than the database; the following invalidation has not happened yet.", { db: 2, writes: 1, event: "commit" });
      add("Invalidate", "Delete the cached key after the commit", "The application sends delete(profile:42). It removes the cached copy instead of writing v2 through the cache.", { cache: null, event: "delete" });
      add("Read", "A later read misses", "The next request tries the cache first. An empty entry sends this request down the database fallback path.", { event: "get" });
      add("Fetch", "Read the committed v2 from the database", "The application fetches the new value and holds it locally before refilling the cache.", { held: 2, reads: 1, event: "fetch" });
      add("Fill", "Refill the cache on demand", "A cache set stores v2 for future reads. The application, not the database, performs this cache fill.", { cache: 2, event: "fill" });
      add("Return", "Return v2 to the caller", "A future cache hit can reuse v2. This sequential example shows the intended write path; the Stale refills tab adds a concurrent reader.", { returned: 2, event: "return" });
    } else {
      add("Read", `get(${KEY})`, "The application asks Memcached for the key. Database work happens only if the needed value is absent.", { event: "get" });
      if (scenario === "hit") {
        add("Hit", "A cache hit returns v1", "The requested value is already cached. The application can return it without querying the database.", { held: 1, returned: 1, event: "hit" });
        add("Return", "Zero database reads for this request", "The cache is a performance layer. It remains disposable: a missing entry can be rebuilt from the authoritative store.", { event: "return" });
      } else {
        add("Miss", "The key is not cached", "A miss is not a missing database record. The application must fetch the value from storage.", { event: "miss" });
        add("Fetch", "Fall back to the database", "The database returns v1. The application now has a local copy, while Memcached still has no value for this key.", { held: 1, reads: 1, event: "fetch" });
        add("Fill", "Set the fetched value in the cache", "The application stores v1 so later requests can take the shorter cache-hit path.", { cache: 1, event: "fill" });
        add("Return", "Return the value to the caller", "This request needed one database read. A later hit needs none. The database remains authoritative in both cases.", { returned: 1, event: "return" });
      }
    }
    return q.steps;
  }

  function raceSteps() {
    let cache = newCache();
    let token;
    const q = sequence({ db: 1, held: null, plain: null, leased: cache, tokenLabel: "Not issued", reader: "Ready", writer: "Ready", rejected: false, plainReply: null, leaseReply: null, event: "none" });
    const add = q.add.bind(q);
    add("Start", "Same interleaving, two refill policies", "Both caches start empty. Reader A will pause after fetching v1; Writer B will commit v2 and invalidate the key before that reader resumes.");
    const get = leaseGet(cache, "Reader A");
    cache = get.cache;
    token = get.token;
    add("Miss", "The reader misses; the lease path receives L17", "An ordinary miss grants no refill authorization. In the Facebook lease design, the cache returns a key-bound token that must accompany the later fill.", { leased: cache, tokenLabel: "L17 · live", reader: "Miss · token L17 on right", event: "get" });
    add("Pause", "Reader A fetches v1, then pauses", "Both database reads finish before the write. The reader holds v1 locally, but neither cache has been filled yet.", { held: 1, reader: "Paused · holding v1", event: "fetch" });
    add("Commit", "Writer B commits v2 to the database", "The reader’s old local copy still exists. Updating the database does not reach into another application request and replace its buffered value.", { db: 2, writer: "Committed v2", event: "update" });
    cache = invalidate(cache);
    add("Invalidate", "The writer deletes the key and revokes L17", "Even though the lease cache has no value to delete, invalidation revokes its outstanding token. The delayed reader can no longer use that token to refill.", { leased: cache, tokenLabel: "L17 · revoked", writer: "Delete sent", event: "delete" });
    const fill = leaseFill(cache, token, 1);
    cache = fill.cache;
    add("Late fill", "The delayed reader tries to set v1", "Left: an unconditional set restores stale v1. Right: the cache rejects the refill because L17 was revoked. Keeping an empty entry is safer than accepting this known stale refill.", { plain: 1, leased: cache, rejected: !fill.accepted, reader: "Resumed · offers v1", event: "late-fill" });
    const fresh = leaseGet(cache, "Next reader");
    cache = fresh.cache;
    add("Retry", "The next request takes different paths", "Left: the next reader hits stale v1. Right: the cache is empty, so a new reader obtains L18 and fetches v2 from the database.", { leased: cache, tokenLabel: "L18 · live", plainReply: 1, reader: "Next request", event: "retry" });
    cache = leaseFill(cache, fresh.token, 2).cache;
    add("Result", "A revoked token cannot reintroduce the old value", "The ordinary cache still serves v1; the lease path now stores and serves v2. The lease protected later refills, not the response of the original read that already fetched v1.", { leased: cache, tokenLabel: "L18 · used", leaseReply: 2, event: "result" });
    return q.steps;
  }

  function herdSteps(count = 4) {
    const readers = Math.max(3, Math.min(8, Math.round(count)));
    const q = sequence({ readers, plainReads: 0, leaseReads: 0, plainFills: 0, leaseFills: 0, plainCache: null, leaseCache: null, waiting: 0, hits: 0, event: "none" });
    const add = q.add.bind(q);
    add("Start", `${readers} readers arrive for one uncached key`, "This is one burst of requests for the same hot key. The database is healthy and the request that receives the lease will finish normally.");
    add("Miss", "All readers see a cache miss", "Without coordination, every miss can trigger the same fallback query. A lease-aware miss response can tell competing readers to wait and retry.", { event: "get" });
    add("Admit", "One eligible refill, instead of a burst of queries", `Left: all ${readers} readers query the database. Right: one reader receives a refill token, while ${readers - 1} readers wait. Token issuance is rate-limited in the paper’s design.`, { plainReads: readers, leaseReads: 1, waiting: readers - 1, event: "query" });
    add("Fetch", "The database returns the same v1", "Every fallback query on the left returns the same value. On the right, the token holder fetches it once for the waiting group.", { event: "fetched" });
    add("Fill", "The token holder fills the cache once", `Left: ${readers} requests offer the same v1 to the cache. Right: only the lease holder performs the refill. No concurrent writer is present in this burst.`, { plainCache: 1, leaseCache: 1, plainFills: readers, leaseFills: 1, event: "fill" });
    add("Retry", "Waiting readers retry and hit the filled cache", "The lease holder has supplied the missing value. The waiting requests can now finish without issuing their own database queries.", { waiting: 0, hits: readers - 1, event: "retry" });
    add("Result", `${readers} database reads versus 1 for this burst`, "The same lease idea addresses two problems: reject a stale refill after invalidation, and reduce duplicate fallback work during a miss storm. This is a toy count, not a performance benchmark.", { event: "result" });
    return q.steps;
  }

  function clusterSteps(key = KEY) {
    const shard = PLACEMENT[key] ?? 0;
    const q = sequence({ scope: "cluster", key, shard, cached: false, reads: 0, event: "none" });
    const add = q.add.bind(q);
    add("Start", "One frontend cluster, several cache servers", "Web servers share a placement map for keys. The chosen key belongs to one cache shard in this example; a Memcached server does not automatically forward a miss to its peers.");
    add("Route", `Route ${key} to cache ${shard + 1}`, "The application’s client routing chooses the destination. This view uses a small explicit placement map, not a simulation of a production hash ring.", { event: "route" });
    add("Miss", "The selected cache shard has no value", "Only the key’s destination is queried. Adding cache servers spreads key storage and load; it does not make every server a copy of every other server.", { event: "get" });
    add("Fetch", "The web server reads the backing database", "The application follows the same look-aside fallback as in Cache basics. The cache server itself does not fetch from the database.", { reads: 1, event: "fetch" });
    add("Fill", `Fill cache ${shard + 1} with v1`, "The fetched value is stored at its assigned destination. Other keys can live on other shards.", { cached: true, event: "fill" });
    add("Hit", "A later request uses the same placement", "Any web server using this map can find the cached value. Key placement within a cluster differs from copying a popular value into multiple frontend clusters.", { event: "hit" });
    return q.steps;
  }

  function regionSteps() {
    const q = sequence({ scope: "region", db: 1, cacheA: 1, cacheB: 1, log: false, event: "none" });
    const add = q.add.bind(q);
    add("Start", "Two frontend clusters share authoritative storage", "Demand has cached v1 in both clusters. A database update must eventually invalidate the relevant cached copies in this region.");
    add("Commit", "The database commits v2", "Both caches can still contain v1 while invalidation messages are in flight. This is not a transaction that atomically updates every cache.", { db: 2, log: true, event: "commit" });
    add("Local delete", "The writer invalidates its own cluster", "The application sends a local delete to Cluster A. That alone does not clear Cluster B’s independent cached copy.", { cacheA: null, event: "local-delete" });
    add("Log", "mcsqueal reads the committed invalidation", "The storage-side daemon extracts the keys to invalidate from committed updates. Logged invalidations can be replayed if needed.", { event: "log" });
    add("Fan out", "Route deletes to both frontend clusters", "The daemon batches invalidations for dedicated mcrouter instances. Each router sends individual deletes to the correct Memcached servers within its cluster.", { cacheA: null, cacheB: null, event: "fanout" });
    add("Refill", "Cluster B refills on the next read", "A request in B now misses and fetches v2 from shared storage. Cache copies are populated by demand, not by broadcasting database values.", { cacheB: 2, event: "refill" });
    return q.steps;
  }

  function crossRegionSteps(ordering = "correct") {
    const wrong = ordering === "early";
    const q = sequence({ scope: "regions", ordering, master: 1, replica: 1, masterCache: 1, replicaCache: 1, fetched: null, returned: null, events: [], event: "none" });
    const add = q.add.bind(q);
    add("Start", "A writable master and an asynchronous replica", "Each region has local caches. Replica reads can lag the master; the goal here is to avoid refilling a cache from a replica that has not applied the update.");
    add("Commit", "The master database commits v2", "The replication stream has not reached the replica database yet. The replica region still has v1 in both its database and cache.", { master: 2, event: "commit", events: ["commit-master"] });
    if (wrong) {
      add("Too early", "Counterexample: send the regional delete too early", "The master-side writer invalidates the remote cache before database replication arrives. This removes the old cache entry but leaves the remote fallback source at v1.", { masterCache: null, replicaCache: null, event: "early-delete", events: ["commit-master", "delete-master", "delete-replica"] });
      add("Miss", "A remote cache miss reads the old replica", "The application cannot find a cached value and fetches v1 from its local replica database. Nothing in this ordering tells that reader the replica is behind.", { fetched: 1, event: "fetch", events: ["commit-master", "delete-master", "delete-replica", "read-replica"] });
      add("Stale fill", "The replica region caches v1 again", "The value matches the old replica database, but it is already older than the master’s committed v2.", { replicaCache: 1, event: "fill", events: ["commit-master", "delete-master", "delete-replica", "read-replica", "fill-replica"] });
      add("Apply", "Replication finally applies v2", "Updating the replica database does not automatically overwrite a previously filled cache. In this counterexample, the only remote invalidation already happened.", { replica: 2, event: "replicate", events: ["commit-master", "delete-master", "delete-replica", "read-replica", "fill-replica", "apply-replica"] });
      add("Result", "A later cache hit can still return v1", "The remote database has v2, but its cache has v1. A further delete or expiry could remove it; sending the only invalidation early did not prevent this stale refill.", { returned: 1, event: "result" });
    } else {
      add("Local delete", "Invalidate within the master region", "A local delete is safe to follow with a read from the updated master database. Do not send that delete ahead of replication in the remote region.", { masterCache: null, event: "local-delete", events: ["commit-master", "delete-master"] });
      add("Apply", "First apply the replication stream", "The replica database advances to v2. Its committed update can now drive the replica region’s own invalidation pipeline.", { replica: 2, event: "replicate", events: ["commit-master", "delete-master", "apply-replica"] });
      add("Invalidate", "Then invalidate the replica-region cache", "The remote cache is deleted after the replica database applies the update. A subsequent miss no longer falls back to the old database version in this schedule.", { replicaCache: null, event: "delete-replica", events: ["commit-master", "delete-master", "apply-replica", "delete-replica"] });
      add("Miss", "The next remote miss fetches v2", "The local replica now has the committed value. The application reads v2 and can safely use it to fill this cache in the illustrated interleaving.", { fetched: 2, event: "fetch", events: ["commit-master", "delete-master", "apply-replica", "delete-replica", "read-replica"] });
      add("Result", "Refill with v2 after replication and invalidation", "This ordering avoids the early-invalidation refill error. Asynchronous replication and invalidation still allow stale-read windows; this is not a strong-consistency protocol.", { replicaCache: 2, returned: 2, event: "fill", events: ["commit-master", "delete-master", "apply-replica", "delete-replica", "read-replica", "fill-replica"] });
    }
    return q.steps;
  }

  const model = Object.freeze({ KEY, VALUES, PLACEMENT, newCache, leaseGet, invalidate, leaseFill, basicsSteps, raceSteps, herdSteps, clusterSteps, regionSteps, crossRegionSteps });
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  else globalThis.MemcachedModel = model;
})();
