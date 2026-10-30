const assert = require("node:assert/strict");
const { test } = require("node:test");
const M = require("../js/spanner-model.js");

test("cross-group commits retain locks and hide buffered values until commit wait passes", () => {
  for (let epsilon = 1; epsilon <= 12; epsilon++) {
    for (const recovery of [false, true]) {
      const steps = M.transactionSteps({ epsilon, recovery });
      const prepared = steps.find((step) => step.prepared);
      const durable = steps.find((step) => step.durable);
      assert.ok(steps.indexOf(prepared) < steps.indexOf(durable));
      assert.ok(durable.timestamp >= 102);
      assert.ok(durable.timestamp > 103);
      assert.ok(durable.timestamp > 100 + epsilon);
      for (const step of steps) {
        assert.equal(step.a + step.b, 1600);
        if (step.applied || step.replied) {
          assert.ok(step.durable);
          assert.ok(M.after(step.earliest, step.timestamp));
        }
        if (step.buffer && !step.applied) {
          assert.equal(step.a, 1000);
          assert.equal(step.b, 600);
          assert.notEqual(step.locks, "None");
        }
        if (step.crashed) assert.equal(step.aLog, durable.aLog);
      }
      assert.equal(steps.at(-1).a, 800);
      assert.equal(steps.at(-1).b, 800);
      assert.equal(steps.at(-1).locks, "None");
      if (recovery) assert.equal(steps.at(-1).leader, 2);
    }
  }
});

test("single-group transactions bypass participant preparation but still use Paxos and TrueTime", () => {
  const steps = M.transactionSteps({ single: true });
  assert.ok(!steps.some((step) => step.phase === "Prepare"));
  assert.ok(!steps.some((step) => step.prepared));
  assert.ok(steps.some((step) => step.durable && !step.applied));
  assert.ok(steps.some((step) => step.timestamp !== null && !M.after(step.earliest, step.timestamp)));
  assert.equal(steps.at(-1).bLog, "Not involved");
  assert.equal(steps.at(-1).b, 800);
});

test("wound-wait aborts the younger holder before a wait cycle can form", () => {
  const naive = M.lockingSteps("deadlock").at(-1);
  assert.equal(naive.wait1, "B");
  assert.equal(naive.wait2, "A");
  assert.equal(naive.deadlock, true);
  const steps = M.lockingSteps("wound");
  const wound = steps.find((step) => step.wounded);
  assert.equal(wound.ownerB, null);
  assert.match(wound.t2, /Aborted/);
  assert.ok(!steps.some((step) => step.wait1 && step.wait2));
  assert.equal(steps.at(-1).ownerA, null);
  assert.equal(steps.at(-1).ownerB, null);
  assert.match(steps.find((step) => step.phase === "Retry").t2, /age 20/);
});

test("ordinary 2PC does not release prepared participants while the decision is unavailable", () => {
  const blocked = M.twoPCSteps({ scenario: "crash" }).at(-1);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.decision, "COMMIT");
  assert.equal(blocked.offline, true);
  assert.equal(blocked.released, false);
  assert.equal(blocked.preparedA && blocked.preparedB, true);
  const recovered = M.twoPCSteps({ scenario: "crash", recovered: true });
  assert.ok(recovered.filter((step) => step.decision).every((step) => step.decision === "COMMIT"));
  assert.equal(recovered.at(-1).released, true);
  const abort = M.twoPCSteps({ scenario: "abort" }).at(-1);
  assert.equal(abort.decision, "ABORT");
  assert.equal(abort.released, true);
  assert.equal(abort.preparedB, false);
});

test("TrueTime uses the strict lower-bound test and larger uncertainty takes longer", () => {
  let lastWait = 0;
  for (let epsilon = 1; epsilon <= 12; epsilon++) {
    const timestamp = M.stamp(epsilon);
    const boundary = timestamp - 100 + epsilon;
    assert.equal(M.trueTime(epsilon, boundary).ready, false);
    assert.equal(M.trueTime(epsilon, boundary + 1).ready, true);
    assert.equal(M.trueTime(epsilon, boundary).remaining, 1);
    assert.ok(boundary + 1 >= lastWait);
    lastWait = boundary + 1;
  }
});

test("snapshot reads pick inclusive versions and require both replicas' safe times", () => {
  for (let epsilon = 1; epsilon <= 12; epsilon++) {
    const first = M.stamp(epsilon);
    assert.equal(M.snapshot({ epsilon, at: first - 1 }).selected.a, 1000);
    assert.equal(M.snapshot({ epsilon, at: first }).selected.a, 800);
    assert.equal(M.snapshot({ epsilon, at: first + 25 }).selected.a, 850);
    for (const blocker of ["ready", "lag", "prepared"]) {
      for (let at = 80; at <= first + 35; at++) {
        const r = M.snapshot({ epsilon, at, blocker });
        assert.equal(r.selected.a + r.selected.b, 1600);
        assert.ok(r.selected.timestamp <= at);
        assert.equal(r.ready, at <= r.safeA && at <= r.safeB);
        assert.equal(r.safeB, Math.min(r.paxosB, r.preparedLimit));
        assert.equal(M.snapshot({ epsilon, at, blocker, resolved: true }).ready, true);
      }
    }
    assert.equal(M.snapshot({ epsilon, at: first, blocker: "lag" }).ready, false);
    assert.equal(M.snapshot({ epsilon, at: first + 20, blocker: "prepared" }).ready, false);
  }
});
