const assert = require("node:assert/strict");
const { test } = require("node:test");
const M = require("../js/spark-model.js");

test("defining and marking the RDD do no input work; count computes its records", () => {
  for (const caching of [true, false]) {
    const steps = M.lifecycleSteps(caching);
    assert.equal(steps.length, 4);
    for (const step of steps.slice(0, 2)) {
      assert.equal(step.scans, 0);
      assert.equal(step.filterRecords, 0);
      assert.equal(step.computed, false);
      assert.equal(step.resident, false);
      assert.equal(step.result.all, null);
    }
    assert.equal(steps[0].marked, false);
    assert.equal(steps[1].marked, caching);
    assert.equal(steps[2].computed, true);
    assert.equal(steps[2].resident, caching);
    assert.equal(steps[2].scans, 1);
    assert.equal(steps[2].result.all, M.LIFECYCLE_ERRORS.flat().length);
  }
});

test("the second count reuses cached errors or scans again, with the same answer", () => {
  const cached = M.lifecycleSteps(true).at(-1);
  const uncached = M.lifecycleSteps(false).at(-1);
  const errors = M.LIFECYCLE_LOGS.flat().filter((line) => line.startsWith("ERROR"));
  const expected = { all: errors.length, mysql: errors.filter((line) => line.includes("MySQL")).length };
  assert.deepEqual(cached.result, expected);
  assert.deepEqual(uncached.result, expected);
  assert.deepEqual([cached.scans, uncached.scans], [1, 2]);
  assert.deepEqual([cached.filterRecords, uncached.filterRecords], [6, 12]);
  assert.equal(cached.active, "reuse");
  assert.equal(uncached.active, "recompute");
  assert.equal(cached.resident, true);
  assert.equal(uncached.resident, false);
  M.LIFECYCLE_ERRORS.forEach((partition, i) => assert.deepEqual(partition, M.LIFECYCLE_LOGS[i].filter((line) => line.startsWith("ERROR"))));
});

test("a narrow pipeline keeps partition paths and needs one stage", () => {
  const steps = M.executionSteps("narrow");
  assert.ok(steps.every((step) => step.stages === 1 && step.shuffleRecords === 0));
  assert.equal(steps[0].tasks, 0);
  assert.equal(steps.at(-1).tasks, M.WORD_LINES.length);
  assert.equal(steps.at(-1).result, M.WORDS.flat().filter((word) => word.length >= 5).length);
  M.NARROW.forEach((partition, i) => assert.deepEqual(partition, M.WORDS[i].filter((word) => word.length >= 5)));
});

test("the shuffle routes every locally combined count once and preserves word totals", () => {
  const steps = M.executionSteps("shuffle");
  const localPairs = M.COMBINED.reduce((n, partition) => n + Object.keys(partition).length, 0);
  assert.equal(localPairs, 15);
  assert.equal(steps.find((step) => step.phase === "Combine").shuffleRecords, 0);
  assert.equal(steps.find((step) => step.phase === "Shuffle").shuffleRecords, localPairs);
  let shuffledPairs = 0;
  M.BUCKETS.forEach((bucket, i) => bucket.forEach(({ word, values }) => {
    assert.equal(M.WORD_PARTITION[word], i);
    assert.deepEqual(values, M.COMBINED.filter((partition) => partition[word]).map((partition) => partition[word]));
    shuffledPairs += values.length;
  }));
  assert.equal(shuffledPairs, localPairs);
  const expected = {};
  for (const word of M.WORDS.flat()) expected[word] = (expected[word] || 0) + 1;
  assert.deepEqual(Object.fromEntries(M.COUNTS.flat().map(({ word, count }) => [word, count])), expected);
  assert.equal(M.COUNTS.flat().reduce((n, item) => n + item.count, 0), 18);
  assert.equal(steps.at(-1).result, Object.values(expected).filter((n) => n >= 2).length);
  assert.equal(steps.at(-1).stages, 2);
  assert.equal(steps.at(-1).tasks, 6);
});

test("each lost block is rebuilt on another worker from just its required durable partition", () => {
  assert.equal(M.recoverySteps().length, 1);
  const before = JSON.stringify([M.LOGS, M.ERRORS, M.SERVICES, M.FINAL]);
  for (const checkpoint of [false, true]) {
    for (const target of [0, 1, 2]) {
      const steps = M.recoverySteps({ target, checkpoint });
      assert.equal(steps[1].lost, true);
      assert.equal(steps[2].traced, true);
      assert.equal(steps[2].reads, 0);
      assert.equal(steps[3].reads, 1);
      assert.equal(steps[3].recordsRead, (checkpoint ? M.ERRORS : M.LOGS)[target].length);
      assert.equal(steps[4].recoveryTasks, 1);
      assert.equal(steps[4].transforms, checkpoint ? 2 : 3);
      const result = steps.at(-1);
      assert.equal(result.restored, true);
      assert.equal(result.lost, false);
      assert.notEqual(result.worker, target);
      const source = checkpoint ? M.ERRORS[target] : M.LOGS[target].filter((line) => line.startsWith("ERROR"));
      assert.deepEqual(source.map((line) => line.split(" ")[1]).filter((service) => service !== "scheduler"), M.FINAL[target]);
    }
  }
  assert.equal(JSON.stringify([M.LOGS, M.ERRORS, M.SERVICES, M.FINAL]), before);
});
