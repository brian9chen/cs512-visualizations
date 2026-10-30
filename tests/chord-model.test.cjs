const assert = require("node:assert/strict");
const { test } = require("node:test");
const M = require("../js/chord-model.js");

test("finger starts and successor rounding wrap through zero", () => {
  assert.deepEqual(M.fingers(60).map(({ start, node }) => [start, node]), [
    [61, 2], [62, 2], [0, 2], [4, 7], [12, 13], [28, 32],
  ]);
  assert.equal(M.successor(63), 2);
  assert.equal(M.successor(50), 50);
});

test("the two walkthroughs have distinct expected lookup paths", () => {
  assert.deepEqual(M.createSteps(M.SCENARIOS[0]).at(-1).path, [7, 44, 50, 56]);
  assert.deepEqual(M.createSteps(M.SCENARIOS[1]).at(-1).path, [44, 60, 2, 7]);
  assert.equal(M.successorPath(7, 54).length - 1, 8);
  assert.equal(M.successorPath(44, 5).length - 1, 5);
});

test("every key from every active node reaches the correct owner without loops", () => {
  for (const source of M.NODES) {
    for (let key = 0; key < M.SIZE; key++) {
      const steps = M.createSteps({ source, key });
      const final = steps.at(-1);
      assert.equal(final.node, M.successor(key), `source ${source}, key ${key}`);
      assert.equal(new Set(final.path).size, final.path.length);
      assert.ok(final.path.length <= M.successorPath(source, key).length);
      for (const step of steps) {
        if (step.phase !== "select") continue;
        const chosen = M.fingers(step.node)[step.selected];
        const gap = M.distance(step.node, chosen.node);
        assert.ok(gap > 0 && gap < M.distance(step.node, key));
        for (const finger of M.fingers(step.node).slice(step.selected + 1)) {
          const distance = M.distance(step.node, finger.node);
          assert.ok(distance === 0 || distance >= M.distance(step.node, key));
        }
      }
    }
  }
});
