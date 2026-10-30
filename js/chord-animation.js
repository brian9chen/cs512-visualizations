(() => {
  "use strict";

  const M = globalThis.ChordModel;
  const point = (id, radius = 194) => {
    const angle = (id / M.SIZE) * Math.PI * 2 - Math.PI / 2;
    return { x: 310 + radius * Math.cos(angle), y: 300 + radius * Math.sin(angle) };
  };
  const arc = (from, to, radius) => {
    const a = point(from, radius);
    const b = point(to, radius);
    return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${M.distance(from, to) > M.SIZE / 2 ? 1 : 0} 1 ${b.x} ${b.y}`;
  };

  class ChordLookupAnimation extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.scenarioIndex = 0;
      this.index = 0;
    }

    connectedCallback() {
      this.renderShell();
      const root = this.shadowRoot;
      root.querySelectorAll("[data-scenario]").forEach((button) => {
        button.addEventListener("click", () => this.loadScenario(Number(button.dataset.scenario)));
      });
      root.querySelector("[data-action=back]").addEventListener("click", () => this.move(-1));
      root.querySelector("[data-action=next]").addEventListener("click", () => this.move(1));
      root.querySelector("[data-action=reset]").addEventListener("click", () => this.showStep(0));
      root.querySelector("#links").addEventListener("change", () => this.renderRing());
      this.loadScenario(0);
    }

    loadScenario(index) {
      this.scenarioIndex = index;
      this.scenario = M.SCENARIOS[index];
      this.steps = M.createSteps(this.scenario);
      this.shadowRoot.querySelectorAll("[data-scenario]").forEach((button) => {
        button.setAttribute("aria-pressed", String(Number(button.dataset.scenario) === index));
      });
      this.showStep(0);
    }

    move(delta) {
      this.showStep(this.index + delta);
    }

    showStep(index) {
      this.index = Math.max(0, Math.min(index, this.steps.length - 1));
      const step = this.steps[this.index];
      const root = this.shadowRoot;
      root.querySelector("#step-title").textContent = step.title;
      root.querySelector("#step-detail").textContent = step.detail;
      root.querySelector("#step-counter").textContent = `Step ${this.index + 1} / ${this.steps.length}`;
      root.querySelector("#progress").value = this.index;
      root.querySelector("#progress").max = this.steps.length - 1;
      root.querySelector("[data-action=back]").disabled = this.index === 0;
      root.querySelector("[data-action=next]").disabled = this.index === this.steps.length - 1;
      root.querySelector("#route").innerHTML = step.path.map((node, index) =>
        `${index ? '<span class="route-arrow" aria-hidden="true">→</span>' : ""}<span class="route-node ${index === step.path.length - 1 ? "current" : ""}">${node}</span>`
      ).join("");
      root.querySelector("#hop-count").textContent = `${step.path.length - 1} ${step.path.length === 2 ? "hop" : "hops"}`;
      root.querySelector("#route-label").textContent = step.phase === "found" ? "Lookup complete" : "Lookup path so far";
      const baseline = M.successorPath(this.scenario.source, this.scenario.key);
      root.querySelector("#baseline").textContent = baseline.join(" → ");
      root.querySelector("#baseline-count").textContent = `${baseline.length - 1} hops`;
      this.renderTable();
      this.renderRing();
    }

    renderTable() {
      const root = this.shadowRoot;
      const step = this.steps[this.index];
      const { key } = this.scenario;
      const next = M.nextNode(step.node);
      const deciding = step.phase === "select";
      root.querySelector("#table-title").textContent = `Node ${step.node}’s finger table`;
      root.querySelector("#table-subtitle").textContent = `m = ${M.BITS} · successor(${step.node}) = ${next}`;
      root.querySelector("#formula").textContent = `start = (${step.node} + 2ⁱ) mod ${M.SIZE}`;
      root.querySelector("#finger-rows").innerHTML = M.fingers(step.node).map((finger) => {
        const selected = step.selected === finger.index;
        const eligible = M.distance(step.node, finger.node) > 0 && M.distance(step.node, finger.node) < M.distance(step.node, key);
        const status = selected ? (step.terminal ? "Owner ✓" : "Use this ✓")
          : deciding ? (eligible ? "Earlier finger" : "Outside interval") : "—";
        return `<tr class="${selected ? "selected" : ""}">
          <td>${finger.index}</td><td>+${finger.offset}</td>
          <td title="(${step.node} + ${finger.offset}) mod ${M.SIZE}">${finger.start}</td>
          <td><strong>${finger.node}</strong></td><td class="decision ${deciding && !eligible ? "excluded" : ""}">${status}</td>
        </tr>`;
      }).join("");
      let note = "Each start is an identifier, not necessarily an active node. The finger points to that start’s successor.";
      if (deciding) note = `Read bottom to top. Choose the first finger inside (${step.node}, ${key}) clockwise. Compare finger nodes, not start values.`;
      if (step.phase === "check") note = step.terminal
        ? `${key} ∈ (${step.node}, ${next}]. The first finger is the immediate successor and owns the key.`
        : `${key} ∉ (${step.node}, ${next}]. The next step scans the finger table for a shortcut.`;
      if (step.phase === "found") note = `Found: successor(${key}) = ${step.node}. The owner’s table is shown here; no further routing is needed.`;
      root.querySelector("#table-note").textContent = note;
    }

    renderRing() {
      const step = this.steps[this.index];
      const { key, source } = this.scenario;
      const table = M.fingers(step.node);
      const selected = step.selected === null ? null : table[step.selected];
      const showLinks = this.shadowRoot.querySelector("#links").checked;
      const keyPoint = point(key, 242);
      const keyLabel = point(key, 272);
      const ticks = Array.from({ length: M.SIZE }, (_, id) => {
        const a = point(id, 216);
        const b = point(id, id % 8 === 0 ? 225 : 220);
        const label = point(id, 238);
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#c4cedb"/>
          ${id % 8 === 0 ? `<text x="${label.x}" y="${label.y + 4}" class="tick-label">${id}</text>` : ""}`;
      }).join("");
      const links = showLinks ? [...new Set(table.map((finger) => finger.node))].filter((node) => node !== step.node).map((node) => {
        const a = point(step.node);
        const b = point(node);
        return `<path d="M ${a.x} ${a.y} Q 310 300 ${b.x} ${b.y}" class="finger-link" marker-end="url(#finger-arrow)"/>`;
      }).join("") : "";
      const traveled = step.path.slice(1).map((node, index) =>
        `<path d="${arc(step.path[index], node, 177)}" class="traveled" marker-end="url(#route-arrow)"/>`
      ).join("");
      const nodes = M.NODES.map((node) => {
        const p = point(node);
        const active = node === step.node;
        const visited = step.path.includes(node);
        const owner = step.phase === "found" && active;
        const target = selected && selected.node === node;
        return `<g class="node ${active ? "active" : visited ? "visited" : ""} ${owner ? "owner" : ""} ${target ? "target" : ""}">
          <title>Node ${node}${active ? ", current node" : ""}${owner ? ", key owner" : ""}${node === source ? ", origin" : ""}</title>
          ${node === source ? `<circle cx="${p.x}" cy="${p.y}" r="26" class="origin-ring"/>` : ""}
          <circle cx="${p.x}" cy="${p.y}" r="20"/>
          <text x="${p.x}" y="${p.y + 6}">${node}</text>
        </g>`;
      }).join("");
      const description = `Key ${key}, current node ${step.node}. Lookup path: ${step.path.join(" to ")}. ${step.title}.`;
      this.shadowRoot.querySelector("#ring").innerHTML = `
        <title id="ring-title">Chord identifier ring, 0 through 63</title>
        <desc id="ring-desc">${description}</desc>
        <defs>
          <marker id="route-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#1678b8"/></marker>
          <marker id="finger-arrow" viewBox="0 0 10 10" refX="12" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#a7b4c8"/></marker>
          <marker id="chosen-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#198754"/></marker>
        </defs>
        <circle cx="310" cy="300" r="194" fill="none" stroke="#d8dee9" stroke-width="2"/>
        ${ticks}${links}${traveled}
        ${selected ? `<path d="${arc(step.node, selected.node, 163)}" class="chosen" marker-end="url(#chosen-arrow)"/>` : ""}
        <circle cx="310" cy="300" r="90" fill="white"/>
        <text x="310" y="266" class="center-label">LOOKING UP KEY</text>
        <text x="310" y="313" class="center-key">${key}</text>
        <text x="310" y="345" class="center-node">${step.phase === "found" ? "Owner" : "Current node"}: ${step.node}</text>
        <text x="310" y="368" class="center-label">${step.phase === "found" ? "Lookup complete" : "Clockwise routing ↻"}</text>
        <line x1="${point(key, 218).x}" y1="${point(key, 218).y}" x2="${keyPoint.x}" y2="${keyPoint.y}" stroke="#b76b09" stroke-width="2"/>
        <path d="M ${keyPoint.x} ${keyPoint.y - 7} l 7 7 l -7 7 l -7 -7 z" fill="#b76b09"/>
        <text x="${keyLabel.x}" y="${keyLabel.y + 5}" class="key-label">key ${key}</text>
        ${nodes}
        <text x="310" y="566" class="tick-label">6-bit identifier space · 11 active nodes</text>`;
    }

    renderShell() {
      this.shadowRoot.innerHTML = `
        <style>
          :host { --ink:#172033; --muted:#5c667a; --blue:#1678b8; display:block; color:var(--ink); font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
          * { box-sizing:border-box; }
          .demo { border:1px solid #d8dee9; border-radius:.75rem; background:white; box-shadow:0 .4rem 1.4rem rgb(23 32 51 / 8%); overflow:hidden; }
          .toolbar { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; background:#f7f9fc; border-bottom:1px solid #e8ebf0; }
          .scenarios { display:flex; gap:.6rem; flex-wrap:wrap; padding:.6rem .8rem; }
          button { font:inherit; color:var(--ink); border:1px solid #aab3c2; border-radius:.4rem; background:#fff; padding:.4rem .7rem; }
          button { cursor:pointer; font-weight:650; }
          button:hover { filter:brightness(.96); }
          button:disabled { opacity:.45; cursor:not-allowed; }
          button:focus-visible,input:focus-visible { outline:3px solid #2da0e2; outline-offset:3px; }
          .scenarios button { flex:1; text-align:left; line-height:1.5; }
          .scenarios button[aria-pressed=true] { color:#125c8e; border-color:var(--blue); background:#eef8fd; box-shadow:inset 0 0 0 1px var(--blue); }
          .scenario-detail { display:block; font-size:.82rem; font-weight:400; }
          .controls { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; padding:.5rem .8rem; }
          .primary { background:var(--blue); border-color:var(--blue); color:white; }
          .counter { margin-left:auto; color:var(--muted); font-size:.85rem; font-variant-numeric:tabular-nums; white-space:nowrap; }
          progress { display:block; width:100%; height:4px; appearance:none; border:0; background:#e8ebf0; accent-color:var(--blue); }
          progress::-webkit-progress-bar { background:#e8ebf0; }
          progress::-webkit-progress-value { background:var(--blue); transition:width .2s; }
          .explanation { min-height:88px; padding:.6rem 1rem; }
          .explanation h2 { margin:0 0 .3rem; font-size:1.15rem; }
          .explanation p { margin:0; color:var(--muted); font-size:.9rem; line-height:1.45; }
          .workspace { display:grid; grid-template-columns:140px minmax(0,1fr) 340px; gap:1rem; padding:0 1rem .8rem; align-items:start; }
          .ring-panel { min-width:0; }
          svg { display:block; width:100%; height:clamp(300px,calc(100dvh - 380px),460px); }
          .tick-label { text-anchor:middle; fill:#64748b; font-size:15px; }
          .finger-link { fill:none; stroke:#a7b4c8; stroke-width:1.6; stroke-dasharray:5 5; opacity:.65; }
          .traveled { fill:none; stroke:var(--blue); stroke-width:4; }
          .chosen { fill:none; stroke:#198754; stroke-width:4; stroke-dasharray:8 5; }
          .node circle { fill:#f8fafc; stroke:#8fa0b8; stroke-width:2; }
          .node text { text-anchor:middle; font-size:20px; fill:var(--ink); font-weight:700; }
          .node.visited circle { fill:#e4f2fb; stroke:var(--blue); }
          .node.active circle { fill:var(--blue); stroke:var(--blue); stroke-width:3; }
          .node.active text,.node.owner text { fill:#fff; }
          .node.target circle { fill:#ecfdf3; stroke:#198754; stroke-width:3; }
          .node.owner circle { fill:#198754; stroke:#198754; }
          .node circle.origin-ring { fill:none; stroke:#64748b; stroke-width:1.5; stroke-dasharray:3 3; }
          .center-label,.center-node,.center-key,.key-label { text-anchor:middle; }
          .center-label { fill:var(--muted); font-size:14px; letter-spacing:.6px; }
          .center-key { fill:var(--ink); font-weight:750; font-size:46px; }
          .center-node { fill:var(--ink); font-weight:650; font-size:16px; }
          .key-label { fill:#935207; font-size:16px; font-weight:700; paint-order:stroke; stroke:#fff; stroke-width:5; }
          .legend { display:flex; flex-wrap:wrap; justify-content:center; gap:.35rem .8rem; color:var(--muted); font-size:.75rem; padding:0 .25rem; }
          .legend span { display:inline-flex; align-items:center; gap:.3rem; }
          .swatch { width:.65rem; height:.65rem; border-radius:50%; background:var(--blue); display:inline-block; }
          .swatch.chosen-swatch { background:#198754; }
          .swatch.key-swatch { background:#b76b09; border-radius:0; transform:rotate(45deg); }
          .links-toggle { display:flex; justify-content:center; align-items:center; gap:.4rem; margin-top:.4rem; font-size:.78rem; color:var(--muted); cursor:pointer; }
          input { accent-color:var(--blue); }
          .table-panel { border:1px solid #d8dee9; border-radius:.5rem; overflow:hidden; }
          .table-heading { padding:.45rem .8rem; background:#f7f9fc; }
          h3 { margin:0 0 .3rem; font-size:1.05rem; }
          .table-subtitle { color:var(--muted); font-size:.8rem; margin:0; }
          .formula { padding:.5rem .8rem; font-size:.82rem; color:var(--muted); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
          table { width:100%; border-collapse:collapse; font-size:.85rem; font-variant-numeric:tabular-nums; }
          th,td { padding:.3rem .4rem; text-align:center; border-bottom:1px solid #e8ebf0; }
          th { font-size:.72rem; font-weight:650; color:var(--muted); background:#fafbfc; }
          th:first-child,td:first-child { padding-left:.8rem; }
          th:last-child,td:last-child { text-align:left; width:37%; }
          tr.selected { background:#ecfdf3; color:#14532d; box-shadow:inset 4px 0 0 #198754; }
          .decision { font-size:.72rem; }
          .excluded { color:#64748b; }
          .table-note { margin:0; padding:.5rem .8rem; min-height:70px; font-size:.8rem; color:var(--muted); line-height:1.45; }
          .route-panel { min-width:0; background:#eef8fd; border-left:4px solid #2da0e2; padding:.7rem; }
          .route-header { display:flex; flex-direction:column; gap:.25rem; font-size:.8rem; font-weight:700; }
          #hop-count { color:var(--muted); font-weight:400; }
          .route { display:flex; flex-direction:column; align-items:center; gap:.15rem; margin-top:.6rem; }
          .route-node { border:1px solid #b7d9ee; background:white; border-radius:.35rem; min-width:2rem; padding:.25rem .45rem; text-align:center; font-weight:700; font-size:.85rem; }
          .route-node.current { background:var(--blue); color:white; border-color:var(--blue); }
          .route-arrow { color:#64748b; transform:rotate(90deg); line-height:1; }
          .baseline { margin:.65rem 0 0; padding-top:.6rem; border-top:1px solid #c9e1ef; color:var(--muted); font-size:.73rem; line-height:1.45; }
          @media(max-width:1050px) { .toolbar { grid-template-columns:1fr; } .controls { border-top:1px solid #e8ebf0; } .workspace { grid-template-columns:125px minmax(0,1fr) 310px; gap:.6rem; padding:0 .7rem .7rem; } }
          @media(max-width:850px) { .workspace { grid-template-columns:minmax(0,1fr) minmax(290px,1fr); } .route-panel { grid-column:1 / -1; display:flex; flex-wrap:wrap; align-items:center; gap:.4rem 1rem; } .route-header { min-width:125px; } .route { flex-direction:row; flex-wrap:wrap; margin:0; gap:.4rem; } .route-arrow { transform:none; } .baseline { flex-basis:100%; margin:0; padding-top:.4rem; } svg { height:320px; } }
          @media(max-width:600px) { .workspace { grid-template-columns:1fr; } .ring-panel { width:100%; max-width:420px; margin:auto; } .table-note { min-height:0; } .scenarios button { font-size:.85rem; } .scenario-detail { font-size:.75rem; } .explanation { min-height:110px; } .explanation p { font-size:.85rem; } }
          @media(prefers-reduced-motion:reduce) { * { transition:none !important; } }
        </style>
        <div class="demo">
          <div class="toolbar">
          <div class="scenarios" role="group" aria-label="Lookup example">
            ${M.SCENARIOS.map((scenario, index) => `<button type="button" data-scenario="${index}" aria-pressed="false">${scenario.label}<span class="scenario-detail">Start at node ${scenario.source} · find key ${scenario.key}</span></button>`).join("")}
          </div>
          <div class="controls" role="group" aria-label="Step controls">
            <button type="button" data-action="back">← Back</button>
            <button type="button" class="primary" data-action="next">Next →</button>
            <button type="button" data-action="reset">Reset</button>
            <span class="counter" id="step-counter"></span>
          </div>
          </div>
          <progress id="progress" aria-label="Lookup progress" value="0" max="1"></progress>
          <div class="explanation" aria-live="polite" aria-atomic="true"><h2 id="step-title"></h2><p id="step-detail"></p></div>
          <div class="workspace">
            <aside class="route-panel" aria-labelledby="route-label">
              <div class="route-header"><span id="route-label"></span><span id="hop-count"></span></div>
              <div class="route" id="route" aria-label="Lookup path"></div>
              <p class="baseline">Using only successors: <span id="baseline"></span> (<span id="baseline-count"></span>).</p>
            </aside>
            <div class="ring-panel">
              <svg id="ring" viewBox="20 20 580 560" role="img" aria-labelledby="ring-title ring-desc"></svg>
              <div class="legend"><span><i class="swatch"></i>Current / traveled</span><span><i class="swatch chosen-swatch"></i>Chosen next / owner</span><span><i class="swatch key-swatch"></i>Lookup key</span><span>Dashed halo = origin</span></div>
              <label class="links-toggle"><input id="links" type="checkbox" checked>Show current node’s finger links</label>
            </div>
            <section class="table-panel" aria-labelledby="table-title">
              <div class="table-heading"><h3 id="table-title"></h3><p id="table-subtitle" class="table-subtitle"></p></div>
              <div class="formula" id="formula"></div>
              <table aria-label="Current node's finger table"><thead><tr><th scope="col">i</th><th scope="col">2ⁱ</th><th scope="col">Start</th><th scope="col">Node</th><th scope="col">Decision</th></tr></thead><tbody id="finger-rows"></tbody></table>
              <p id="table-note" class="table-note"></p>
            </section>
          </div>
        </div>`;
    }
  }

  if (!customElements.get("chord-lookup-animation")) customElements.define("chord-lookup-animation", ChordLookupAnimation);
})();
