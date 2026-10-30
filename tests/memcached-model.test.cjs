const assert = require("node:assert/strict");
const { test } = require("node:test");
const M = require("../js/memcached-model.js");

test("a hit avoids storage, while a miss fetches and fills through the application", () => {
  const hit = M.basicsSteps("hit");
  assert.ok(hit.every((step) => step.reads === 0));
  assert.equal(hit.at(-1).returned, 1);
  const miss = M.basicsSteps("miss");
  const fetched = miss.findIndex((step) => step.event === "fetch");
  const filled = miss.findIndex((step) => step.event === "fill");
  assert.ok(fetched < filled);
  assert.equal(miss[fetched].held, 1);
  assert.equal(miss[fetched].cache, null);
  assert.equal(miss.at(-1).cache, 1);
  assert.equal(miss.at(-1).reads, 1);
});

test("the write path commits before deleting and later refills from the new database value", () => {
  const steps = M.basicsSteps("write");
  const commit = steps.findIndex((step) => step.event === "commit");
  const remove = steps.findIndex((step) => step.event === "delete");
  assert.ok(commit < remove);
  assert.equal(steps[commit].db, 2);
  assert.equal(steps[commit].cache, 1);
  assert.equal(steps[remove].cache, null);
  assert.equal(steps.at(-1).cache, 2);
  assert.equal(steps.at(-1).returned, 2);
});

test("delete revokes an outstanding key-bound token even with an empty cache", () => {
  const first = M.leaseGet(M.newCache(), "A");
  assert.equal(first.result, "lease");
  const other = M.leaseGet(first.cache, "B");
  assert.equal(other.result, "retry");
  assert.equal(other.token, null);
  const invalidated = M.invalidate(first.cache);
  assert.equal(invalidated.value, null);
  assert.equal(invalidated.lease, null);
  assert.equal(M.leaseFill(invalidated, first.token, 1).accepted, false);
  const next = M.leaseGet(invalidated, "B");
  assert.notEqual(first.token, next.token);
  assert.equal(M.leaseFill(next.cache, first.token, 1).accepted, false);
  const success = M.leaseFill(next.cache, next.token, 2);
  assert.equal(success.accepted, true);
  assert.equal(success.cache.value, 2);
  assert.equal(M.leaseFill(success.cache, next.token, 1).accepted, false);
  const differentKey = M.leaseGet(M.newCache("profile:77"), "A");
  assert.equal(M.leaseFill(differentKey.cache, next.token, 2).accepted, false);
});

test("the delayed-refill schedule restores stale data only on the unconditional-set path", () => {
  const steps = M.raceSteps();
  const late = steps.find((step) => step.event === "late-fill");
  assert.equal(late.db, 2);
  assert.equal(late.plain, 1);
  assert.equal(late.leased.value, null);
  assert.equal(late.rejected, true);
  const final = steps.at(-1);
  assert.equal(final.plainReply, 1);
  assert.equal(final.leaseReply, 2);
  assert.equal(final.leased.value, 2);
  assert.equal(final.held, 1);
  assert.equal(steps[1].leased.lease.label, "L17");
  assert.equal(steps[1].leased.value, null);
});

test("one healthy miss wave uses one lease refill for every supported reader count", () => {
  for (let readers = 3; readers <= 8; readers++) {
    const steps = M.herdSteps(readers);
    const admitted = steps.find((step) => step.event === "query");
    assert.equal(admitted.plainReads, readers);
    assert.equal(admitted.leaseReads, 1);
    assert.equal(admitted.waiting, readers - 1);
    const final = steps.at(-1);
    assert.equal(final.leaseFills, 1);
    assert.equal(final.hits, readers - 1);
    assert.equal(final.waiting, 0);
    assert.equal(final.leaseCache, final.plainCache);
  }
});

test("regional invalidation clears independent cache copies after the committed update", () => {
  for (const [key, shard] of Object.entries(M.PLACEMENT)) {
    const final = M.clusterSteps(key).at(-1);
    assert.equal(final.shard, shard);
    assert.equal(final.cached, true);
    assert.equal(final.reads, 1);
  }
  const steps = M.regionSteps();
  const local = steps.find((step) => step.event === "local-delete");
  assert.equal(local.db, 2);
  assert.equal(local.cacheA, null);
  assert.equal(local.cacheB, 1);
  const fanout = steps.find((step) => step.event === "fanout");
  assert.equal(fanout.cacheA, null);
  assert.equal(fanout.cacheB, null);
  assert.equal(steps.at(-1).cacheB, 2);
});

test("replica apply before invalidation avoids the demonstrated cross-region stale refill", () => {
  const correct = M.crossRegionSteps("correct").at(-1);
  assert.ok(correct.events.indexOf("apply-replica") < correct.events.indexOf("delete-replica"));
  assert.equal(correct.replica, 2);
  assert.equal(correct.replicaCache, 2);
  assert.equal(correct.returned, 2);
  const early = M.crossRegionSteps("early").at(-1);
  assert.ok(early.events.indexOf("delete-replica") < early.events.indexOf("apply-replica"));
  assert.equal(early.replica, 2);
  assert.equal(early.replicaCache, 1);
  assert.equal(early.returned, 1);
});
