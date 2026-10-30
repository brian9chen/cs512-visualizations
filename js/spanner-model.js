(() => {
  "use strict";

  const INITIAL = Object.freeze({ A: 1000, B: 600 });
  const TRANSFER = 200;
  const stamp = (epsilon = 4) => Math.max(104, 101 + epsilon);
  const after = (earliest, timestamp) => earliest > timestamp;

  function transactionSteps({ single = false, recovery = false, epsilon = 4 } = {}) {
    const s = stamp(epsilon);
    let state = {
      single, phase: "Start", locks: "None", aLog: "No T1 record", bLog: "No T1 record",
      a: INITIAL.A, b: INITIAL.B, buffer: false, prepared: false, durable: false,
      applied: false, replied: false, leader: 0, crashed: false, timestamp: null,
      earliest: 100 - epsilon, latest: 100 + epsilon, traffic: "none", quorum: false,
    };
    const steps = [];
    const add = (phase, title, detail, patch = {}) => {
      state = { ...state, phase, title, detail, ...patch };
      steps.push({ ...state });
    };
    add("Start", "One transfer. Several guarantees.",
      single ? "Both accounts live in Group A. Its three replicas still use Paxos, but this transaction needs no cross-group 2PC."
        : "Account A lives in Group A; B lives in Group B. Each group has three voting replicas. Group A coordinates this transaction.");
    add("Execute", "Read the accounts and acquire shared locks",
      "T1 reads A = $1,000 and B = $600 through the relevant leaders. Shared locks protect these reads until the transaction finishes.",
      { locks: "S(A), S(B)", traffic: "read" });
    add("Execute", "Buffer the $200 transfer at the client",
      "The client buffers A = $800 and B = $800. These are tentative writes: replicas and other transactions still see committed versions.",
      { buffer: true, traffic: "none" });
    add(single ? "Timestamp" : "Prepare", "Send the buffered writes to the leaders",
      single ? "The client sends both writes to Group A. Its leader upgrades to exclusive locks; no separate participant vote is needed."
        : "The client sends each leader its writes and the coordinator identity. Both leaders acquire exclusive locks; A is the coordinator, B is a participant.",
      { locks: "X(A), X(B)", traffic: "write" });
    if (!single) {
      add("Prepare", "Group B makes its YES vote durable",
        "Leader B chooses prepare timestamp pB = 102 and replicates PREPARE through its Paxos group. A majority makes the prepare durable; B keeps its locks.",
        { prepared: true, bLog: "PREPARE · pB 102", traffic: "paxos-b", quorum: true });
      add("Prepare", "The participant sends YES to the coordinator",
        "B sends its prepare timestamp to Leader A. The coordinator has its own write locks and all required votes. It skips a separate prepare record for its own group.",
        { traffic: "vote" });
    }
    add("Timestamp", `Choose one commit timestamp: s = ${s}`,
      `Choose s ≥ pB (when present), s > the coordinator’s earlier timestamps, and s > TT.now().latest at receipt of the commit request. Here the last assigned timestamp is 103 and that latest bound is ${100 + epsilon}.`,
      { timestamp: s, traffic: "none" });
    add("Replicate", "Replicate the commit decision in Group A",
      "A Paxos majority durably records COMMIT and its timestamp. A durable decision is not permission to expose the new values: commit wait still applies.",
      { durable: true, aLog: `COMMIT · s ${s}`, traffic: "paxos-a", earliest: 103 - epsilon, latest: 103 + epsilon });
    if (recovery) {
      add("Recover", "Leader A fails after the decision is durable",
        "The original leader is unavailable. Two Group A replicas remain, so a majority can recover the committed record. This example injects failure after the Paxos commit, not before a decision exists.",
        { crashed: true, traffic: "none" });
      add("Recover", "A new leader recovers the same decision",
        "The surviving replicas establish a new leader and recover COMMIT(s). Leader-lease and lock-state recovery are summarized here. The new leader must still obey commit wait.",
        { leader: 2, traffic: "recovery" });
    }
    add("Wait", "At the boundary, it is still too early",
      `TT.now().earliest = ${s}, exactly the commit timestamp. TT.after(s) is false: the lower bound must be strictly greater than s. Locks remain held and no success is returned.`,
      { earliest: s, latest: s + 2 * epsilon, traffic: "none" });
    add("Wait", "The commit timestamp is definitely in the past",
      `TT.now().earliest = ${s + 1} > ${s}. Commit wait is satisfied. The coordinator can now publish the decision and report success; the remaining steps show apply before the client reply.`,
      { earliest: s + 1, latest: s + 1 + 2 * epsilon, traffic: single ? "none" : "decision" });
    add("Apply", "Apply both writes at the same timestamp",
      single ? `Group A applies A = $800 and B = $800 at s = ${s}, then releases the locks.`
        : `B logs the commit outcome through Paxos. Both groups apply their writes at s = ${s}, then release locks. Logical atomicity does not require simultaneous physical application.`,
      { a: 800, b: 800, applied: true, locks: "None", bLog: single ? "Not involved" : `COMMIT · s ${s}`, traffic: single ? "paxos-a" : "apply" });
    add("Complete", "The client receives a successful commit",
      single ? "The transfer preserves A + B = $1,600. No cross-group 2PC was needed. Locking protected isolation, Paxos protected the decision, and TrueTime constrained visibility."
        : "The transfer preserves A + B = $1,600. 2PL protected isolation, 2PC coordinated the groups, Paxos protected their records, and TrueTime constrained when the result became visible.",
      { replied: true, traffic: "reply" });
    return steps;
  }

  function lockingSteps(scenario = "contention") {
    let state = { phase: "Start", ownerA: null, ownerB: null, t1: "Ready", t2: "Ready", wait1: null, wait2: null, deadlock: false, wounded: false, committed: false };
    const steps = [];
    const add = (phase, title, detail, patch = {}) => {
      state = { ...state, phase, title, detail, ...patch };
      steps.push({ ...state });
    };
    add("Start", "Two transactions share the same lock table",
      "T1 is older (age 10); T2 is younger (age 20). This focused example uses exclusive locks. A lock is released only when its transaction commits or aborts.");
    add("Acquire", "T1 acquires the lock on A", "T1 begins its transfer and holds X(A). This is the growing phase: it can acquire more locks.", { ownerA: "T1", t1: "Running" });
    if (scenario === "contention") {
      add("Wait", "T2 requests A and waits", "The younger T2 cannot take A from the older T1. T1 keeps its lock and can continue; there is no wait cycle.", { t2: "Waiting for A", wait2: "A" });
      add("Acquire", "T1 also acquires the lock on B", "T1 now holds both locks. Waiting on one key does not stop an unrelated transaction that already owns its needed locks.", { ownerB: "T1" });
      add("Finish", "T1 commits and releases both locks", "A becomes $800 and B becomes $800. The waiting request can now be granted. T1 acquires no more locks after releasing them.", { ownerA: null, ownerB: null, t1: "Committed", committed: true });
      add("Acquire", "T2 is granted the lock on A", "The lock manager grants the queued request. T2 can now perform its own update; T1’s uncommitted values were never exposed.", { ownerA: "T2", t2: "Running", wait2: null });
      add("Finish", "T2 finishes and releases its lock", "Locks protect conflicting operations. Two-phase locking is about when locks are acquired and released, not about two-phase commit messages.", { ownerA: null, t2: "Finished" });
    } else {
      add("Acquire", "T2 acquires the lock on B", "T1 holds A while T2 holds B. What happens next depends on the lock-conflict policy.", { ownerB: "T2", t2: "Running" });
      if (scenario === "deadlock") {
        add("Wait", "Naive waiting: T1 requests B", "Without an age-based prevention policy, T1 waits for the lock held by T2.", { wait1: "B", t1: "Waiting for B" });
        add("Blocked", "T2 requests A: a wait cycle forms", "T1 waits for T2, and T2 waits for T1. This is a counterexample for naive waiting. Switch to Wound-wait to see the cycle prevented at the earlier conflict.", { wait2: "A", t2: "Waiting for A", deadlock: true });
      } else {
        add("Prevent", "Older T1 wounds younger T2", "When T1 requests B, wound-wait aborts the younger holder T2 instead of letting T1 wait. T2’s tentative work is discarded and its lock is released before a cycle can form.", { ownerB: null, t2: "Aborted · wounded", wounded: true });
        add("Acquire", "T1 acquires B without a wait cycle", "The older transaction now owns A and B. Younger transactions may wait for older ones; older transactions wound younger holders.", { ownerB: "T1" });
        add("Finish", "T1 commits its transfer", "T1 commits A = $800 and B = $800, then releases both locks. The aborted transaction can retry.", { ownerA: null, ownerB: null, t1: "Committed", committed: true });
        add("Retry", "T2 retries with its original age", "The retry retains T2’s age for the prevention policy. With no conflicting holder, it can acquire B and continue.", { ownerB: "T2", t2: "Retrying · age 20", wounded: false });
        add("Finish", "The retry finishes", "Wound-wait prevents deadlock; it does not repair an already formed cycle in this example. Retaining age helps a repeatedly retried transaction make progress.", { ownerB: null, t2: "Finished" });
      }
    }
    return steps;
  }

  function twoPCSteps({ scenario = "commit", recovered = false } = {}) {
    let state = { phase: "Start", a: "Ready", b: "Ready", coordinator: "Ready", decision: null, preparedA: false, preparedB: false, released: false, offline: false, blocked: false, messages: [] };
    const steps = [];
    const add = (phase, title, detail, patch = {}, messages = []) => {
      state = { ...state, phase, title, detail, ...patch, messages: [...state.messages, ...messages] };
      steps.push({ ...state, messages: [...state.messages] });
    };
    const message = (from, to, text, y, kind = "prepare") => ({ from, to, text, y, kind });
    add("Start", "Agree on one outcome for the transfer", "This is ordinary 2PC with a separate, unreplicated coordinator and two participants. Each participant has durable local storage. Paxos and TrueTime are not part of this standalone example.");
    add("Prepare", "Coordinator asks both participants to prepare", "A participant checks whether it can commit, records its prepared state durably, and retains the resources needed to honor a YES vote.", { coordinator: "Collecting votes", a: "Checking", b: "Checking" }, [message(0, 1, "PREPARE", 104), message(0, 2, "PREPARE", 135)]);
    if (scenario === "abort") {
      add("Vote", "A votes YES; B votes NO", "A is prepared and keeps its lock. B cannot commit, votes NO, and does not enter the prepared state. A single NO prevents a commit decision.", { a: "Prepared · YES", b: "Rejected · NO", preparedA: true }, [message(1, 0, "YES", 180, "vote"), message(2, 0, "NO", 211, "abort")]);
      add("Decide", "Coordinator records ABORT", "All participants must agree on the same outcome. A durable abort decision is sent even to the participant that already voted NO.", { decision: "ABORT", coordinator: "ABORT durable" });
      add("Notify", "Broadcast ABORT and release resources", "Both participants discard tentative writes. Prepared A learns the decision and releases its locks. Account balances remain $1,000 and $600.", { a: "Aborted", b: "Aborted", released: true }, [message(0, 1, "ABORT", 270, "abort"), message(0, 2, "ABORT", 301, "abort")]);
    } else {
      add("Vote", "Both participants vote YES", "A and B durably record PREPARED. Neither may independently change its vote to ABORT just because the coordinator becomes unreachable.", { a: "Prepared · YES", b: "Prepared · YES", preparedA: true, preparedB: true }, [message(1, 0, "YES", 180, "vote"), message(2, 0, "YES", 211, "vote")]);
      add("Decide", "Coordinator makes COMMIT durable", "The coordinator records the commit decision before sending it. Both participants are still prepared and have not received the decision.", { decision: "COMMIT", coordinator: "COMMIT durable" });
      if (scenario === "crash") {
        add("Failure", "The coordinator crashes before sending COMMIT", "The commit record survives on the coordinator’s local disk, but that disk is unavailable with the failed coordinator. Neither participant knows the outcome.", { offline: true, coordinator: "Offline", blocked: true });
        add("Blocked", "Prepared participants can block", "Both participants have voted YES and neither has a decision to share. They must retain their prepared state. Recovery is required in this example; a timeout alone cannot authorize abort.", { a: "Prepared · blocked", b: "Prepared · blocked" });
        if (!recovered) return steps;
        add("Recover", "Recover the coordinator and read its log", "The original durable COMMIT decision is recovered. Recovery does not choose a new outcome; it finishes the recorded one.", { offline: false, blocked: false, coordinator: "Recovered · COMMIT" });
      }
      add("Notify", "Send the commit decision to both participants", "Each participant durably records COMMIT, applies its local update, and releases resources. These apply events are grouped into one teaching step.", { a: "Committed", b: "Committed", released: true }, [message(0, 1, "COMMIT", 270, "commit"), message(0, 2, "COMMIT", 301, "commit")]);
      add("Complete", "Both accounts reflect the same transaction", "A = $800 and B = $800. 2PC provides a common outcome across participants; replicating its records separately is what improves fault tolerance in Spanner.", { coordinator: "Complete" });
    }
    return steps;
  }

  function trueTime(epsilon = 4, elapsed = 0) {
    const timestamp = stamp(epsilon);
    const earliest = 100 + elapsed - epsilon;
    const latest = 100 + elapsed + epsilon;
    return { epsilon, elapsed, timestamp, earliest, latest, ready: after(earliest, timestamp), remaining: Math.max(0, timestamp - earliest + 1) };
  }

  function versions(epsilon = 4) {
    const first = stamp(epsilon);
    return [
      { timestamp: 80, a: 1000, b: 600, label: "Initial balances" },
      { timestamp: first, a: 800, b: 800, label: "T1: $200 A → B" },
      { timestamp: first + 25, a: 850, b: 750, label: "T2: $50 B → A" },
    ];
  }

  function snapshot({ epsilon = 4, at = 110, blocker = "ready", resolved = false } = {}) {
    const first = stamp(epsilon);
    const history = versions(epsilon);
    const selected = history.filter((version) => version.timestamp <= at).at(-1);
    const safeA = first + 40;
    const paxosB = !resolved && blocker === "lag" ? first - 1 : first + 40;
    const preparedLimit = !resolved && blocker === "prepared" ? first + 19 : Infinity;
    const safeB = Math.min(paxosB, preparedLimit);
    return { at, history, selected, safeA, safeB, paxosB, preparedLimit, ready: at <= safeA && at <= safeB, aReady: at <= safeA, bReady: at <= safeB, blocker, resolved };
  }

  const model = Object.freeze({ INITIAL, TRANSFER, stamp, after, transactionSteps, lockingSteps, twoPCSteps, trueTime, versions, snapshot });
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  else globalThis.SpannerModel = model;
})();
