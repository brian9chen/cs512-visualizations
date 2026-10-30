(() => {
  "use strict";

  const M = globalThis.SpannerModel;
  const VIEWS = [
    { id: "full", name: "Full transaction", sub: "Put it together" },
    { id: "locks", name: "2PL · Locking", sub: "Protect isolation" },
    { id: "twopc", name: "2PC · Commit", sub: "Agree on an outcome" },
    { id: "time", name: "TrueTime", sub: "Wait out uncertainty" },
    { id: "reads", name: "Snapshot reads", sub: "Read one version of time" },
  ];
  const money = (n) => `$${n.toLocaleString("en-US")}`;
  const badge = (text, tone = "blue") => `<span class="badge ${tone}">${text}</span>`;
  const fact = (label, value) => `<div class="fact"><dt>${label}</dt><dd>${value}</dd></div>`;
  const balances = (a, b) => `<div class="account-pair"><div class="account a"><span>Account A</span><strong>${money(a)}</strong></div><div class="account b"><span>Account B</span><strong>${money(b)}</strong></div></div>`;
  const colors = { blue: "#1678b8", teal: "#0f8587", amber: "#b76b09", red: "#b84049", purple: "#7754ae", muted: "#8d9caf", green: "#198754" };
  const svgStart = (label, height = 410) => `<svg viewBox="0 0 900 ${height}" role="img" aria-label="${label}">
    <defs>${Object.entries(colors).map(([name, color]) => `<marker id="arrow-${name}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`).join("")}</defs>`;

  function architecture(s) {
    const xs = [20, 320, 620];
    const ax = xs[s.leader] + 130;
    const server = (group, zone) => {
      const x = xs[zone] + 14;
      const y = group === "A" ? 140 : 277;
      const leader = group === "A" ? zone === s.leader : zone === 1;
      const down = group === "A" && s.crashed && zone === 0;
      const unused = group === "B" && s.single;
      const color = group === "A" ? colors.blue : colors.teal;
      const log = group === "A" ? s.aLog : unused ? "Not in this transaction" : s.bLog;
      const lock = !leader || unused || s.locks === "None" ? "" : s.locks.startsWith("S") ? " · S lock" : " · X lock";
      const value = unused ? "B is placed in Group A" : group === "A"
        ? `A ${money(s.a)}${s.single ? ` · B ${money(s.b)}` : ""}` : `B ${money(s.b)}`;
      return `<g opacity="${unused ? ".4" : "1"}">
        <rect x="${x}" y="${y}" width="252" height="100" rx="9" fill="${down ? "#fff1f2" : leader ? (group === "A" ? "#edf7fd" : "#edf9f7") : "white"}" stroke="${down ? colors.red : leader ? color : "#d8e1eb"}" stroke-width="${leader ? 2 : 1}"/>
        <circle cx="${x + 17}" cy="${y + 21}" r="4" fill="${down ? colors.red : color}"/>
        <text x="${x + 29}" y="${y + 26}" class="svg-node-title">Group ${group}</text>
        <text x="${x + 236}" y="${y + 26}" text-anchor="end" fill="${down ? colors.red : color}" class="svg-role">${down ? "OFFLINE" : leader ? "LEADER" : "REPLICA"}</text>
        <text x="${x + 15}" y="${y + 53}" class="svg-value">${value}${lock}</text>
        <rect x="${x + 12}" y="${y + 65}" width="228" height="24" rx="4" fill="${down ? "#fce0e4" : "#f2f5f9"}"/>
        <text x="${x + 23}" y="${y + 82}" class="svg-log">${down ? "Durable log · unavailable" : log}</text>
      </g>`;
    };
    let traffic = "";
    if (["read", "write"].includes(s.traffic)) {
      traffic = `<path d="M 410 66 Q 410 105 ${ax} 136" class="message blue" marker-end="url(#arrow-blue)"/>
        ${s.single ? "" : '<path d="M 490 66 Q 605 90 605 253 Q 605 266 450 273" class="message teal" marker-end="url(#arrow-teal)"/>'}`;
    }
    if (!s.single && ["vote", "decision"].includes(s.traffic)) {
      const voting = s.traffic === "vote";
      traffic += `<path d="M ${voting ? "334 308" : `${xs[s.leader] + 266} 198`} Q 300 255 ${voting ? `${xs[s.leader] + 266} 198` : "334 308"}" class="message amber" marker-end="url(#arrow-amber)"/>
        <rect x="269" y="244" width="90" height="24" rx="5" fill="#fff4de" stroke="#e4c28e"/>
        <text x="314" y="260" text-anchor="middle" fill="#8b5108" class="svg-log">${voting ? "YES · 102" : `COMMIT ${s.timestamp}`}</text>`;
    }
    if (s.traffic === "reply") traffic += `<path d="M ${ax} 136 Q ${ax} 92 450 69" class="message green" marker-end="url(#arrow-green)"/>`;
    const activeA = ["paxos-a", "recovery", "apply"].includes(s.traffic);
    const activeB = ["paxos-b", "apply"].includes(s.traffic) && !s.single;
    return `${svgStart("Three zones, each containing one replica from Group A and Group B")}
      ${xs.map((x, i) => `<rect x="${x}" y="92" width="280" height="299" rx="12" fill="#f6f8fb" stroke="#e1e7ef"/><text x="${x + 16}" y="117" class="svg-zone">ZONE ${i + 1}</text><text x="${x + 263}" y="117" text-anchor="end" class="svg-zone-name">${["East", "Central", "West"][i]}</text>`).join("")}
      <path d="M 60 190 H 853" fill="none" stroke="${colors.blue}" stroke-dasharray="6 5" stroke-width="${activeA ? 4 : 2}" opacity="${activeA ? 1 : .3}"/>
      <path d="M 60 327 H 853" fill="none" stroke="${colors.teal}" stroke-dasharray="6 5" stroke-width="${activeB ? 4 : 2}" opacity="${activeB ? 1 : .3}"/>
      <rect x="280" y="6" width="340" height="61" rx="10" fill="#172e43"/>
      <text x="450" y="30" text-anchor="middle" fill="white" class="svg-client">CLIENT · TRANSFER $200</text>
      <text x="450" y="51" text-anchor="middle" fill="#cce2ef" class="svg-client-sub">${s.replied ? "Commit successful ✓" : s.buffer ? "Buffered: A = $800 · B = $800" : "A → B · transaction T1"}</text>
      ${traffic}${[0, 1, 2].map((zone) => server("A", zone) + server("B", zone)).join("")}
      ${s.crashed ? `<rect x="${xs[0] + 89}" y="247" width="102" height="20" rx="4" fill="#fff1f2"/><text x="${xs[0] + 140}" y="262" text-anchor="middle" fill="${colors.red}" class="svg-log">Leader failed</text>` : ""}
    </svg>
    <div class="diagram-legend"><span><i class="line blue"></i>Paxos · Group A</span><span><i class="line teal"></i>Paxos · Group B</span><span><i class="line amber"></i>2PC · between leaders</span></div>`;
  }

  function lockDiagram(s) {
    const tx = (id, x, status, tone) => `<g><rect x="${x}" y="34" width="280" height="110" rx="12" fill="${id === "T2" && s.wounded ? "#fff1f2" : "white"}" stroke="${colors[tone]}" stroke-width="2"/><text x="${x + 20}" y="66" class="svg-node-title">${id} · ${id === "T1" ? "$200 transfer" : "competing update"}</text><text x="${x + 20}" y="94" class="svg-value">${id === "T1" ? "Older · age 10" : "Younger · age 20"}</text><text x="${x + 20}" y="123" fill="${colors[tone]}" class="svg-status">${status}</text></g>`;
    const lock = (key, x, owner) => `<g><rect x="${x}" y="280" width="240" height="90" rx="10" fill="${owner ? "#edf6fc" : "#f4f8f5"}" stroke="${owner ? colors.blue : "#b7d6c2"}"/><text x="${x + 20}" y="311" class="svg-node-title">Account ${key}</text><text x="${x + 20}" y="343" class="svg-value">${owner ? `X lock held by ${owner}` : "Unlocked"}</text></g>`;
    const connection = (txid, key, wait) => {
      const x1 = txid === "T1" ? 220 : 680;
      const x2 = key === "A" ? 275 : 625;
      const tone = wait ? "amber" : txid === "T1" ? "blue" : "teal";
      return `<path d="M ${x1} 146 Q ${x1} 215 ${x2} 275" class="message ${tone}" ${wait ? 'stroke-dasharray="7 5"' : ""} marker-end="url(#arrow-${tone})"/><text x="${(x1 + x2) / 2 + 15}" y="223" fill="${colors[tone]}" class="svg-log">${wait ? "waits" : "holds"}</text>`;
    };
    return `${svgStart("Transactions T1 and T2 acquiring and waiting for exclusive account locks", 410)}
      ${s.ownerA ? connection(s.ownerA, "A", false) : ""}${s.ownerB ? connection(s.ownerB, "B", false) : ""}
      ${s.wait1 ? connection("T1", s.wait1, true) : ""}${s.wait2 ? connection("T2", s.wait2, true) : ""}
      ${tx("T1", 80, s.t1, "blue")}${tx("T2", 540, s.t2, "teal")}
      ${lock("A", 155, s.ownerA)}${lock("B", 505, s.ownerB)}
      ${s.deadlock || s.wounded ? `<rect x="350" y="171" width="200" height="48" rx="8" fill="${s.deadlock ? "#fff1f2" : "#fff4de"}" stroke="${s.deadlock ? colors.red : colors.amber}"/><text x="450" y="201" text-anchor="middle" fill="${s.deadlock ? colors.red : colors.amber}" class="svg-node-title">${s.deadlock ? "WAIT CYCLE" : "T2 ABORTED"}</text>` : ""}
      <text x="450" y="402" text-anchor="middle" class="svg-note">Hold locks → finish transaction → release locks</text>
    </svg>`;
  }

  function twoPCDiagram(s) {
    const xs = [140, 450, 760];
    return `${svgStart("Two-phase commit messages between a coordinator and participants A and B", 390)}
      ${xs.map((x, i) => `<path d="M ${x} 80 V 350" stroke="#d3dce7" stroke-width="2" stroke-dasharray="5 5"/><rect x="${x - 119}" y="12" width="238" height="68" rx="10" fill="${i === 0 ? s.offline ? "#fff1f2" : "#edf6fc" : "#f5f8fb"}" stroke="${i === 0 && s.offline ? colors.red : "#cbd7e5"}"/><text x="${x}" y="38" text-anchor="middle" class="svg-node-title">${["Coordinator", "Participant A", "Participant B"][i]}</text><text x="${x}" y="62" text-anchor="middle" class="svg-log">${[s.coordinator, s.a, s.b][i]}</text>`).join("")}
      ${s.messages.map((m) => {
        const tone = m.kind === "abort" ? "red" : ["vote", "commit"].includes(m.kind) ? "teal" : "blue";
        const start = xs[m.from];
        const end = xs[m.to];
        const mid = (start + end) / 2;
        return `<path d="M ${start} ${m.y} H ${end}" class="message ${tone}" marker-end="url(#arrow-${tone})"/><rect x="${mid - 43}" y="${m.y - 13}" width="86" height="22" rx="4" fill="white"/><text x="${mid}" y="${m.y + 3}" text-anchor="middle" fill="${colors[tone]}" class="svg-log">${m.text}</text>`;
      }).join("")}
      <rect x="130" y="348" width="640" height="30" rx="7" fill="${s.blocked ? "#fff4de" : s.released ? "#edf8f2" : "#f4f6fa"}"/>
      <text x="450" y="368" text-anchor="middle" fill="${s.blocked ? colors.amber : "#526277"}" class="svg-log">${s.blocked ? "PREPARED ≠ COMMITTED · participants retain resources" : s.released ? "Outcome received · tentative work resolved · locks released" : "A YES vote is a durable promise, not a commit"}</text>
    </svg>`;
  }

  function timeDiagram(t) {
    const x = (value) => 65 + ((value - 80) / 80) * 770;
    return `${svgStart("TrueTime interval and commit timestamp on a millisecond timeline", 350)}
      <text x="65" y="35" class="svg-node-title">Is the commit timestamp definitely in the past?</text>
      <text x="65" y="60" class="svg-note">Move elapsed time. The entire interval must pass the timestamp.</text>
      <path d="M 65 188 H 840" stroke="#a7b5c7" stroke-width="2"/>
      ${Array.from({ length: 17 }, (_, i) => 80 + i * 5).map((n) => `<path d="M ${x(n)} 182 V 194" stroke="#a7b5c7"/><text x="${x(n)}" y="214" text-anchor="middle" class="svg-tick">${n}</text>`).join("")}
      <rect x="${x(t.earliest)}" y="120" width="${x(t.latest) - x(t.earliest)}" height="43" rx="7" fill="${t.ready ? "#dff4e9" : "#e3effb"}" stroke="${t.ready ? colors.green : colors.blue}" stroke-width="2"/>
      <circle cx="${x(100 + t.elapsed)}" cy="141" r="5" fill="${t.ready ? colors.green : colors.blue}"/>
      <text x="${x((t.earliest + t.latest) / 2)}" y="104" text-anchor="middle" fill="${colors.blue}" class="svg-status">TT.now() = [${t.earliest}, ${t.latest}]</text>
      <path d="M ${x(t.timestamp)} 78 V 233" stroke="${colors.amber}" stroke-width="2" stroke-dasharray="5 4"/>
      <rect x="${x(t.timestamp) - 48}" y="235" width="96" height="27" rx="5" fill="#fff4de"/>
      <text x="${x(t.timestamp)}" y="254" text-anchor="middle" fill="${colors.amber}" class="svg-status">s = ${t.timestamp}</text>
      <text x="65" y="249" class="svg-tick">Time in illustrative milliseconds →</text>
      <rect x="65" y="286" width="770" height="48" rx="9" fill="${t.ready ? "#edf8f2" : "#fff8e8"}"/>
      <text x="450" y="316" text-anchor="middle" fill="${t.ready ? colors.green : colors.amber}" class="svg-node-title">${t.ready ? `${t.earliest} > ${t.timestamp} · TT.after(s) is true` : `${t.earliest} ≤ ${t.timestamp} · keep waiting`}</text>
    </svg><div class="ordering-strip"><span>T1 commits at s</span><span>→</span><span>Client sees success</span><span>→</span><span>T2 starts later</span><span>⇒</span><strong>s₂ &gt; s₁</strong></div>`;
  }

  function readDiagram(r) {
    const table = (account) => {
      const ready = account === "A" ? r.aReady : r.bReady;
      const key = account.toLowerCase();
      return `<section class="version-card"><div class="version-heading"><h3>Account ${account}</h3>${badge(ready ? "Can serve" : "Waiting", ready ? "green" : "amber")}</div>
        <table><thead><tr><th scope="col">Version time</th><th scope="col">Balance</th><th scope="col">At t = ${r.at}</th></tr></thead><tbody>
          ${[...r.history].reverse().map((version) => {
            const chosen = ready && version.timestamp === r.selected.timestamp;
            return `<tr class="${chosen ? "chosen-version" : version.timestamp > r.at ? "future-version" : ""}"><td>${version.timestamp}</td><td>${money(version[key])}</td><td>${chosen ? "Selected ✓" : version.timestamp > r.at ? "Too new" : ready ? "Older" : "Await safe time"}</td></tr>`;
          }).join("")}</tbody></table>
        <div class="version-result">${ready ? `Read at ${r.at}: <strong>${money(r.selected[key])}</strong>` : `Cannot serve ${r.at} yet: t_safe = ${r.safeB}`}</div>
      </section>`;
    };
    return `<div class="read-zones" aria-label="The same three-zone architecture, reading from zone 3">${[1, 2, 3].map((zone) => `<div class="read-zone ${zone === 3 ? "read-zone-active" : ""}"><span>ZONE ${zone}</span><div><i class="dot blue"></i>Group A <i class="dot teal"></i>Group B</div><small>${zone === 3 ? `Snapshot request · t = ${r.at}` : zone === 1 ? "A leader · B replica" : "A replica · B leader"}</small></div>`).join("")}</div>
      <div class="version-grid">${table("A")}${table("B")}</div>
      <div class="snapshot-result ${r.ready ? "success" : "waiting"}"><span>${r.ready ? "ONE CONSISTENT SNAPSHOT" : "TRANSACTION RESULT NOT READY"}</span><strong>${r.ready ? `${money(r.selected.a)} + ${money(r.selected.b)} = $1,600` : "Wait for both accounts at the same timestamp"}</strong><small>${r.ready ? r.selected.label : "An available value from A is not returned as a completed two-account result."}</small></div>`;
  }

  class SpannerTransactionLab extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.view = "full";
      this.epsilon = 4;
      this.state = {
        full: { index: 0, single: false, recovery: false },
        locks: { index: 0, scenario: "contention" },
        twopc: { index: 0, scenario: "commit", recovered: false },
        time: { elapsed: 0 },
        reads: { at: 110, blocker: "ready", resolved: false },
      };
    }

    connectedCallback() {
      this.renderShell();
      this.shadowRoot.addEventListener("click", (event) => this.onClick(event));
      this.shadowRoot.addEventListener("change", (event) => this.onChange(event));
      this.shadowRoot.addEventListener("input", (event) => this.onInput(event));
      this.shadowRoot.addEventListener("keydown", (event) => {
        if (!event.target.matches("[role=tab]")) return;
        const current = VIEWS.findIndex((view) => view.id === this.view);
        let next;
        if (event.key === "ArrowRight") next = (current + 1) % VIEWS.length;
        if (event.key === "ArrowLeft") next = (current + VIEWS.length - 1) % VIEWS.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = VIEWS.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        this.setView(VIEWS[next].id);
        this.shadowRoot.querySelector(`[data-view=${this.view}]`).focus();
      });
      this.setView("full");
    }

    setView(view) {
      this.view = view;
      this.shadowRoot.querySelectorAll("[role=tab]").forEach((tab) => {
        const active = tab.dataset.view === view;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      this.shadowRoot.querySelector("#window").setAttribute("aria-labelledby", `tab-${view}`);
      this.renderToolbar();
      this.renderState();
    }

    onClick(event) {
      const button = event.target.closest("button");
      if (!button || button.disabled) return;
      if (button.dataset.view) return this.setView(button.dataset.view);
      if (button.dataset.go) {
        if (button.dataset.go === "time") this.state.time.elapsed = Math.max(0, M.stamp(this.epsilon) - 100 + this.epsilon);
        return this.setView(button.dataset.go);
      }
      if (button.dataset.jump !== undefined) {
        const index = Number(button.dataset.jump);
        if (this.view === "time") this.state.time.elapsed = index;
        else if (this.view === "reads") this.state.reads.at = index;
        else this.state[this.view].index = index;
        return this.renderState();
      }
      if (button.dataset.placement !== undefined) {
        this.state.full = { index: 0, single: button.dataset.placement === "single", recovery: false };
        return this.setView("full");
      }
      const action = button.dataset.action;
      if (action === "about") return this.shadowRoot.querySelector("dialog").showModal();
      if (action === "close-about") return this.shadowRoot.querySelector("dialog").close();
      if (action === "wound") {
        this.state.locks = { index: 0, scenario: "wound" };
        return this.setView("locks");
      }
      if (action === "crash") {
        this.state.full.recovery = true;
        this.state.full.index += 1;
        return this.renderState();
      }
      if (action === "recover") {
        this.state.twopc.recovered = true;
        this.state.twopc.index += 1;
        return this.renderState();
      }
      if (action === "resolve") {
        this.state.reads.resolved = true;
        return this.renderState();
      }
      if (action === "reset") {
        if (this.view === "time") this.state.time.elapsed = 0;
        else if (this.view === "reads") this.state.reads = { at: M.stamp(this.epsilon) + 5, blocker: "ready", resolved: false };
        else {
          this.state[this.view].index = 0;
          if (this.view === "full") this.state.full.recovery = false;
          if (this.view === "twopc") this.state.twopc.recovered = false;
        }
        this.renderToolbar();
      }
      if (action === "back" || action === "next") {
        const delta = action === "next" ? 1 : -1;
        if (this.view === "time") this.state.time.elapsed += delta;
        else if (this.view === "reads") this.state.reads.at += delta;
        else this.state[this.view].index += delta;
      }
      this.renderState();
    }

    onChange(event) {
      const input = event.target;
      if (input.id === "lock-scenario") this.state.locks = { index: 0, scenario: input.value };
      else if (input.id === "commit-scenario") this.state.twopc = { index: 0, scenario: input.value, recovered: false };
      else if (input.id === "replica-mode") {
        this.state.reads.blocker = input.value;
        this.state.reads.resolved = false;
        if (input.value !== "ready") this.state.reads.at = Math.max(this.state.reads.at, M.stamp(this.epsilon) + (input.value === "prepared" ? 25 : 0));
      } else return;
      this.renderState();
    }

    onInput(event) {
      const input = event.target;
      if (input.id === "epsilon") this.epsilon = Number(input.value);
      else if (input.id === "elapsed") this.state.time.elapsed = Number(input.value);
      else if (input.id === "snapshot-time") this.state.reads.at = Number(input.value);
      else return;
      this.renderState();
    }

    renderToolbar() {
      const v = this.view;
      let options = "";
      if (v === "full") options = `<div class="segmented" role="group" aria-label="Account placement"><button data-placement="multi" aria-pressed="${!this.state.full.single}">Two groups</button><button data-placement="single" aria-pressed="${this.state.full.single}">One group</button></div><button data-action="crash" class="failure-button" title="Available at the replicated-decision step">Crash leader A</button><button data-go="reads" class="quiet">Read-only →</button>`;
      if (v === "locks") options = `<label class="select-label" for="lock-scenario">Scenario <select id="lock-scenario"><option value="contention">Lock contention</option><option value="deadlock">Naive deadlock</option><option value="wound">Wound-wait</option></select></label>`;
      if (v === "twopc") options = `<label class="select-label" for="commit-scenario">Scenario <select id="commit-scenario"><option value="commit">Everyone votes YES</option><option value="abort">A participant votes NO</option><option value="crash">Coordinator crashes</option></select></label><button data-action="recover" class="failure-button">Recover coordinator</button>`;
      if (v === "time") options = `<label class="range-label" for="epsilon">Uncertainty ε <input id="epsilon" type="range" min="1" max="12" value="${this.epsilon}"><output id="epsilon-out">${this.epsilon} ms</output></label><label class="range-label" for="elapsed">Elapsed <input id="elapsed" type="range" min="0" max="32" value="${this.state.time.elapsed}"><output id="elapsed-out">${this.state.time.elapsed} ms</output></label>`;
      if (v === "reads") options = `<label class="range-label" for="snapshot-time">Snapshot t <input id="snapshot-time" type="range" min="80" max="${M.stamp(this.epsilon) + 35}" value="${this.state.reads.at}"><output id="snapshot-out">${this.state.reads.at}</output></label><label class="select-label" for="replica-mode">Replica B <select id="replica-mode"><option value="ready">Ready</option><option value="lag">Replication lag</option><option value="prepared">Unresolved prepare</option></select></label><button data-action="resolve" class="quiet">Catch up replica</button>`;
      this.shadowRoot.querySelector("#toolbar").innerHTML = `<div class="view-options">${options}</div><div class="step-controls" role="group" aria-label="Step controls"><button data-action="back">← Back</button><button data-action="next" class="primary">${["time", "reads"].includes(v) ? "+1 ms →" : "Next →"}</button><button data-action="reset">Reset</button><span id="counter"></span></div>`;
      const selector = v === "locks" ? "#lock-scenario" : v === "twopc" ? "#commit-scenario" : v === "reads" ? "#replica-mode" : null;
      if (selector) this.shadowRoot.querySelector(selector).value = this.state[v].scenario ?? this.state.reads.blocker;
    }

    renderState() {
      const root = this.shadowRoot;
      const v = this.view;
      let title, detail, tag, tone = "blue", scene, inspector, entries, activePhase, counter, footer;
      let backDisabled = false, nextDisabled = false;
      if (["full", "locks", "twopc"].includes(v)) {
        const local = this.state[v];
        const steps = v === "full" ? M.transactionSteps({ ...local, epsilon: this.epsilon }) : v === "locks" ? M.lockingSteps(local.scenario) : M.twoPCSteps(local);
        local.index = Math.max(0, Math.min(local.index, steps.length - 1));
        const s = steps[local.index];
        ({ title, detail } = s);
        entries = steps.flatMap((step, index) => index === 0 || step.phase !== steps[index - 1].phase ? [{ label: step.phase, index }] : []);
        activePhase = entries.filter((entry) => entry.index <= local.index).at(-1).index;
        counter = `${local.index + 1} / ${steps.length}`;
        backDisabled = local.index === 0;
        nextDisabled = local.index === steps.length - 1;
        if (v === "full") {
          tag = s.single ? "SINGLE GROUP" : "SPANNER · READ-WRITE";
          scene = architecture(s);
          const ready = s.timestamp !== null && M.after(s.earliest, s.timestamp);
          inspector = `<h3>Transaction T1</h3><p class="eyebrow">Committed balances</p>${balances(s.a, s.b)}
            <dl>${fact("Locks", s.locks)}${fact("Group A log", s.aLog)}${fact("Group B log", s.single ? "Not involved" : s.bLog)}${fact("Commit timestamp", s.timestamp === null ? "Not assigned" : `s = ${s.timestamp}`)}</dl>
            <div class="clock-card"><span>TT.now()</span><strong>[${s.earliest}, ${s.latest}]</strong>${badge(s.timestamp === null ? "No commit timestamp yet" : ready ? "TT.after(s) · true" : "TT.after(s) · false", ready ? "green" : "purple")}<button class="text-button" data-go="time">Explore commit wait →</button></div>
            <p class="micro">${s.buffer && !s.applied ? "Buffered only: A $800 · B $800. Locks stay held." : s.applied ? "Both versions carry the same commit timestamp." : "The total starts at $1,600."}</p>`;
          root.querySelector("[data-action=crash]").disabled = !(s.phase === "Replicate" && s.durable && !local.recovery);
          footer = "Blue / teal: replication within a group. Amber: coordination between groups. Three voters per group; two form a majority.";
        } else if (v === "locks") {
          tag = local.scenario === "deadlock" ? "2PL · COUNTEREXAMPLE" : "2PL · ISOLATION";
          tone = s.deadlock ? "red" : "blue";
          scene = lockDiagram(s);
          inspector = `<h3>Lock table</h3><dl>${fact("X(A)", s.ownerA ?? "Free")}${fact("X(B)", s.ownerB ?? "Free")}${fact("T1", s.t1)}${fact("T2", s.t2)}</dl>
            <div class="principle-card ${s.deadlock ? "danger" : ""}"><strong>${s.deadlock ? "Waiting is not enough" : "Strict locking"}</strong><p>${s.deadlock ? "A cycle can form under naive waiting. Spanner uses wound-wait to prevent it." : "Keep locks until commit or abort. Do not acquire new locks after starting to release them."}</p></div>
            ${local.scenario === "deadlock" ? '<button data-action="wound" class="wide primary">Try Wound-wait →</button>' : badge(local.scenario === "wound" ? "Older wounds · younger waits" : "Conflicting access waits", "teal")}
            <p class="micro">Age is the transaction’s ordering priority, not a TrueTime uncertainty interval.</p>`;
          footer = "This isolated lock lesson uses exclusive locks. The full transaction view also shows shared reads and lock upgrades.";
        } else {
          tag = "ORDINARY 2PC · ATOMICITY";
          tone = s.blocked ? "amber" : s.decision === "ABORT" ? "red" : "blue";
          scene = twoPCDiagram(s);
          inspector = `<h3>Durable transaction state</h3><dl>${fact("Coordinator’s log", s.decision ? `${s.decision}${s.offline ? " · disk offline" : ""}` : "No decision")}${fact("A prepared?", s.preparedA ? "YES" : "No")}${fact("B prepared?", s.preparedB ? "YES" : "No")}${fact("Participants know", s.released ? s.decision : "No final outcome")}${fact("Locks / resources", s.released ? "Released" : s.preparedA ? "Retained" : "Not prepared")}</dl>
            <div class="principle-card ${s.blocked ? "warning" : ""}"><strong>${s.blocked ? "Safety can require waiting" : "One outcome, both accounts"}</strong><p>${s.blocked ? "A participant cannot infer ABORT from silence after voting YES." : "YES means the participant promises to follow the final decision. It does not mean the writes are visible."}</p></div><button data-go="full" class="text-button">Compare replicated coordination →</button>`;
          root.querySelector("[data-action=recover]").disabled = !(s.phase === "Blocked" && !local.recovered);
          footer = "The coordinator is separate in this standalone 2PC diagram. In the full Spanner view, one participant group also acts as coordinator.";
        }
      } else if (v === "time") {
        const elapsed = Math.max(0, Math.min(32, this.state.time.elapsed));
        this.state.time.elapsed = elapsed;
        const t = M.trueTime(this.epsilon, elapsed);
        const boundary = t.timestamp - 100 + this.epsilon;
        tag = "TRUETIME · EXTERNAL CONSISTENCY";
        tone = t.ready ? "green" : "purple";
        title = t.ready ? "Now it is safe to expose the commit" : t.earliest === t.timestamp ? "Equality is not enough" : "The commit timestamp is still inside or ahead of the bound";
        detail = `At timestamp selection, TT.latest = ${100 + this.epsilon}; the previous assigned timestamp is 103. We choose s = ${t.timestamp}. With ε = ${this.epsilon} ms, advance time until earliest > s. These are illustrative integer time units.`;
        scene = timeDiagram(t);
        inspector = `<h3>The visibility gate</h3><dl>${fact("Commit timestamp", `s = ${t.timestamp}`)}${fact("Earliest", `${t.earliest} ms`)}${fact("Latest", `${t.latest} ms`)}${fact("ε · half-width", `${this.epsilon} ms`)}${fact("Interval width", `${2 * this.epsilon} ms`)}</dl>
          <div class="principle-card ${t.ready ? "good" : "warning"}"><strong>${t.ready ? "TT.after(s) = true" : "TT.after(s) = false"}</strong><p>${t.ready ? "A later transaction that starts after this success must receive a larger commit timestamp." : `${t.remaining} more simulated ms until the strict lower-bound test succeeds.`}</p></div><button data-go="full" class="text-button">Back to the transaction →</button><p class="micro">Paxos replication can overlap commit wait. These steps are not a latency benchmark.</p>`;
        entries = [{ label: "Choose s", index: 0 }, { label: "At the boundary", index: boundary }, { label: "Safe to expose", index: boundary + 1 }];
        activePhase = t.ready ? boundary + 1 : elapsed === boundary ? boundary : 0;
        counter = `+${elapsed} ms`;
        backDisabled = elapsed === 0;
        nextDisabled = elapsed === 32;
        root.querySelector("#epsilon-out").textContent = `${this.epsilon} ms`;
        root.querySelector("#elapsed-out").textContent = `${elapsed} ms`;
        root.querySelector("#elapsed").value = elapsed;
        footer = "ε is the interval’s half-width. The guarantee depends on valid uncertainty bounds; the clock reading is an interval, not an exact time.";
      } else {
        const local = this.state.reads;
        local.at = Math.max(80, Math.min(M.stamp(this.epsilon) + 35, local.at));
        const r = M.snapshot({ ...local, epsilon: this.epsilon });
        tag = "MVCC · READ-ONLY SNAPSHOT";
        tone = r.ready ? "teal" : "amber";
        title = r.ready ? `Read both accounts at t = ${r.at}, without read locks` : `Snapshot t = ${r.at} waits for replica B`;
        detail = "Select the newest version at or before the one shared snapshot timestamp. A replica serves the read only when t ≤ t_safe. Waiting for safe time is different from waiting to acquire a lock.";
        scene = readDiagram(r);
        inspector = `<h3>Snapshot eligibility</h3><dl>${fact("Read timestamp", `t = ${r.at}`)}${fact("Replica A · t_safe", r.safeA)}${fact("Replica B · t_safe", r.safeB)}${fact("B · replication bound", r.paxosB)}${fact("B · prepare bound", r.preparedLimit === Infinity ? "No unresolved prepare" : r.preparedLimit)}${fact("Read locks", "None")}</dl>
          <div class="principle-card ${r.ready ? "good" : "warning"}"><strong>${r.ready ? "Same timestamp, both groups" : "Safe time is a promise"}</strong><p>${r.ready ? "Both accounts come from the same logical time. A committed transfer is never read halfway." : local.blocker === "prepared" ? "An unresolved prepare at p bounds safe time to p − 1 until the outcome is resolved." : "A lagging replica cannot promise it has every version through the requested timestamp."}</p></div><p class="micro">t_safe = min(replication bound, prepare bound). Historical timestamp chosen explicitly.</p>`;
        entries = r.history.map((version) => ({ label: `${version.timestamp} · ${version.label}`, index: version.timestamp }));
        activePhase = r.selected.timestamp;
        counter = `t = ${r.at}`;
        backDisabled = local.at === 80;
        nextDisabled = local.at === M.stamp(this.epsilon) + 35;
        root.querySelector("#snapshot-time").value = local.at;
        root.querySelector("#snapshot-out").textContent = local.at;
        const resolve = root.querySelector("[data-action=resolve]");
        resolve.textContent = local.blocker === "prepared" ? "Resolve prepare" : "Catch up replica";
        resolve.disabled = local.blocker === "ready" || local.resolved;
        footer = "T1 transfers $200 A → B. T2 later transfers $50 B → A. Every completed snapshot preserves the $1,600 total.";
      }

      root.querySelector("#step-title").textContent = title;
      root.querySelector("#step-detail").textContent = detail;
      root.querySelector("#concept").innerHTML = badge(tag, tone);
      root.querySelector("#scene").dataset.view = v;
      root.querySelector("#scene").innerHTML = scene;
      root.querySelector("#inspector").innerHTML = inspector;
      root.querySelector("#counter").textContent = counter;
      root.querySelector("[data-action=back]").disabled = backDisabled;
      root.querySelector("[data-action=next]").disabled = nextDisabled;
      root.querySelector("#footer-note").textContent = footer;
      root.querySelector("#phase-list").innerHTML = entries.map((entry, index) => `<button data-jump="${entry.index}" class="phase-button ${entry.index === activePhase ? "active" : ""}" ${entry.index === activePhase ? 'aria-current="step"' : ""}><span class="phase-number">${String(index + 1).padStart(2, "0")}</span><span>${entry.label}</span></button>`).join("");
    }

    renderShell() {
      this.shadowRoot.innerHTML = `
        <style>
          :host { --ink:#172e43; --muted:#5e6d80; --blue:#1678b8; --teal:#0f8587; --border:#dce4ed; --scene-height:clamp(340px,calc(100dvh - 375px),490px); display:block; color:var(--ink); font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
          * { box-sizing:border-box; }
          button,input,select { font:inherit; }
          button,select { border:1px solid #b7c5d4; border-radius:6px; background:white; color:var(--ink); }
          button { cursor:pointer; padding:7px 11px; font-weight:650; line-height:1.25; }
          button:hover:not(:disabled) { background:#edf5fb; }
          button:disabled { opacity:.42; cursor:not-allowed; }
          button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible { outline:3px solid #65b9ed; outline-offset:3px; }
          .primary { color:white; background:var(--blue); border-color:var(--blue); }
          .primary:hover:not(:disabled) { background:#116aa4; }
          .quiet { background:transparent; border-color:transparent; color:#47677e; }
          .failure-button { color:#9e454b; border-color:#d7b5b8; background:#fffafb; font-size:12px; }
          .lab { border:1px solid var(--border); border-radius:12px; box-shadow:0 5px 22px #172e430a; background:white; overflow:hidden; }
          .tabs { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); background:#f5f8fb; border-bottom:1px solid var(--border); }
          .tab { display:flex; align-items:center; gap:10px; text-align:left; border:0; border-right:1px solid #e5ebf2; border-radius:0; padding:9px 14px; color:var(--muted); background:transparent; box-shadow:inset 0 -3px transparent; }
          .tab:last-child { border-right:0; }
          .tab[aria-selected=true] { color:#126798; background:white; box-shadow:inset 0 -3px var(--blue); }
          .tab-number { display:grid; place-items:center; min-width:27px; height:27px; background:#e7edf4; border-radius:7px; font-size:11px; }
          .tab[aria-selected=true] .tab-number { color:white; background:var(--blue); }
          .tab-name { display:block; font-size:13px; }
          .tab-sub { display:block; font-size:10px; font-weight:450; margin-top:2px; }
          #toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 13px; min-height:47px; border-bottom:1px solid var(--border); }
          .view-options,.step-controls { display:flex; flex-wrap:wrap; align-items:center; gap:7px; }
          .view-options { min-width:0; }
          .step-controls { flex-shrink:0; }
          #counter { min-width:54px; text-align:right; color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
          .segmented { display:flex; }
          .segmented button { font-size:12px; border-radius:0; }
          .segmented button:first-child { border-radius:6px 0 0 6px; }
          .segmented button:last-child { border-radius:0 6px 6px 0; border-left:0; }
          .segmented button[aria-pressed=true] { color:#116798; background:#eaf5fc; box-shadow:inset 0 0 0 1px #1678b8; }
          .select-label,.range-label { display:flex; gap:7px; align-items:center; color:var(--muted); font-size:12px; }
          select { padding:6px; max-width:215px; }
          .range-label input { width:115px; accent-color:var(--blue); cursor:pointer; }
          output { min-width:38px; font-weight:650; color:var(--ink); font-variant-numeric:tabular-nums; }
          .step-copy { display:grid; grid-template-columns:130px minmax(0,1fr); gap:14px; padding:8px 15px; min-height:76px; align-items:start; }
          #concept { padding-top:3px; }
          .badge { display:inline-block; padding:4px 7px; border-radius:5px; font-size:10px; font-weight:750; letter-spacing:.035em; line-height:1.5; }
          .badge.blue { color:#126798; background:#e8f3fc; }
          .badge.teal { color:#086d6e; background:#e3f5f1; }
          .badge.purple { color:#6c479d; background:#f0eafa; }
          .badge.amber { color:#95600a; background:#fff2d9; }
          .badge.green { color:#197044; background:#e5f6ec; }
          .badge.red { color:#a2333d; background:#fdebee; }
          h2 { margin:0 0 5px; font-size:17px; line-height:1.3; letter-spacing:-.02em; }
          #step-detail { margin:0; max-width:1100px; color:var(--muted); font-size:11.5px; line-height:1.45; }
          .workbench { display:grid; grid-template-columns:130px minmax(0,1fr) 244px; gap:14px; padding:0 15px 12px; align-items:start; }
          .phase-rail { min-width:0; border-top:1px solid var(--border); padding-top:10px; }
          .rail-title { margin:0 0 9px; color:#8190a1; letter-spacing:.08em; font-size:9px; font-weight:750; }
          #phase-list { display:flex; flex-direction:column; gap:3px; }
          .phase-button { display:flex; gap:8px; align-items:center; text-align:left; padding:7px 5px; border:0; font-size:11px; font-weight:500; color:var(--muted); background:transparent; }
          .phase-number { font-variant-numeric:tabular-nums; color:#a2afbd; font-size:10px; }
          .phase-button.active { background:#eaf5fc; color:#126798; font-weight:750; }
          .phase-button.active .phase-number { color:#1678b8; }
          #scene { height:var(--scene-height); min-width:0; padding:8px; border:1px solid #e2e9f1; border-radius:9px; background:radial-gradient(#dce4ed 0.6px,transparent 0.6px) 0 0 / 14px 14px,#fbfcfe; display:flex; flex-direction:column; justify-content:center; gap:9px; }
          svg { display:block; width:100%; height:100%; min-height:0; flex:1; overflow:visible; font-family:inherit; }
          .svg-zone { font-size:12px; font-weight:750; letter-spacing:1px; fill:#66788c; }
          .svg-zone-name { font-size:12px; fill:#8c9aac; }
          .svg-node-title { font-size:17px; font-weight:750; fill:var(--ink); }
          .svg-role { font-size:10px; font-weight:750; letter-spacing:.6px; }
          .svg-value { font-size:14px; fill:#425970; }
          .svg-log { font-size:12px; font-weight:600; }
          .svg-client { font-size:15px; font-weight:750; letter-spacing:.6px; }
          .svg-client-sub { font-size:13px; }
          .svg-status { font-size:15px; font-weight:650; }
          .svg-note { font-size:14px; fill:#6b7b8c; }
          .svg-tick { font-size:12px; fill:#6b7b8c; }
          .message { fill:none; stroke-width:2.5; }
          .message.blue { stroke:#1678b8; }
          .message.teal { stroke:#0f8587; }
          .message.amber { stroke:#b76b09; }
          .message.red { stroke:#b84049; }
          .message.green { stroke:#198754; }
          .diagram-legend { display:flex; justify-content:center; flex-wrap:wrap; gap:8px 14px; font-size:10px; color:var(--muted); }
          .diagram-legend span { display:inline-flex; align-items:center; gap:5px; }
          .line { display:inline-block; width:17px; border-top:2px dashed; }
          .line.blue { color:var(--blue); }
          .line.teal { color:var(--teal); }
          .line.amber { color:#b76b09; border-top-style:solid; }
          #inspector { background:#f6f8fb; border:1px solid var(--border); border-radius:9px; padding:10px; min-width:0; }
          h3 { margin:0 0 8px; font-size:13px; line-height:1.3; }
          .eyebrow { font-size:9px; text-transform:uppercase; color:#7d8b9b; letter-spacing:.06em; margin:0 0 6px; }
          .account-pair { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-bottom:10px; }
          .account { background:white; border:1px solid #dbe5ee; border-top:3px solid var(--blue); border-radius:6px; padding:5px 7px; }
          .account.b { border-top-color:var(--teal); }
          .account span { display:block; color:var(--muted); font-size:10px; }
          .account strong { display:block; margin-top:2px; font-size:18px; font-variant-numeric:tabular-nums; }
          dl { margin:0; }
          .fact { display:flex; justify-content:space-between; align-items:baseline; gap:9px; border-bottom:1px solid #e2e8f0; padding:4px 0; font-size:10px; }
          dt { color:var(--muted); font-weight:400; }
          dd { margin:0; text-align:right; font-weight:650; font-variant-numeric:tabular-nums; }
          .clock-card { display:grid; grid-template-columns:1fr auto; gap:4px; align-items:center; margin-top:8px; padding:7px 9px; background:#f0ecf8; border:1px solid #dfd5f0; border-radius:6px; }
          .clock-card > span { display:block; font-size:10px; color:#78589d; }
          .clock-card > strong { display:block; color:#634390; font-size:17px; font-variant-numeric:tabular-nums; margin:2px 0 3px; }
          .clock-card .badge { grid-column:1 / -1; padding:0; line-height:1.4; }
          .clock-card .text-button { grid-column:1 / -1; margin-top:3px; }
          .text-button { padding:0; border:0; background:transparent; color:#1678b8; font-size:11px; text-align:left; display:block; margin-top:10px; line-height:1.4; }
          .text-button:hover:not(:disabled) { text-decoration:underline; background:transparent; }
          .micro { color:#718195; font-size:10px; line-height:1.5; margin:7px 0 0; }
          .principle-card { margin:12px 0; padding:10px; border-radius:6px; border-left:3px solid #1678b8; background:#eaf3fb; font-size:11px; }
          .principle-card strong { display:block; margin-bottom:5px; }
          .principle-card p { margin:0; color:var(--muted); line-height:1.5; }
          .principle-card.warning { border-color:#b76b09; background:#fff5e4; }
          .principle-card.danger { border-color:#b84049; background:#fff0f2; }
          .principle-card.good { border-color:#198754; background:#eaf7ef; }
          .wide { width:100%; font-size:11px; }
          .footer { display:flex; align-items:center; justify-content:space-between; gap:15px; padding:9px 15px; border-top:1px solid var(--border); background:#f9fbfd; }
          #footer-note { color:#6b7c8e; font-size:10px; margin:0; }
          .footer button { font-size:10px; padding:0; border:0; white-space:nowrap; background:transparent; color:#1678b8; }
          .ordering-strip { display:flex; flex-wrap:wrap; gap:5px 9px; align-items:center; justify-content:center; font-size:10px; padding:9px; background:white; border:1px solid #e0e7ef; border-radius:6px; color:var(--muted); }
          .ordering-strip strong { color:#5f4390; }
          .read-zones { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:7px; }
          .read-zone { padding:7px 9px; background:white; border:1px solid #dce4ee; border-radius:6px; }
          .read-zone > span { display:block; color:#7c8b9e; font-size:9px; font-weight:700; margin-bottom:4px; }
          .read-zone div { display:flex; align-items:center; gap:4px; font-size:10px; white-space:nowrap; }
          .read-zone small { display:block; font-size:9px; color:#75879a; margin-top:3px; }
          .read-zone-active { background:#eaf5fc; border-color:#8dbbd8; }
          .dot { display:inline-block; width:6px; height:6px; border-radius:50%; }
          .dot.blue { background:var(--blue); }
          .dot.teal { background:var(--teal); margin-left:4px; }
          .version-grid { display:grid; grid-template-columns:1fr 1fr; gap:9px; }
          .version-card { background:white; border:1px solid #dbe4ee; border-radius:7px; overflow:hidden; }
          .version-heading { display:flex; justify-content:space-between; align-items:center; padding:7px; border-bottom:1px solid var(--border); }
          .version-heading h3 { margin:0; }
          table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; font-size:11px; }
          th,td { text-align:left; padding:5px 8px; border-bottom:1px solid #edf1f5; }
          th { font-size:9px; color:#718195; font-weight:500; background:#f9fbfd; }
          .chosen-version { background:#e8f7ef; color:#16673d; font-weight:650; }
          .future-version { color:#99a6b4; }
          .version-result { font-size:10px; padding:9px 10px; color:#596c80; }
          .snapshot-result { padding:8px 10px; border-radius:7px; border:1px solid #bcdec9; background:#edf8f2; }
          .snapshot-result.waiting { border-color:#e7d4ac; background:#fff7e6; }
          .snapshot-result > span { display:block; font-size:9px; font-weight:750; letter-spacing:.07em; color:#5b7b69; }
          .snapshot-result.waiting > span { color:#95723d; }
          .snapshot-result strong { display:block; font-size:17px; margin:3px 0; }
          .snapshot-result small { color:var(--muted); font-size:10px; }
          dialog { border:1px solid #ced9e5; border-radius:12px; padding:23px; width:min(630px,90vw); max-height:85dvh; color:var(--ink); box-shadow:0 20px 70px #172e4333; }
          dialog::backdrop { background:#172e4355; }
          dialog h2 { font-size:20px; }
          dialog p,dialog li { font-size:13px; line-height:1.6; color:var(--muted); }
          dialog a { color:#1678b8; }
          .dialog-top { display:flex; justify-content:space-between; gap:20px; align-items:start; margin-bottom:15px; }
          .dialog-top button { font-size:12px; }
          @media(min-width:1550px) { :host { --scene-height:490px; } }
          @media(max-width:1100px) { .tab { padding:10px; gap:7px; } .tab-sub { display:none; } .workbench { grid-template-columns:108px minmax(0,1fr) 215px; gap:10px; padding:0 10px 10px; } .step-copy { grid-template-columns:108px minmax(0,1fr); padding:12px 10px; gap:10px; } .view-options { gap:5px; } .quiet { font-size:11px; } .step-controls button { padding:7px 8px; } .range-label input { width:85px; } }
          @media(max-width:900px) { :host { --scene-height:360px; } #toolbar { flex-wrap:wrap; } .step-controls { margin-left:auto; } .workbench { grid-template-columns:minmax(0,1fr) 215px; } .phase-rail { grid-column:1 / -1; border-top:0; padding:0; } .rail-title { display:none; } #phase-list { flex-direction:row; flex-wrap:wrap; } .phase-button { font-size:10px; padding:5px; } .phase-number { display:none; } .step-copy { grid-template-columns:1fr; gap:5px; min-height:0; } #concept { padding:0; } .tab-number { display:none; } .tab { justify-content:center; text-align:center; } .tab-name { font-size:11px; } .read-zone div { flex-wrap:wrap; } }
          @media(max-width:620px) { .workbench { grid-template-columns:1fr; } #scene[data-view=reads] { height:auto; min-height:var(--scene-height); } #inspector { display:grid; grid-template-columns:1fr 1fr; gap:8px 14px; } #inspector h3,#inspector .eyebrow { grid-column:1 / -1; margin-bottom:0; } #inspector .micro { margin-top:0; } .tab { padding:9px 5px; } .tab-name { font-size:10px; } #toolbar { padding:9px; } .view-options { flex-wrap:wrap; } .view-options .quiet { padding-left:0; } .step-controls { width:100%; } #counter { margin-left:auto; } .range-label input { width:95px; } .range-label { font-size:11px; } .footer { align-items:start; } .snapshot-result strong { font-size:14px; } .version-grid { gap:6px; } th,td { padding:8px 5px; font-size:10px; } .read-zone { padding:7px 5px; } .read-zone small { font-size:8px; } .read-zone div { font-size:9px; } }
          @media(prefers-reduced-motion:reduce) { * { animation:none !important; transition:none !important; } }
        </style>
        <div class="lab">
          <div class="tabs" role="tablist" aria-label="Spanner lessons">${VIEWS.map((view, index) => `<button id="tab-${view.id}" class="tab" role="tab" data-view="${view.id}" aria-controls="window" aria-selected="false" tabindex="-1"><span class="tab-number">${String(index + 1).padStart(2, "0")}</span><span><span class="tab-name">${view.name}</span><span class="tab-sub">${view.sub}</span></span></button>`).join("")}</div>
          <section id="window" role="tabpanel" aria-labelledby="tab-full">
            <div id="toolbar"></div>
            <div class="step-copy"><div id="concept"></div><div aria-live="polite" aria-atomic="true"><h2 id="step-title"></h2><p id="step-detail"></p></div></div>
            <div class="workbench">
              <nav class="phase-rail" aria-label="Protocol phases"><p class="rail-title">WALKTHROUGH</p><div id="phase-list"></div></nav>
              <div id="scene"></div>
              <aside id="inspector" aria-label="Current protocol state"></aside>
            </div>
          </section>
          <div class="footer"><p id="footer-note"></p><button data-action="about" aria-haspopup="dialog">Model & sources ↗</button></div>
        </div>
        <dialog aria-labelledby="about-title"><div class="dialog-top"><h2 id="about-title">About this teaching model</h2><button data-action="close-about">Close</button></div>
          <p>This visualization follows the serializable read-write protocol in the original Spanner paper. Each example restarts from A = $1,000 and B = $600. Tabs retain their own progress; uncertainty ε is shared by the full transaction, TrueTime, and version timestamps.</p>
          <ul><li>Three voting replicas per group; two form a majority. Message batches and leader recovery are shown as logical steps, not measured network delays.</li><li>The leader-failure example occurs after a commit decision is replicated. Recovery still needs a surviving majority, valid leader-lease recovery, and commit wait.</li><li>Commit wait can overlap Paxos. A shared commit timestamp gives logical atomicity; replicas need not apply at the same physical instant.</li><li>The snapshot tab chooses a historical read timestamp directly. It summarizes safe time with replication and prepared-transaction bounds.</li></ul>
          <p>References: <a href="https://www.usenix.org/system/files/conference/osdi12/osdi12-final-16.pdf" target="_blank" rel="noopener">Corbett et al., Spanner (OSDI 2012), §§2.1, 4.1–4.2</a>; <a href="https://docs.cloud.google.com/spanner/docs/transactions" target="_blank" rel="noopener">Spanner transactions</a>; <a href="https://docs.cloud.google.com/spanner/docs/true-time-external-consistency" target="_blank" rel="noopener">TrueTime and external consistency</a>; <a href="https://docs.cloud.google.com/spanner/docs/whitepapers/life-of-reads-and-writes" target="_blank" rel="noopener">Life of Spanner reads and writes</a>.</p>
        </dialog>`;
    }
  }

  if (!customElements.get("spanner-transaction-lab")) customElements.define("spanner-transaction-lab", SpannerTransactionLab);
})();
