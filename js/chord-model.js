(() => {
  "use strict";

  const BITS = 6;
  const SIZE = 2 ** BITS;
  const NODES = Object.freeze([2, 7, 13, 19, 26, 32, 38, 44, 50, 56, 60]);
  const SCENARIOS = Object.freeze([
    Object.freeze({ id: "forward", label: "Example 1: Take a shortcut", source: 7, key: 54 }),
    Object.freeze({ id: "wrap", label: "Example 2: Cross zero", source: 44, key: 5 }),
  ]);

  const distance = (from, to) => (to - from + SIZE) % SIZE;
  const successor = (id) => NODES.find((node) => node >= id) ?? NODES[0];
  const nextNode = (node) => successor((node + 1) % SIZE);
  const previousNode = (node) => NODES[(NODES.indexOf(node) + NODES.length - 1) % NODES.length];
  const fingers = (node) => Array.from({ length: BITS }, (_, index) => {
    const offset = 2 ** index;
    const start = (node + offset) % SIZE;
    return { index, offset, start, node: successor(start) };
  });

  function closestFinger(node, key) {
    return fingers(node).reverse().find((finger) => {
      const gap = distance(node, finger.node);
      return gap > 0 && gap < distance(node, key);
    });
  }

  function successorPath(source, key) {
    const path = [source];
    const owner = successor(key);
    while (path.at(-1) !== owner) path.push(nextNode(path.at(-1)));
    return path;
  }

  function createSteps({ source, key }) {
    let node = source;
    let path = [source];
    const steps = [];
    const add = (phase, title, detail, extra = {}) => steps.push({
      phase, title, detail, node, path: [...path], selected: null, ...extra,
    });

    add("ready", `Node ${source} looks up key ${key}`,
      `The ring has ${SIZE} identifiers (0–${SIZE - 1}) and ${NODES.length} active nodes. ` +
      `Find the first active node clockwise from key ${key}. Start with node ${source}’s local finger table.`);

    const previous = previousNode(source);
    const alreadyLocal = distance(previous, key) > 0 && distance(previous, key) <= distance(previous, source);
    while (!alreadyLocal && node !== key) {
      const next = nextNode(node);
      const terminal = distance(node, key) <= distance(node, next);
      add("check", `Check node ${node}’s successor`,
        `Is ${key} in the clockwise interval (${node}, ${next}]? ` +
        (terminal
          ? `Yes. Node ${next} is responsible for this key; no longer finger is needed.`
          : `No. Node ${next} comes before the key, so use a finger to make more progress.`),
        { terminal, selected: terminal ? 0 : null });

      const finger = terminal ? fingers(node)[0] : closestFinger(node, key);
      if (!finger) throw new Error(`No preceding finger from ${node} to ${key}`);
      const target = finger.node;
      if (!terminal) {
        add("select", `Choose finger ${finger.index}: node ${target}`,
          `Scan fingers from i = ${BITS - 1} down to 0. Node ${target} is the first finger strictly inside ` +
          `(${node}, ${key}) clockwise: it advances ${distance(node, target)} positions toward a key ` +
          `${distance(node, key)} positions away.`, { selected: finger.index, terminal: false });
      }

      const from = node;
      node = target;
      path = [...path, node];
      add("hop", `${terminal ? "Contact the owner" : "Forward the lookup"}: ${from} → ${node}`,
        (node < from ? `This hop crosses 63 → 0. Clockwise distance is (${node} − ${from} + ${SIZE}) mod ${SIZE} = ${distance(from, node)}. ` : "") +
        (terminal ? `Node ${node} receives the request for key ${key}.`
          : `The lookup has reached node ${node}. The table now shows this node’s fingers, not the origin’s.`),
        { from, to: node, terminal });
      if (terminal) break;
      if (path.length > NODES.length) throw new Error("Lookup failed to make progress");
    }

    const baseline = successorPath(source, key);
    add("found", `Key ${key} belongs to node ${node}`,
      (alreadyLocal ? `Key ${key} is already local: it lies in (${previous}, ${source}]. `
        : `Node ${node} is the first active node at or clockwise after ${key}. `) +
      `This lookup used ${path.length - 1} node-to-node hops; following only successors would take ${baseline.length - 1}. ` +
      `The final contact with the owner is included; a reply back to the origin is not shown.`);
    return steps;
  }

  const model = Object.freeze({ BITS, SIZE, NODES, SCENARIOS, distance, successor, nextNode, fingers, closestFinger, successorPath, createSteps });
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  else globalThis.ChordModel = model;
})();
