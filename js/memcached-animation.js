(() => {
  "use strict";

  const M = globalThis.MemcachedModel;
  const VIEWS = [
    { id: "basics", name: "Cache basics", sub: "Read, write, invalidate" },
    { id: "race", name: "Stale refills", sub: "Why a delete is not enough" },
    { id: "herd", name: "Miss storms", sub: "One refill for many readers" },
    { id: "scaling", name: "Scaling", sub: "Cluster → region → regions" },
  ];
  const colors = { blue: "#1678b8", teal: "#0f8587", amber: "#b76b09", red: "#b84049", muted: "#8a9bb0" };
  const value = (v) => v === null ? "Empty" : `v${v} · ${M.VALUES[v]}`;
  const badge = (text, tone = "blue") => `<span class="badge ${tone}">${text}</span>`;
  const fact = (label, text) => `<div class="fact"><dt>${label}</dt><dd>${text}</dd></div>`;
  const values = (items) => `<div class="value-pair">${items.map(({ label, v, stale }) => `<div class="value-card ${stale ? "stale" : ""}"><span>${label}</span><strong>${v === null ? "—" : `v${v}`}</strong><small>${v === null ? "No cached copy" : M.VALUES[v]}${stale ? " · stale" : ""}</small></div>`).join("")}</div>`;
  const principle = (title, text, tone = "blue") => `<div class="principle ${tone}"><strong>${title}</strong><p>${text}</p></div>`;
  const svgStart = (label, width = 900, height = 390) => `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}"><defs>${Object.entries(colors).map(([name, color]) => `<marker id="arrow-${name}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`).join("")}</defs>`;
  const arrow = (d, text, x, y, tone = "blue") => `<path d="${d}" class="message ${tone}" marker-end="url(#arrow-${tone})"/>${text ? `<rect x="${x - text.length * 3.6 - 7}" y="${y - 13}" width="${text.length * 7.2 + 14}" height="23" rx="4" fill="white"/><text x="${x}" y="${y + 3}" text-anchor="middle" class="svg-message" fill="${colors[tone]}">${text}</text>` : ""}`;
  const box = (x, y, width, height, title, main, foot, tone = "blue", stale = false) => `<g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="${stale ? "#fff0f2" : tone === "teal" ? "#edf8f5" : "#f1f7fd"}" stroke="${stale ? colors.red : colors[tone]}" stroke-width="1.5"/>
    <text x="${x + 15}" y="${y + 23}" class="svg-title">${title}</text>
    <text x="${x + 15}" y="${y + 50}" class="svg-value" fill="${stale ? colors.red : colors[tone]}">${main}</text>
    <text x="${x + 15}" y="${y + height - 12}" class="svg-small">${foot}</text>
  </g>`;

  function basicsDiagram(s, scenario) {
    let line = "";
    if (["get", "miss"].includes(s.event)) line = arrow("M 301 134 Q 410 74 548 87", s.event === "miss" ? "MISS" : `get(k)`, 420, 87, s.event === "miss" ? "amber" : "blue");
    if (s.event === "hit") line = arrow("M 549 121 Q 427 168 302 169", "HIT · v1", 420, 153, "teal");
    if (["fetch", "update", "commit"].includes(s.event)) line = arrow("M 301 182 Q 411 289 548 289", s.event === "fetch" ? "DB read" : s.event === "commit" ? "COMMIT v2" : "UPDATE", 420, 266);
    if (["fill", "delete"].includes(s.event)) line = arrow("M 301 134 Q 410 74 548 87", s.event === "delete" ? "delete(k)" : `set(k, v${s.held})`, 420, 87, s.event === "delete" ? "amber" : "teal");
    if (s.event === "return") line = arrow("M 155 202 V 306", `return v${s.returned}`, 156, 254, "teal");
    return `${svgStart("Application-managed look-aside cache with an authoritative database")}
      <path d="M 300 141 Q 425 65 551 86 M 300 181 Q 425 285 551 287" stroke="#dae3ed" stroke-width="2" fill="none" stroke-dasharray="6 5"/>
      ${box(60, 100, 240, 102, scenario === "write" ? "APPLICATION · WRITER" : "APPLICATION · READER", s.held === null ? "No local value yet" : `Holds ${value(s.held)}`, "Owns the get / fetch / fill logic")}
      ${box(550, 40, 280, 112, "MEMCACHED", value(s.cache), s.cache !== null && s.cache !== s.db ? "Older than the committed DB" : "Disposable cached copy", "teal", s.cache !== null && s.cache !== s.db)}
      ${box(550, 242, 280, 112, "DATABASE", value(s.db), "Authoritative, durable value")}
      ${line}
      <text x="175" y="336" text-anchor="middle" class="svg-small">${s.returned === null ? "Caller waits for a result" : `Caller receives ${value(s.returned)}`}</text>
    </svg><div class="diagram-note">Reads: cache first. Writes: database first, then invalidate.</div>`;
  }

  function raceDiagram(s) {
    const lane = (leased) => {
      const cached = leased ? s.leased.value : s.plain;
      const stale = cached !== null && cached !== s.db;
      const later = ["retry", "result"].includes(s.event);
      const readerLine = later ? leased ? s.event === "result" ? "Receives v2" : "Fetches v2 · L18" : "Receives stale v1" : s.held === null ? "No fetched value" : "Holds old v1";
      let line = "";
      if (s.event === "get") line = arrow("M 196 50 Q 262 108 334 199", leased ? "MISS + L17" : "MISS", 246, 141, "amber");
      if (s.event === "fetch") line = arrow("M 103 87 V 199", "read v1", 102, 146);
      if (s.event === "update") line = arrow("M 242 52 Q 158 119 104 199", "commit v2", 168, 135);
      if (s.event === "delete") line = arrow("M 335 87 V 199", leased ? "delete · revoke" : "delete", 335, 147, "amber");
      if (s.event === "late-fill") line = arrow("M 196 50 Q 264 110 334 199", leased ? "L17 rejected" : "set old v1", 247, 141, leased ? "teal" : "red");
      if (s.event === "retry") line = leased ? arrow("M 103 87 V 199", "read v2", 102, 146) : arrow("M 334 199 Q 262 107 196 50", "HIT · old v1", 246, 141, "red");
      if (s.event === "result" && leased) line = arrow("M 196 50 Q 264 110 334 199", "fill v2 · L18", 247, 141, "teal");
      const foot = leased ? s.leased.lease ? `${s.leased.lease.label} is live` : s.rejected && cached === null ? "Revoked token rejected" : s.event === "result" ? "New token accepted" : "No valid refill token" : stale ? "Stale value re-entered" : "Unconditional set allowed";
      return `<section class="compare-pane"><div class="compare-title"><strong>${leased ? "With a lease" : "Without a lease"}</strong>${badge(leased ? "Check refill token" : "Unconditional set", leased ? "teal" : "amber")}</div>
        ${svgStart(leased ? "The lease path rejects a refill after invalidation" : "An ordinary set can restore stale data after invalidation", 440, 310)}
          <rect x="12" y="14" width="184" height="73" rx="9" fill="white" stroke="#bbcfdf"/>
          <text x="26" y="39" class="svg-title">${later ? "NEXT READER" : "READER A"}</text><text x="26" y="66" class="svg-small">${readerLine}</text>
          <rect x="242" y="14" width="184" height="73" rx="9" fill="white" stroke="#bbcfdf"/>
          <text x="256" y="39" class="svg-title">WRITER B</text><text x="256" y="66" class="svg-small">${s.writer}</text>
          ${box(12, 202, 184, 87, "DATABASE", value(s.db), "Authoritative")}
          ${box(242, 202, 184, 87, "CACHE", value(cached), foot, "teal", stale)}
          ${line}
        </svg>
        <div class="compare-outcome ${stale ? "bad" : leased && s.rejected ? "good" : ""}">${stale ? "Stale cache: v1" : leased && cached === 2 ? "Fresh cache: v2" : leased && s.rejected ? "Old refill blocked" : "No stale refill yet"}</div>
      </section>`;
    };
    return `<div class="compare-grid">${lane(false)}${lane(true)}</div>`;
  }

  function herdDiagram(s) {
    const lane = (leased) => {
      const count = leased ? s.leaseReads : s.plainReads;
      const cache = leased ? s.leaseCache : s.plainCache;
      const queried = count > 0;
      const top = Array.from({ length: s.readers }, (_, i) => {
        const columns = Math.min(4, s.readers);
        const x = 12 + (i % columns) * (416 / columns);
        const y = 12 + Math.floor(i / columns) * 50;
        const label = !queried ? "Reader" : leased && i > 0 ? s.waiting ? "Wait / retry" : "Cache hit" : "DB reader";
        return `<rect x="${x}" y="${y}" width="${416 / columns - 8}" height="39" rx="6" fill="${leased && i > 0 && s.waiting ? "#fff4df" : "white"}" stroke="#c8d6e4"/><text x="${x + (416 / columns - 8) / 2}" y="${y + 16}" text-anchor="middle" class="svg-client">C${i + 1}</text><text x="${x + (416 / columns - 8) / 2}" y="${y + 30}" text-anchor="middle" class="svg-client-small">${label}</text>`;
      }).join("");
      let paths = "";
      if (s.event === "get" || s.event === "query") {
        paths = Array.from({ length: s.readers }, (_, i) => {
          const columns = Math.min(4, s.readers);
          const x = 12 + (i % columns) * (416 / columns) + (416 / columns - 8) / 2;
          const y = 51 + Math.floor(i / columns) * 50;
          const blocked = leased && i > 0 && s.event === "query";
          const end = s.event === "query" && !blocked ? 239 : 137;
          const target = 220 + (i - (s.readers - 1) / 2) * 6;
          const edge = i % 2 === 0 ? 48 - i * 3 : 388 + i * 3;
          const d = end === 239
            ? `M ${x} ${y} C ${edge} ${y + 24} ${edge} 122 ${edge} 211 Q ${edge} 230 ${target} 239`
            : `M ${x} ${y} Q ${x} 113 ${target} ${end}`;
          return `<path d="${d}" class="message ${blocked ? "amber" : leased ? "teal" : "blue"}" opacity=".7" marker-end="url(#arrow-${blocked ? "amber" : leased ? "teal" : "blue"})"/>`;
        }).join("");
      }
      return `<section class="compare-pane"><div class="compare-title"><strong>${leased ? "With leases" : "Without leases"}</strong>${badge(leased ? "One refill holder" : "Every miss falls back", leased ? "teal" : "amber")}</div>
        ${svgStart(leased ? "One lease holder reads the database while other clients wait" : "Every missing client queries the database", 440, 310)}
          ${paths}${top}
          <rect x="115" y="140" width="210" height="57" rx="9" fill="#edf8f5" stroke="#75b8ac"/>
          <text x="220" y="162" text-anchor="middle" class="svg-title">MEMCACHED</text><text x="220" y="182" text-anchor="middle" class="svg-small">${value(cache)}${leased && s.waiting ? " · lease C1" : ""}</text>
          <rect x="115" y="242" width="210" height="57" rx="9" fill="#edf4fc" stroke="#98b6d4"/>
          <text x="220" y="264" text-anchor="middle" class="svg-title">DATABASE</text><text x="220" y="284" text-anchor="middle" class="svg-small">${count} read${count === 1 ? "" : "s"} in this burst</text>
        </svg><div class="compare-outcome ${leased && queried ? "good" : ""}"><span>Database reads</span><strong>${count}</strong></div>
      </section>`;
    };
    return `<div class="compare-grid">${lane(false)}${lane(true)}</div>`;
  }

  function clusterDiagram(s) {
    const centers = [150, 450, 750];
    return `${svgStart("One frontend cluster routes a key to one of three Memcached shards")}
      <rect x="13" y="8" width="874" height="286" rx="12" fill="#f7f9fc" stroke="#dce5ef"/>
      ${centers.map((x, i) => `<rect x="${x - 100}" y="24" width="200" height="46" rx="7" fill="white" stroke="#c6d5e4"/><text x="${x}" y="53" text-anchor="middle" class="svg-title">Web server ${i + 1}</text><path d="M ${x} 70 V 112" stroke="#c3cfdd" stroke-width="2"/>`).join("")}
      <rect x="185" y="112" width="530" height="45" rx="7" fill="#e8f2fc" stroke="#9dbbd8"/><text x="450" y="139" text-anchor="middle" class="svg-title">Client routing · placement for ${s.key}</text>
      ${centers.map((x, i) => `<path d="M 450 158 Q 450 181 ${x} 209" stroke="${i === s.shard && s.event !== "none" ? colors.blue : "#cad5e2"}" stroke-width="${i === s.shard && s.event !== "none" ? 3 : 1.5}" fill="none"/>${box(x - 110, 210, 220, 72, `CACHE ${i + 1}`, i === s.shard ? s.cached ? "v1 · Away" : "Key absent" : "Other keys", "", i === s.shard ? "teal" : "muted")}`).join("")}
      ${box(305, 313, 290, 72, "BACKING DATABASE", "v1 · Away", "")}
      ${s.event === "fetch" ? arrow("M 48 47 H 10 V 330 Q 10 349 301 349", "App fallback", 155, 330) : ""}
    </svg><div class="diagram-note">One key → one chosen shard in this placement example.</div>`;
  }

  function regionDiagram(s) {
    return `${svgStart("Two frontend clusters receive invalidations from a storage-side daemon")}
      ${[20, 470].map((x, i) => `<rect x="${x}" y="12" width="410" height="225" rx="12" fill="#f7f9fc" stroke="#dce5ef"/><text x="${x + 17}" y="36" class="svg-zone">FRONTEND CLUSTER ${i === 0 ? "A" : "B"}</text><rect x="${x + 18}" y="49" width="374" height="38" rx="7" fill="white" stroke="#d1dce8"/><text x="${x + 205}" y="74" text-anchor="middle" class="svg-title">Web servers · local reads</text>${box(x + 18, 122, 235, 86, "LOCAL CACHE", value(i === 0 ? s.cacheA : s.cacheB), "Independent cached copy", "teal", (i === 0 ? s.cacheA : s.cacheB) === 1 && s.db === 2)}<rect x="${x + 270}" y="139" width="122" height="55" rx="7" fill="#fff6e6" stroke="#dabc8b"/><text x="${x + 331}" y="162" text-anchor="middle" class="svg-title">mcrouter</text><text x="${x + 331}" y="182" text-anchor="middle" class="svg-small">delete routing</text><path d="M ${x + 269} 167 H ${x + 255}" stroke="${colors.amber}" stroke-width="${s.event === "fanout" ? 3 : 1.5}" marker-end="url(#arrow-amber)"/>`).join("")}
      ${box(35, 300, 270, 79, "SHARED DATABASE", value(s.db), "Committed storage")}
      <rect x="370" y="310" width="185" height="60" rx="8" fill="#fff6e6" stroke="#dabc8b"/><text x="462" y="336" text-anchor="middle" class="svg-title">mcsqueal</text><text x="462" y="357" text-anchor="middle" class="svg-small">read committed deletes</text>
      <path d="M 306 340 H 366" class="message ${s.event === "log" ? "amber" : "muted"}" marker-end="url(#arrow-amber)"/>
      <path d="M 462 309 V 270 H 351 V 197 M 462 270 H 801 V 197" class="message ${s.event === "fanout" ? "amber" : "muted"}" marker-end="url(#arrow-amber)"/>
      <text x="665" y="292" text-anchor="middle" class="svg-small">Batched invalidations to each cluster</text>
    </svg>`;
  }

  function regionsDiagram(s) {
    let lines = arrow("M 394 314 H 504", s.event === "replicate" ? "apply v2" : "async", 450, 292, s.event === "replicate" ? "blue" : "muted");
    if (s.event === "early-delete") lines += arrow("M 394 71 Q 450 85 504 156", "delete early", 450, 113, "red");
    if (s.event === "delete-replica") lines += arrow("M 785 270 V 213", "then delete", 785, 244, "amber");
    if (s.event === "fetch") lines += arrow("M 630 213 V 268", `read v${s.fetched}`, 630, 244);
    return `${svgStart("Master and replica regions with asynchronous database replication")}
      ${[25, 490].map((x, i) => `<rect x="${x}" y="12" width="385" height="365" rx="12" fill="#f7f9fc" stroke="#dce5ef"/><text x="${x + 18}" y="37" class="svg-zone">${i === 0 ? "MASTER REGION" : "REPLICA REGION"}</text><rect x="${x + 18}" y="53" width="349" height="37" rx="7" fill="white" stroke="#d3deea"/><text x="${x + 192}" y="77" text-anchor="middle" class="svg-title">Web servers · local cache first</text>${box(x + 18, 119, 349, 94, "REGIONAL CACHE", value(i === 0 ? s.masterCache : s.replicaCache), i === 0 ? "Invalidated locally after commit" : "Demand-filled from local reads", "teal", (i === 0 ? s.masterCache : s.replicaCache) === 1 && s.master === 2)}${box(x + 18, 271, 349, 85, i === 0 ? "WRITABLE DATABASE" : "REPLICA DATABASE", value(i === 0 ? s.master : s.replica), i === 0 ? "Authoritative writes" : "Asynchronous apply")}`).join("")}
      ${lines}
    </svg>`;
  }

  class MemcachedLab extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.view = "basics";
      this.state = {
        basics: { index: 0, scenario: "miss" },
        race: { index: 0 },
        herd: { index: 0, readers: 4 },
        scaling: { index: 0, scope: "cluster", key: M.KEY, ordering: "correct" },
      };
    }

    connectedCallback() {
      this.renderShell();
      this.shadowRoot.addEventListener("click", (event) => this.onClick(event));
      this.shadowRoot.addEventListener("change", (event) => this.onChange(event));
      this.shadowRoot.addEventListener("input", (event) => {
        if (event.target.id !== "readers") return;
        this.state.herd.readers = Number(event.target.value);
        this.renderState();
      });
      this.shadowRoot.addEventListener("keydown", (event) => {
        if (!event.target.matches("[role=tab]")) return;
        const index = VIEWS.findIndex((v) => v.id === event.target.dataset.view);
        let next;
        if (event.key === "ArrowRight") next = (index + 1) % VIEWS.length;
        if (event.key === "ArrowLeft") next = (index + VIEWS.length - 1) % VIEWS.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = VIEWS.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        this.setView(VIEWS[next].id);
        this.shadowRoot.querySelector(`[data-view=${this.view}]`).focus();
      });
      this.setView("basics");
    }

    onClick(event) {
      const button = event.target.closest("button");
      if (!button || button.disabled) return;
      if (button.dataset.view || button.dataset.go) return this.setView(button.dataset.view ?? button.dataset.go);
      const action = button.dataset.action;
      if (action === "about") return this.shadowRoot.querySelector("dialog").showModal();
      if (action === "close-about") return this.shadowRoot.querySelector("dialog").close();
      const local = this.state[this.view];
      if (button.dataset.jump !== undefined) local.index = Number(button.dataset.jump);
      if (action === "back") local.index -= 1;
      if (action === "next") local.index += 1;
      if (action === "reset") local.index = 0;
      this.renderState();
    }

    onChange(event) {
      const input = event.target;
      if (input.id === "basic-scenario") this.state.basics.scenario = input.value;
      else if (input.id === "scope") this.state.scaling.scope = input.value;
      else if (input.id === "key") this.state.scaling.key = input.value;
      else if (input.id === "ordering") this.state.scaling.ordering = input.value;
      else return;
      this.state[this.view].index = 0;
      this.renderToolbar();
      this.renderState();
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

    renderToolbar() {
      let options = "";
      const local = this.state[this.view];
      if (this.view === "basics") options = '<label for="basic-scenario">Scenario</label><select id="basic-scenario"><option value="miss">Read: cache miss</option><option value="hit">Read: cache hit</option><option value="write">Write, then invalidate</option></select>';
      if (this.view === "race") options = `${badge("SYNCHRONIZED COMPARISON", "teal")}<span class="toolbar-note">Same events · different refill policy</span>`;
      if (this.view === "herd") options = `<label for="readers">Concurrent readers</label><input id="readers" type="range" min="3" max="8" value="${local.readers}"><output id="readers-out">${local.readers}</output><span class="toolbar-note">One hot key · one miss wave</span>`;
      if (this.view === "scaling") {
        options = '<label for="scope">Scope</label><select id="scope"><option value="cluster">One cluster</option><option value="region">One region</option><option value="regions">Across regions</option></select>';
        if (local.scope === "cluster") options += `<label for="key">Key</label><select id="key">${Object.keys(M.PLACEMENT).map((key) => `<option value="${key}">${key}</option>`).join("")}</select>`;
        if (local.scope === "regions") options += '<label for="ordering">Ordering</label><select id="ordering"><option value="correct">Apply, then invalidate</option><option value="early">Counterexample: delete early</option></select>';
      }
      this.shadowRoot.querySelector("#toolbar").innerHTML = `<div class="view-options">${options}</div><div class="step-controls" role="group" aria-label="Step controls"><button data-action="back">← Back</button><button data-action="next" class="primary">Next →</button><button data-action="reset">Reset</button><span id="counter"></span></div>`;
      const root = this.shadowRoot;
      if (this.view === "basics") root.querySelector("#basic-scenario").value = local.scenario;
      if (this.view === "scaling") {
        root.querySelector("#scope").value = local.scope;
        if (local.scope === "cluster") root.querySelector("#key").value = local.key;
        if (local.scope === "regions") root.querySelector("#ordering").value = local.ordering;
      }
    }

    renderState() {
      const root = this.shadowRoot;
      const v = this.view;
      const local = this.state[v];
      const steps = v === "basics" ? M.basicsSteps(local.scenario) : v === "race" ? M.raceSteps() : v === "herd" ? M.herdSteps(local.readers)
        : local.scope === "cluster" ? M.clusterSteps(local.key) : local.scope === "region" ? M.regionSteps() : M.crossRegionSteps(local.ordering);
      local.index = Math.max(0, Math.min(local.index, steps.length - 1));
      const s = steps[local.index];
      let scene, inspector, footer, concept;
      if (v === "basics") {
        concept = badge("LOOK-ASIDE CACHE");
        scene = basicsDiagram(s, local.scenario);
        inspector = `<h3>One key, two roles</h3>${values([{ label: "Database", v: s.db }, { label: "Cached copy", v: s.cache, stale: s.cache !== null && s.cache !== s.db }])}<dl>${fact("DB reads", s.reads)}${fact("DB writes", s.writes)}${fact("App holds", s.held === null ? "No value yet" : `v${s.held}`)}${fact("Caller received", s.returned === null ? "Waiting" : `v${s.returned}`)}</dl>${principle("Application-managed flow", "The app handles misses, fetches data, and refills the cache.")}<button class="text-button" data-go="race">What can race with this fill? →</button>`;
        footer = "A missing cache entry is recoverable. In this example, writes commit to the database before deleting the cached copy.";
      } else if (v === "race") {
        concept = badge("FACEBOOK LEASES", "teal");
        scene = raceDiagram(s);
        inspector = `<h3>Same write, different outcome</h3>${values([{ label: "Plain set", v: s.plain, stale: s.plain !== null && s.plain !== s.db }, { label: "Lease fill", v: s.leased.value }])}<dl>${fact("Database", `v${s.db} · ${M.VALUES[s.db]}`)}${fact("Original reader holds", s.held === null ? "Nothing yet" : `v${s.held}`)}${fact("Lease status", s.tokenLabel)}</dl>${principle("Revoke refill permission", "Only a valid token can refill this key. A delete revokes that permission.", "teal")}<p class="micro">Protects refill order, not an already-running read or a full transaction.</p>`;
        footer = "Both lanes advance together. The lease mechanism shown here is an extension described in the Facebook Memcache paper.";
      } else if (v === "herd") {
        concept = badge("FACEBOOK LEASES", "teal");
        scene = herdDiagram(s);
        inspector = `<h3>Duplicate database work</h3><div class="metric-pair"><div><span>No leases</span><strong>${s.plainReads}</strong><small>DB reads</small></div><div class="good-metric"><span>With leases</span><strong>${s.leaseReads}</strong><small>DB reads</small></div></div><dl>${fact("Concurrent readers", s.readers)}${fact("Waiting with leases", s.waiting)}</dl>${principle("One mechanism, two benefits", "Block stale fills. Share fallback work.", "teal")}`;
        root.querySelector("#readers-out").textContent = local.readers;
        footer = "Counts are for this toy burst, not a benchmark. A cache miss is shared work: one successful refill can serve many readers.";
      } else if (local.scope === "cluster") {
        concept = badge("WITHIN A CLUSTER");
        scene = clusterDiagram(s);
        inspector = `<h3>Key placement</h3><div class="placement-key">${s.key}</div><dl>${fact("Chosen destination", `Cache ${s.shard + 1}`)}${fact("Cached here?", s.cached ? "Yes · v1" : "Not yet")}${fact("DB reads", s.reads)}${fact("Peer-to-peer lookup", "None")}</dl>${principle("Routing is not replication", "A placement map chooses a cache server. Each shard can store different keys.")}`;
        footer = "The application owns cache selection and fallback. This diagram intentionally contains no cache-to-cache forwarding arrows.";
      } else if (local.scope === "region") {
        concept = badge("WITHIN ONE REGION");
        scene = regionDiagram(s);
        inspector = `<h3>Independent cache copies</h3>${values([{ label: "Cluster A", v: s.cacheA, stale: s.cacheA === 1 && s.db === 2 }, { label: "Cluster B", v: s.cacheB, stale: s.cacheB === 1 && s.db === 2 }])}<dl>${fact("Authoritative storage", `v${s.db}`)}${fact("Committed delete logged", s.log ? "Yes" : "Not yet")}${fact("Invalidation scope", "Both clusters")}</dl>${principle("Broadcast deletes, not values", "The storage-side pipeline invalidates relevant copies. Later demand refills them from storage.", "teal")}`;
        footer = "Asynchronous invalidations can leave stale copies while messages travel. The pipeline does not atomically update every cache.";
      } else {
        concept = badge(local.ordering === "early" ? "ORDERING COUNTEREXAMPLE" : "ACROSS REGIONS", local.ordering === "early" ? "amber" : "blue");
        scene = regionsDiagram(s);
        inspector = `<h3>Replication and freshness</h3>${values([{ label: "Replica DB", v: s.replica }, { label: "Replica cache", v: s.replicaCache, stale: s.replicaCache === 1 && s.master === 2 }])}<dl>${fact("Master database", `v${s.master}`)}${fact("Replica fetched", s.fetched === null ? "No read yet" : `v${s.fetched}`)}${fact("Later caller receives", s.returned === null ? "Waiting" : `v${s.returned}`)}</dl>${principle(local.ordering === "early" ? "A miss can refill from stale storage" : "Apply first, then invalidate", local.ordering === "early" ? "Deleting a remote cache early does not make its backing replica current." : "Let the applied replica update drive its own regional invalidation pipeline.", local.ordering === "early" ? "amber" : "teal")}`;
        footer = "Async replication remains eventually consistent. The correct ordering avoids this stale-refill schedule, not every possible stale read.";
      }
      root.querySelector("#step-title").textContent = s.title;
      root.querySelector("#step-detail").textContent = s.detail;
      root.querySelector("#concept").innerHTML = concept;
      root.querySelector("#scene").dataset.view = v;
      root.querySelector("#scene").innerHTML = scene;
      root.querySelector("#inspector").innerHTML = inspector;
      root.querySelector("#counter").textContent = `${local.index + 1} / ${steps.length}`;
      root.querySelector("[data-action=back]").disabled = local.index === 0;
      root.querySelector("[data-action=next]").disabled = local.index === steps.length - 1;
      root.querySelector("#phase-list").innerHTML = steps.map((step, index) => `<button class="phase-button ${index === local.index ? "active" : ""}" data-jump="${index}" ${index === local.index ? 'aria-current="step"' : ""}><span>${String(index + 1).padStart(2, "0")}</span>${step.phase}</button>`).join("");
      root.querySelector("#key-context").innerHTML = `<strong>${v === "scaling" && local.scope === "cluster" ? local.key : M.KEY}</strong><span>v1 = Away<br>v2 = Online</span>`;
      root.querySelector("#footer-note").textContent = footer;
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
          button:focus-visible,select:focus-visible,input:focus-visible { outline:3px solid #65b9ed; outline-offset:3px; }
          .primary { color:white; background:var(--blue); border-color:var(--blue); }
          .primary:hover:not(:disabled) { background:#116aa4; }
          .lab { border:1px solid var(--border); border-radius:12px; box-shadow:0 5px 22px #172e430a; background:white; overflow:hidden; }
          .tabs { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); background:#f5f8fb; border-bottom:1px solid var(--border); }
          .tab { display:flex; align-items:center; gap:10px; text-align:left; border:0; border-right:1px solid #e5ebf2; border-radius:0; padding:9px 14px; color:var(--muted); background:transparent; box-shadow:inset 0 -3px transparent; }
          .tab:last-child { border-right:0; }
          .tab[aria-selected=true] { color:#126798; background:white; box-shadow:inset 0 -3px var(--blue); }
          .tab-number { display:grid; place-items:center; min-width:27px; height:27px; background:#e7edf4; border-radius:7px; font-size:11px; }
          .tab[aria-selected=true] .tab-number { color:white; background:var(--blue); }
          .tab-name { display:block; font-size:13px; }
          .tab-sub { display:block; font-size:10px; font-weight:450; margin-top:2px; }
          #toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 13px; min-height:47px; border-bottom:1px solid var(--border); }
          .view-options,.step-controls { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
          .view-options { font-size:12px; color:var(--muted); min-width:0; }
          .step-controls { flex-shrink:0; }
          #counter { min-width:48px; text-align:right; color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
          select { padding:6px; max-width:230px; }
          input[type=range] { width:130px; accent-color:var(--teal); cursor:pointer; }
          output { font-weight:750; min-width:12px; color:var(--ink); }
          .toolbar-note { color:#8290a0; font-size:11px; }
          .step-copy { display:grid; grid-template-columns:116px minmax(0,1fr); gap:14px; padding:8px 15px; min-height:76px; align-items:start; }
          #concept { padding-top:3px; }
          .badge { display:inline-block; padding:4px 7px; border-radius:5px; font-size:10px; font-weight:750; letter-spacing:.035em; line-height:1.5; }
          .badge.blue { color:#126798; background:#e8f3fc; }
          .badge.teal { color:#086d6e; background:#e3f5f1; }
          .badge.amber { color:#95600a; background:#fff2d9; }
          h2 { margin:0 0 5px; font-size:17px; line-height:1.3; letter-spacing:-.02em; }
          #step-detail { margin:0; max-width:1100px; color:var(--muted); font-size:11.5px; line-height:1.45; }
          .workbench { display:grid; grid-template-columns:116px minmax(0,1fr) 230px; gap:14px; padding:0 15px 12px; align-items:start; }
          .phase-rail { min-width:0; border-top:1px solid var(--border); padding-top:10px; }
          .rail-title { margin:0 0 8px; color:#8190a1; letter-spacing:.08em; font-size:9px; font-weight:750; }
          #phase-list { display:flex; flex-direction:column; gap:3px; }
          .phase-button { display:flex; gap:8px; align-items:center; text-align:left; padding:7px 5px; border:0; font-size:11px; font-weight:500; color:var(--muted); background:transparent; }
          .phase-button > span { color:#a2afbd; font-size:10px; font-variant-numeric:tabular-nums; }
          .phase-button.active { background:#eaf5fc; color:#126798; font-weight:750; }
          .phase-button.active > span { color:#1678b8; }
          #key-context { padding-top:12px; margin-top:10px; border-top:1px solid var(--border); }
          #key-context strong { display:block; font:10px ui-monospace,SFMono-Regular,Menlo,monospace; color:#45657e; }
          #key-context > span { display:block; color:#8290a1; font-size:10px; line-height:1.6; margin-top:6px; }
          #scene { height:var(--scene-height); min-width:0; padding:8px; border:1px solid #e2e9f1; border-radius:9px; background:radial-gradient(#dce4ed 0.6px,transparent 0.6px) 0 0 / 14px 14px,#fbfcfe; display:flex; flex-direction:column; justify-content:center; gap:8px; }
          svg { display:block; width:100%; height:100%; min-height:0; flex:1; overflow:visible; font-family:inherit; }
          .svg-title { font-size:15px; font-weight:750; fill:var(--ink); }
          .svg-value { font-size:19px; font-weight:650; }
          .svg-small { font-size:12px; fill:#62778b; }
          .svg-zone { font-size:13px; font-weight:750; fill:#66788c; letter-spacing:.7px; }
          .svg-message { font-size:13px; font-weight:650; }
          .svg-client { font-size:13px; font-weight:700; fill:var(--ink); }
          .svg-client-small { font-size:10px; fill:#697c90; }
          .message { fill:none; stroke-width:2.5; }
          .message.blue { stroke:#1678b8; }
          .message.teal { stroke:#0f8587; }
          .message.amber { stroke:#b76b09; }
          .message.red { stroke:#b84049; }
          .message.muted { stroke:#a3b3c6; }
          .diagram-note { font-size:10px; color:var(--muted); text-align:center; padding:2px 0; }
          .compare-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; height:100%; min-height:0; }
          .compare-pane { background:white; border:1px solid #dce5ee; border-radius:8px; overflow:hidden; display:flex; flex-direction:column; min-width:0; min-height:0; }
          .compare-title { display:flex; justify-content:space-between; gap:6px; align-items:center; padding:9px 10px; background:#f8fafc; border-bottom:1px solid #e5ebf2; font-size:12px; }
          .compare-title .badge { font-size:8px; padding:3px 5px; letter-spacing:0; }
          .compare-pane svg { padding:3px; }
          .compare-outcome { display:flex; align-items:center; justify-content:space-between; min-height:33px; padding:8px 10px; background:#f2f5f9; color:#5b7186; font-size:11px; font-weight:650; border-top:1px solid #e3eaf2; }
          .compare-outcome.bad { background:#fff0f2; color:#ad3f48; }
          .compare-outcome.good { background:#e8f7ef; color:#18724d; }
          .compare-outcome strong { font-size:20px; }
          #inspector { background:#f6f8fb; border:1px solid var(--border); border-radius:9px; padding:10px; min-width:0; }
          h3 { margin:0 0 10px; font-size:13px; line-height:1.3; }
          .value-pair,.metric-pair { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-bottom:10px; }
          .value-card { padding:5px 7px; background:white; border:1px solid #dbe5ee; border-top:3px solid var(--teal); border-radius:6px; }
          .value-card span { display:block; color:var(--muted); font-size:9px; }
          .value-card strong { display:block; margin:2px 0 1px; font-size:20px; line-height:1.1; color:#13766c; }
          .value-card small { display:block; color:#7a8b9d; font-size:9px; }
          .value-card.stale { border-top-color:#b84049; background:#fff8f9; }
          .value-card.stale strong,.value-card.stale small { color:#a44149; }
          dl { margin:0; }
          .fact { display:flex; justify-content:space-between; align-items:baseline; gap:8px; border-bottom:1px solid #e2e8f0; padding:4px 0; font-size:10px; }
          dt { color:var(--muted); font-weight:400; }
          dd { margin:0; text-align:right; font-weight:650; font-variant-numeric:tabular-nums; }
          .principle { margin-top:9px; padding:8px; border-left:3px solid #1678b8; border-radius:6px; background:#eaf3fb; font-size:11px; }
          .principle.teal { border-color:#0f8587; background:#e7f5f1; }
          .principle.amber { border-color:#b76b09; background:#fff5e4; }
          .principle strong { display:block; margin-bottom:5px; }
          .principle p { margin:0; color:var(--muted); line-height:1.5; }
          .micro { color:#718195; font-size:10px; line-height:1.4; margin:7px 0 0; }
          .text-button { padding:0; border:0; background:transparent; color:#1678b8; font-size:11px; text-align:left; display:block; margin-top:11px; line-height:1.4; }
          .text-button:hover:not(:disabled) { text-decoration:underline; background:transparent; }
          .metric-pair > div { background:#fff6ed; border:1px solid #e5d5bf; border-radius:6px; padding:7px; }
          .metric-pair > div.good-metric { background:#ecf8f3; border-color:#c2e0d2; }
          .metric-pair span,.metric-pair small { display:block; font-size:10px; color:var(--muted); }
          .metric-pair strong { display:block; font-size:26px; line-height:1.2; margin:2px 0; color:#a76a13; }
          .metric-pair .good-metric strong { color:#18764e; }
          .placement-key { background:#e9f4fb; border:1px solid #cbdfed; padding:10px; border-radius:6px; margin-bottom:8px; font:13px ui-monospace,SFMono-Regular,Menlo,monospace; color:#126798; }
          .footer { display:flex; align-items:center; justify-content:space-between; gap:15px; padding:9px 15px; border-top:1px solid var(--border); background:#f9fbfd; }
          #footer-note { color:#6b7c8e; font-size:10px; margin:0; }
          .footer button { font-size:10px; padding:0; border:0; white-space:nowrap; background:transparent; color:#1678b8; }
          dialog { border:1px solid #ced9e5; border-radius:12px; padding:23px; width:min(630px,90vw); max-height:85dvh; color:var(--ink); box-shadow:0 20px 70px #172e4333; }
          dialog::backdrop { background:#172e4355; }
          dialog h2 { font-size:20px; }
          dialog p,dialog li { font-size:13px; line-height:1.6; color:var(--muted); }
          dialog a { color:#1678b8; }
          .dialog-top { display:flex; justify-content:space-between; gap:20px; align-items:start; margin-bottom:15px; }
          .dialog-top button { font-size:12px; }
          @media(min-width:1550px) { :host { --scene-height:490px; } }
          @media(max-width:1100px) { .tab { padding:10px; gap:7px; } .tab-sub { display:none; } .workbench { grid-template-columns:100px minmax(0,1fr) 215px; gap:10px; padding:0 10px 10px; } .step-copy { grid-template-columns:100px minmax(0,1fr); padding:10px; gap:10px; } .compare-title { flex-wrap:wrap; gap:3px; padding:7px; } .view-options { gap:6px; } .step-controls button { padding:7px 8px; } .toolbar-note { display:none; } }
          @media(max-width:900px) { :host { --scene-height:360px; } #toolbar { flex-wrap:wrap; } .step-controls { margin-left:auto; } .workbench { grid-template-columns:minmax(0,1fr) 215px; } .phase-rail { grid-column:1 / -1; border-top:0; padding:0; } .rail-title,#key-context { display:none; } #phase-list { flex-direction:row; flex-wrap:wrap; } .phase-button { font-size:10px; padding:5px; } .phase-button > span { display:none; } .step-copy { grid-template-columns:1fr; gap:5px; min-height:0; } #concept { padding:0; } .tab-number { display:none; } .tab { justify-content:center; text-align:center; } .tab-name { font-size:11px; } }
          @media(max-width:620px) { .workbench { grid-template-columns:1fr; } #inspector { display:grid; grid-template-columns:1fr 1fr; gap:8px 14px; } #inspector h3 { grid-column:1 / -1; margin-bottom:0; } #inspector .micro { margin-top:0; } .tab { padding:9px 5px; } .tab-name { font-size:11px; } #toolbar { padding:9px; } .step-controls { width:100%; } #counter { margin-left:auto; } .view-options { flex-wrap:wrap; } .footer { align-items:start; } .compare-grid { gap:6px; } .compare-title { font-size:10px; } .compare-title .badge { font-size:7px; } .compare-outcome { font-size:9px; padding:6px; } #scene[data-view=race],#scene[data-view=herd] { height:360px; } }
        </style>
        <div class="lab">
          <div class="tabs" role="tablist" aria-label="Memcached lessons">${VIEWS.map((v, index) => `<button id="tab-${v.id}" class="tab" role="tab" data-view="${v.id}" aria-controls="window" aria-selected="false" tabindex="-1"><span class="tab-number">${String(index + 1).padStart(2, "0")}</span><span><span class="tab-name">${v.name}</span><span class="tab-sub">${v.sub}</span></span></button>`).join("")}</div>
          <section id="window" role="tabpanel" aria-labelledby="tab-basics"><div id="toolbar"></div>
            <div class="step-copy"><div id="concept"></div><div aria-live="polite" aria-atomic="true"><h2 id="step-title"></h2><p id="step-detail"></p></div></div>
            <div class="workbench"><nav class="phase-rail" aria-label="Walkthrough steps"><p class="rail-title">WALKTHROUGH</p><div id="phase-list"></div><div id="key-context"></div></nav><div id="scene"></div><aside id="inspector" aria-label="Current cache state"></aside></div>
          </section>
          <div class="footer"><p id="footer-note"></p><button data-action="about" aria-haspopup="dialog">Model & sources ↗</button></div>
        </div>
        <dialog aria-labelledby="about-title"><div class="dialog-top"><h2 id="about-title">About this teaching model</h2><button data-action="close-about">Close</button></div>
          <p>The example key is a profile’s presence status: v1 = Away, v2 = Online. Tabs keep their own step positions; each scenario begins from its stated initial state. Messages advance manually, not according to measured network latency.</p>
          <ul><li>Cache basics uses an application-managed look-aside pattern. The database is authoritative. The illustrated write policy is commit, then delete.</li><li>The lease and invalidation architecture follows Facebook’s 2013 Memcache paper. Lease tokens here are not a claim about the basic Memcached get/set API.</li><li>The lease model checks key-bound tokens and revokes them on delete. One healthy miss wave is shown; failures, expiry, token-rate intervals, optional stale-value serving, and retry scheduling are omitted.</li><li>Cluster routing uses an explicit illustrative map. Regional diagrams summarize batching and routing. The cross-region example covers master-origin writes; remote markers for replica-origin writes are omitted.</li><li>Leases address the shown refill race, and regional ordering avoids one stale-refill schedule. Neither diagram promises transactional or strong consistency for the whole cache system.</li></ul>
          <p>References: <a href="https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf" target="_blank" rel="noopener">Nishtala et al., Scaling Memcache at Facebook (NSDI 2013), §§2–5</a>; <a href="https://docs.memcached.org/userguide/" target="_blank" rel="noopener">Memcached user guide</a>.</p>
        </dialog>`;
    }
  }

  if (!customElements.get("memcached-lab")) customElements.define("memcached-lab", MemcachedLab);
})();
