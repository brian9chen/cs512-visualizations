(() => {
  "use strict";

  const M = globalThis.SparkModel;
  const VIEWS = [
    { id: "lifecycle", name: "RDD lifecycle", sub: "Lazy plans, actions, caching" },
    { id: "execution", name: "Execution engine", sub: "Dependencies, shuffles, stages" },
    { id: "recovery", name: "Fault recovery", sub: "Lineage and checkpoints" },
  ];
  const colors = { blue: "#1678b8", teal: "#0f8587", amber: "#b76b09", purple: "#7754ae", red: "#b84049", muted: "#a5b3c2" };
  const escape = (value) => String(value).replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
  const badge = (text, tone = "blue") => `<span class="badge ${tone}">${escape(text)}</span>`;
  const fact = (label, value) => `<div class="fact"><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;
  const principle = (title, text, tone = "blue") => `<div class="principle ${tone}"><strong>${escape(title)}</strong><p>${escape(text)}</p></div>`;
  const svgStart = (label, height = 385, role = "img") => `<svg viewBox="0 0 900 ${height}" role="${role}" aria-label="${escape(label)}"><defs>${Object.entries(colors).map(([name, color]) => `<marker id="arrow-${name}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`).join("")}</defs>`;
  const path = (d, tone = "blue", dashed = false, moving = false) => `<path d="${d}" fill="none" stroke="${colors[tone]}" stroke-width="${tone === "muted" ? 1.5 : 2.5}" ${dashed ? 'stroke-dasharray="5 4"' : ""} class="${moving ? "shuffle-flow" : ""}" marker-end="url(#arrow-${tone})"/>`;
  const card = (x, y, width, height, label, rows, { tone = "blue", flag = "", planned = false } = {}) => `<g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="${tone === "teal" ? "#edf8f4" : tone === "purple" ? "#f3edfa" : tone === "red" ? "#fff0f2" : "#fff"}" stroke="${colors[tone]}" stroke-width="${tone === "muted" ? 1 : 1.6}" ${planned ? 'stroke-dasharray="5 4"' : ""}/>
    <text x="${x + 12}" y="${y + 21}" class="svg-title">${escape(label)}</text>
    <text x="${x + width - 10}" y="${y + 20}" class="svg-flag" text-anchor="end" fill="${colors[tone]}">${escape(flag)}</text>
    ${rows.map((row, index) => `<text x="${x + 12}" y="${y + 40 + index * 14}" class="svg-record" fill="${typeof row === "object" ? colors[row.tone] : "#526a80"}">${escape(typeof row === "object" ? row.text : row)}</text>`).join("")}
  </g>`;
  const wrapPairs = (pairs, perLine = 2) => Array.from({ length: Math.ceil(pairs.length / perLine) }, (_, i) => pairs.slice(i * perLine, i * perLine + perLine).join(" · "));

  function lifecycleDiagram(s) {
    const reuse = s.active === "reuse";
    const scan = s.computed && !reuse;
    const query = s.result.mysql !== null;
    const source = M.LIFECYCLE_LOGS.map((records, i) => `<div class="log-partition"><strong>Partition ${i}</strong>${records.map(line => `<span class="${scan && !line.startsWith("ERROR") ? "excluded" : ""}">${escape(line)}</span>`).join("")}</div>`).join("");
    const errors = M.LIFECYCLE_ERRORS.map((records, i) => `<div class="executor-slot"><div class="executor-heading"><strong>Executor ${i + 1}</strong><span>${!s.computed ? "Idle" : reuse ? "Read cached block" : s.resident ? "Cache saved" : query ? "Recompute · discard" : "Compute · discard"}</span></div><div class="error-partition ${s.computed ? s.resident ? "computed" : "transient" : "pending"}"><strong>errors · partition ${i}</strong>${s.computed ? records.map(line => `<span class="${query ? line.includes("MySQL") ? "match" : "nonmatch" : ""}">${escape(line)}</span>`).join("") : '<span class="not-computed">Not computed yet</span>'}</div></div>`).join("");
    return `<div class="rdd-lesson">
      <div class="saved-plan"><span class="zone-label">DRIVER · SAVED PLAN</span><div class="recipe"><code>logs</code><span>→</span><code>filter(ERROR)</code><span>→</span><code>errors RDD</code><span class="cache-policy ${s.marked ? "requested" : ""}">${s.marked ? s.computed ? "Keep computed errors" : "Save after computing" : s.computed ? "Not retained" : "No saved data yet"}</span></div></div>
      <div class="rdd-data-grid">
        <div class="log-column ${reuse ? "bypassed" : ""}"><div class="zone-label">LOG FILE · ${reuse ? "NOT REREAD" : s.computed ? "SOURCE DATA" : "PREVIEW ONLY"}</div>${source}</div>
        <div class="compute-gate ${scan ? "running" : reuse ? "reusing" : "waiting"}"><strong>${reuse ? "Skip the log" : s.active === "recompute" ? "Read + filter again" : scan ? "Read + filter" : "Waiting"}</strong><span class="flow-arrow" aria-hidden="true">${reuse ? "↪" : "→"}</span><span>${reuse ? "Use saved errors" : scan ? "count() runs the plan" : "Needs an action"}</span></div>
        <div class="errors-column"><div class="zone-label">WORKERS · EXECUTORS <span class="data-state">${s.resident ? "CACHED IN MEMORY" : s.computed ? "ACTION OUTPUT" : "PLAN ONLY"}</span></div>${errors}<div class="partition-note">One RDD spans these executors. Partition placement can change.</div></div>
      </div>
      <div class="rdd-outcome"><div class="work-summary"><div class="scan-counter">Log scans <strong>${s.scans}</strong></div><span>${s.scans * M.LIFECYCLE_LOGS.flat().length} log records read${query ? reuse ? " · second scan avoided" : " · log read again" : ""}</span></div><div class="action-result">${s.computed ? `<span class="results-label">${query ? "Same answers in both modes" : "Returned answer"}</span><span>First count <strong>${s.result.all}</strong></span>${query ? `<span>MySQL count <strong>${s.result.mysql}</strong></span>` : ""}` : '<strong>No action yet → no records processed</strong>'}</div></div>
    </div>`;
  }

  function executionDiagram(s) {
    const wide = s.operation === "shuffle";
    const destTones = ["blue", "teal", "purple"];
    let links = "";
    for (let parent = 0; parent < 3; parent++) {
      for (let child = 0; child < 3; child++) {
        if (!wide && parent !== child) continue;
        const y1 = 115 + parent * 97;
        const y2 = 115 + child * 97;
        links += path(`M 369 ${y1} C 427 ${y1} 479 ${y2} 531 ${y2}`, wide ? s.shuffled ? destTones[child] : "muted" : s.action ? "blue" : "muted", wide, s.phase === "Shuffle");
      }
    }
    const children = [0, 1, 2].map((i) => {
      let rows;
      if (wide) {
        rows = !s.shuffled ? ["Await shuffle buckets"] : !s.transformed
          ? M.BUCKETS[i].map(({ word, values }) => `${word} ← [${values.join("+")}]`)
          : M.COUNTS[i].map(({ word, count }) => ({ text: `${word}: ${count}${count >= 2 ? "  keep ✓" : "  drop"}`, tone: count >= 2 ? "teal" : "muted" }));
      } else rows = !s.transformed ? ["Not computed yet"] : wrapPairs(s.filtered ? M.NARROW[i] : M.WORDS[i], 3);
      return card(534, 75 + i * 97, 331, 85, `C${i}`, rows, { tone: wide ? destTones[i] : "blue", flag: wide && s.transformed ? `${M.FREQUENT[i].length} KEPT` : !wide && s.filtered ? `${M.NARROW[i].length} KEPT` : "", planned: !s.action });
    }).join("");
    return `${svgStart(wide ? "Two stages separated by a key shuffle" : "Three partition-local pipelines inside a single stage")}
      <rect x="17" y="49" width="${wide ? 366 : 866}" height="313" rx="10" fill="#edf4fc" stroke="#d6e3ef"/>
      ${wide ? '<rect x="517" y="49" width="366" height="313" rx="10" fill="#edf8f3" stroke="#d4e8dc"/><path d="M 452 51 V 362" stroke="#d5a548" stroke-width="1.5" stroke-dasharray="5 5"/>' : ""}
      <text x="32" y="26" class="svg-title">${wide ? "STAGE 1 · tokenize, map, combine" : "ONE STAGE · tokenize → map → filter"}</text>
      ${wide ? '<text x="533" y="26" class="svg-title">STAGE 2 · fetch, sum, filter</text>' : ""}
      <rect x="399" y="48" width="106" height="20" rx="4" fill="${wide ? "#fff3da" : "#e3edf7"}"/><text x="452" y="62" text-anchor="middle" class="svg-flag" fill="${wide ? colors.amber : colors.blue}">${wide ? "SHUFFLE" : "NO SHUFFLE"}</text>
      ${links}
      ${[0, 1, 2].map((i) => card(35, 75 + i * 97, 331, 85, `P${i}`, wide && s.combined ? wrapPairs(Object.entries(M.COMBINED[i]).map(([word, count]) => `${word}:${count}`)) : M.WORD_LINES[i], { tone: "blue", flag: wide && s.combined ? "LOCAL PARTIALS" : "INPUT", planned: !s.action })).join("")}
      ${children}
      <text x="450" y="379" text-anchor="middle" class="svg-small">${wide ? "Key colors show destination buckets. Equal keys meet before the reduce-side filter." : "Each task streams through several operators. No intermediate file is required between them."}</text>
    </svg>`;
  }

  function recoveryDiagram(s) {
    const x = [20, 240, 460, 680];
    const inProgress = s.lost && !s.restored;
    const headings = ["L · STABLE LOG", "E · ERROR FILTER", "M · SERVICE MAP", "C · CACHED RESULT"];
    return `${svgStart("Lineage L to E to M to C with clickable cached C partitions and an optional reliable checkpoint", 385, "group")}
      ${x.map((left, i) => `<text x="${left}" y="27" class="svg-title">${headings[i]}</text><text x="${left}" y="48" class="svg-small">${["Durable HDFS source", s.checkpoint ? "Reliable checkpoint saved" : "Not retained in memory", "Not retained in memory", "Click a block to drop it"][i]}</text>`).join("")}
      ${[0, 1, 2].map((part) => {
        const top = 81 + part * 94;
        const needed = s.traced && s.target === part;
        const cachedRows = s.target === part && s.lost ? [s.rebuilding ? "Recomputing..." : "Missing cache block"] : [M.FINAL[part].join(", ")];
        const label = s.target === part && s.restored ? "RESTORED" : s.target === part && s.lost ? "LOST" : "CACHED";
        const tone = s.target === part && s.lost ? "red" : "teal";
        const worker = s.target === part && s.restored ? s.worker + 1 : part + 1;
        return `${s.checkpoint ? `<path d="M 203 ${top + 30} H 232" stroke="#dbe2eb" stroke-dasharray="2 6"/><text x="218" y="${top + 26}" text-anchor="middle" class="svg-small" fill="#b2bcc8">×</text>` : path(`M 203 ${top + 32} H 235`, needed ? "amber" : "muted")}
          ${path(`M 423 ${top + 32} H 455`, needed ? s.checkpoint ? "purple" : "amber" : "muted")}${path(`M 643 ${top + 32} H 675`, needed ? "amber" : "muted")}
          ${card(20, top, 180, 68, `L${part}`, [`${M.LOGS[part].length} log records`], { tone: needed && !s.checkpoint ? "amber" : "muted" })}
          ${card(240, top, 180, 68, `E${part}`, [`${M.ERRORS[part].length} ERROR records`], { tone: s.checkpoint ? "purple" : needed ? "amber" : "muted", flag: s.checkpoint ? "HDFS" : "RECIPE" })}
          ${card(460, top, 180, 68, `M${part}`, [needed && (s.rebuilding || s.restored) ? M.SERVICES[part].join(", ") : "map(service)"], { tone: needed ? "amber" : "muted", flag: "RECIPE" })}
          <g role="button" tabindex="${inProgress ? -1 : 0}" data-partition="${part}" aria-label="Drop cached partition C${part}" aria-disabled="${inProgress}" class="cache-target">${card(680, top, 180, 68, `C${part}`, cachedRows, { tone, flag: label, planned: s.target === part && s.lost })}<text x="768" y="${top + 84}" text-anchor="middle" class="svg-small">${s.target === part && s.rebuilding ? `Rebuild on Worker ${s.worker + 1}` : `Worker ${worker}`}</text></g>`;
      }).join("")}
      <text x="450" y="379" text-anchor="middle" class="svg-small">${s.checkpoint ? "Completed checkpoint: recovery starts at E. Earlier lineage is cut, not merely cached." : "Only the highlighted narrow ancestry is needed. Other cached C partitions survive."}</text>
    </svg>`;
  }

  class SparkRDDLab extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.view = "lifecycle";
      this.state = {
        lifecycle: { index: 0, caching: true },
        execution: { index: 0, operation: "shuffle" },
        recovery: { index: 0, target: null, requested: 1, checkpoint: false },
      };
    }

    connectedCallback() {
      this.renderShell();
      this.shadowRoot.addEventListener("click", (event) => this.onClick(event));
      this.shadowRoot.addEventListener("change", (event) => this.onChange(event));
      this.shadowRoot.addEventListener("keydown", (event) => {
        const partition = event.target.closest("[data-partition]");
        if (partition && ["Enter", " "].includes(event.key)) {
          event.preventDefault();
          return this.dropPartition(Number(partition.dataset.partition));
        }
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
      this.setView("lifecycle");
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

    dropPartition(target) {
      const local = this.state.recovery;
      if (local.target !== null && local.index > 0 && local.index < 5) return;
      local.target = target;
      local.requested = target;
      local.index = 1;
      this.renderState();
    }

    onClick(event) {
      const partition = event.target.closest("[data-partition]");
      if (partition) return this.dropPartition(Number(partition.dataset.partition));
      const button = event.target.closest("button");
      if (!button || button.disabled) return;
      if (button.dataset.view || button.dataset.go) return this.setView(button.dataset.view ?? button.dataset.go);
      const action = button.dataset.action;
      if (action === "about") return this.shadowRoot.querySelector("dialog").showModal();
      if (action === "close-about") return this.shadowRoot.querySelector("dialog").close();
      if (action === "drop") return this.dropPartition(this.state.recovery.requested);
      const local = this.state[this.view];
      if (button.dataset.jump !== undefined) local.index = Number(button.dataset.jump);
      if (action === "back") local.index -= 1;
      if (action === "next") local.index += 1;
      if (action === "reset") {
        local.index = 0;
        if (this.view === "recovery") local.target = null;
      }
      this.renderState();
    }

    onChange(event) {
      const input = event.target;
      if (input.id === "caching") this.state.lifecycle.caching = input.checked;
      else if (input.id === "operation") this.state.execution.operation = input.value;
      else if (input.id === "checkpoint") { this.state.recovery.checkpoint = input.checked; this.state.recovery.target = null; }
      else if (input.id === "loss-partition") { this.state.recovery.requested = Number(input.value); return; }
      else return;
      if (input.id !== "caching") this.state[this.view].index = 0;
      this.renderToolbar();
      this.renderState();
    }

    renderToolbar() {
      const local = this.state[this.view];
      let options;
      if (this.view === "lifecycle") options = `<label class="toggle" for="caching"><input id="caching" type="checkbox" ${local.caching ? "checked" : ""}>Use persist() to cache errors</label><span class="toolbar-note">Toggle to compare the same step</span>`;
      if (this.view === "execution") options = `<label for="operation">Operation</label><select id="operation"><option value="narrow">Narrow: map / filter</option><option value="shuffle">Wide: reduceByKey</option></select><span class="toolbar-note">Three input partitions · one action</span>`;
      if (this.view === "recovery") options = `<label class="toggle" for="checkpoint"><input id="checkpoint" type="checkbox" ${local.checkpoint ? "checked" : ""}>Completed checkpoint at E</label><label for="loss-partition" class="sr-only">Partition to drop</label><select id="loss-partition">${[0, 1, 2].map((i) => `<option value="${i}">C${i}</option>`).join("")}</select><button data-action="drop" class="loss-button">Drop partition</button>`;
      this.shadowRoot.querySelector("#toolbar").innerHTML = `<div class="view-options">${options}</div><div class="step-controls" role="group" aria-label="Step controls"><button data-action="back">← Back</button><button data-action="next" class="primary">Next →</button><button data-action="reset">Reset</button><span id="counter"></span></div>`;
      if (this.view === "execution") this.shadowRoot.querySelector("#operation").value = local.operation;
      if (this.view === "recovery") this.shadowRoot.querySelector("#loss-partition").value = local.requested;
    }

    renderState() {
      const root = this.shadowRoot;
      const local = this.state[this.view];
      const steps = this.view === "lifecycle" ? M.lifecycleSteps(local.caching) : this.view === "execution" ? M.executionSteps(local.operation) : M.recoverySteps(local);
      local.index = Math.max(0, Math.min(local.index, steps.length - 1));
      const s = steps[local.index];
      let scene, inspector, concept, note;
      if (this.view === "lifecycle") {
        scene = lifecycleDiagram(s);
        concept = badge(s.computed ? s.active === "reuse" ? "REUSE DATA" : "RUN THE PLAN" : "NO WORK YET", s.active === "reuse" ? "teal" : "blue");
        inspector = "";
        note = "Two partitions, six log records, four errors. Source records are a teaching preview. Actions run work; persist() requests retention after computation.";
      } else if (this.view === "execution") {
        scene = executionDiagram(s);
        concept = badge(s.operation === "shuffle" ? "WIDE DEPENDENCY" : "NARROW PIPELINE", s.operation === "shuffle" ? "amber" : "blue");
        inspector = `<h3>Execution plan</h3><div class="metric-pair"><div><span>Stages in plan</span><strong>${s.stages}</strong><small>${s.action ? "action requested" : "not running yet"}</small></div><div class="good-metric"><span>Shuffle records</span><strong>${s.shuffleRecords}</strong><small>partial records</small></div></div><dl>${fact("Tasks scheduled", s.tasks)}${fact("Action result", s.result === null ? "Not returned yet" : s.result)}${fact("Shuffle dependency", s.operation === "shuffle" ? "Key redistribution" : "None")}</dl>${principle("Stage boundaries are not RDD boundaries", "Narrow operators can stream together in a task. A required shuffle separates stages.", s.operation === "shuffle" ? "amber" : "blue")}<p class="micro">${s.operation === "shuffle" ? "Word-count threshold: ≥ 2 for the toy data. Shuffle partials are combined locally first." : "Each parent partition feeds at most one child. No redistribution is required here."}</p>`;
        note = s.operation === "shuffle" ? "Arrow colors group keys by destination. Shuffles may use disk and network; this is a logical schedule, not a timing benchmark." : "Narrow pipelines keep each partition path local to one task. CPU work and input reads still occur.";
      } else {
        scene = recoveryDiagram(s);
        concept = badge(s.checkpoint ? "RELIABLE CHECKPOINT" : "LINEAGE RECOVERY", s.checkpoint ? "purple" : "blue");
        inspector = `<h3>${s.target === null ? "Choose a cached block" : `Recover partition C${s.target}`}</h3><div class="metric-pair"><div><span>Durable reads</span><strong>${s.reads}</strong><small>one partition</small></div><div class="good-metric"><span>Recovery tasks</span><strong>${s.recoveryTasks}</strong><small>narrow pipeline</small></div></div><dl>${fact("Recovery source", s.target === null ? "Choose C0, C1, C2" : `${s.checkpoint ? "Checkpoint E" : "Input L"}${s.target}`)}${fact("Records reread", s.recordsRead)}${fact("Operators rerun", s.transforms)}${fact("Replacement worker", s.target === null ? "Not assigned" : `Worker ${s.worker + 1}`)}</dl>${principle(s.checkpoint ? "Saved data bounds ancestry" : "A recipe needs surviving inputs", s.checkpoint ? "E is already saved to reliable storage. Recovery skips the earlier ERROR filter." : "Replay only this narrow dependency path. Keep surviving cached partitions.", s.checkpoint ? "purple" : "blue")}<p class="micro">One cached block is lost per experiment.</p>`;
        note = "RDD contents stay immutable. Only the cache location changes; deterministic functions rebuild the same records.";
        root.querySelector("[data-action=drop]").disabled = s.lost && !s.restored;
        root.querySelector("#loss-partition").value = local.requested;
      }
      root.querySelector("#window").classList.toggle("lifecycle-view", this.view === "lifecycle");
      root.querySelector("#inspector").hidden = this.view === "lifecycle";
      root.querySelector("#step-title").textContent = s.title;
      root.querySelector("#step-detail").textContent = s.detail;
      root.querySelector("#concept").innerHTML = concept;
      root.querySelector("#scene").innerHTML = scene;
      root.querySelector("#inspector").innerHTML = inspector;
      root.querySelector("#counter").textContent = `${local.index + 1} / ${steps.length}`;
      root.querySelector("[data-action=back]").disabled = local.index === 0;
      root.querySelector("[data-action=next]").disabled = local.index === steps.length - 1;
      root.querySelector("#phase-list").innerHTML = steps.map((step, index) => `<button data-jump="${index}" class="phase-button ${local.index === index ? "active" : ""}" ${local.index === index ? 'aria-current="step"' : ""}><span>${String(index + 1).padStart(2, "0")}</span>${escape(step.phase)}</button>`).join("");
      root.querySelector("#driver-code").textContent = s.code;
      root.querySelector("#concept-note").textContent = note;
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
          button:focus-visible,select:focus-visible,input:focus-visible,.cache-target:focus-visible { outline:3px solid #65b9ed; outline-offset:3px; }
          .primary { color:white; background:var(--blue); border-color:var(--blue); }
          .primary:hover:not(:disabled) { background:#116aa4; }
          .lab { border:1px solid var(--border); border-radius:12px; box-shadow:0 5px 22px #172e430a; background:white; overflow:hidden; }
          .tabs { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); background:#f5f8fb; border-bottom:1px solid var(--border); }
          .tab { display:flex; align-items:center; gap:10px; text-align:left; border:0; border-right:1px solid #e5ebf2; border-radius:0; padding:9px 14px; color:var(--muted); background:transparent; box-shadow:inset 0 -3px transparent; }
          .tab:last-child { border-right:0; }
          .tab[aria-selected=true] { color:#126798; background:white; box-shadow:inset 0 -3px var(--blue); }
          .tab-number { display:grid; place-items:center; min-width:27px; height:27px; background:#e7edf4; border-radius:7px; font-size:11px; }
          .tab[aria-selected=true] .tab-number { color:white; background:var(--blue); }
          .tab-name { display:block; font-size:13px; }
          .tab-sub { display:block; font-size:10px; font-weight:450; margin-top:2px; }
          #toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 13px; min-height:47px; border-bottom:1px solid var(--border); }
          .view-options,.step-controls { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
          .view-options { font-size:12px; color:var(--muted); min-width:0; }
          .step-controls { flex-shrink:0; }
          #counter { min-width:48px; text-align:right; color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
          select { padding:6px; max-width:230px; }
          input { accent-color:var(--teal); }
          .toggle { display:flex; align-items:center; gap:6px; cursor:pointer; }
          .toolbar-note { color:#8290a0; font-size:11px; }
          .loss-button { color:#a8414a; border-color:#d5b5b9; background:#fff9fa; font-size:12px; }
          .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; }
          .step-copy { display:grid; grid-template-columns:116px minmax(0,1fr); gap:14px; padding:8px 15px; min-height:76px; align-items:start; }
          #concept { padding-top:3px; }
          .badge { display:inline-block; padding:4px 7px; border-radius:5px; font-size:10px; font-weight:750; letter-spacing:.035em; line-height:1.5; }
          .badge.blue { color:#126798; background:#e8f3fc; }
          .badge.teal { color:#086d6e; background:#e3f5f1; }
          .badge.amber { color:#95600a; background:#fff2d9; }
          .badge.purple { color:#6b459e; background:#f0eafa; }
          h2 { margin:0 0 5px; font-size:17px; line-height:1.3; letter-spacing:-.02em; }
          #step-detail { margin:0; max-width:1100px; color:var(--muted); font-size:11.5px; line-height:1.45; }
          .workbench { display:grid; grid-template-columns:116px minmax(0,1fr) 230px; gap:14px; padding:0 15px 12px; align-items:start; }
          .phase-rail { min-width:0; border-top:1px solid var(--border); padding-top:10px; }
          .rail-title { margin:0 0 8px; color:#8190a1; letter-spacing:.08em; font-size:9px; font-weight:750; }
          #phase-list { display:flex; flex-direction:column; gap:2px; }
          .phase-button { display:flex; gap:8px; align-items:center; text-align:left; padding:6px 5px; border:0; font-size:11px; font-weight:500; color:var(--muted); background:transparent; }
          .phase-button > span { color:#a2afbd; font-size:10px; font-variant-numeric:tabular-nums; }
          .phase-button.active { background:#eaf5fc; color:#126798; font-weight:750; }
          .phase-button.active > span { color:#1678b8; }
          #scene { height:var(--scene-height); min-width:0; padding:8px; border:1px solid #e2e9f1; border-radius:9px; background:radial-gradient(#dce4ed 0.6px,transparent 0.6px) 0 0 / 14px 14px,#fbfcfe; display:flex; flex-direction:column; justify-content:center; }
          svg { display:block; width:100%; height:100%; min-height:0; overflow:visible; font-family:inherit; }
          .svg-title { font-size:14px; font-weight:750; fill:var(--ink); }
          .svg-flag { font-size:9px; font-weight:750; letter-spacing:.2px; }
          .svg-record { font-size:12px; }
          .svg-small { font-size:11.5px; }
          .svg-worker { font-size:10px; font-weight:750; fill:#6c7f93; letter-spacing:.5px; }
          .svg-driver { font-size:12px; font-weight:750; letter-spacing:.4px; }
          .cache-target[aria-disabled=false] { cursor:pointer; }
          .cache-target[aria-disabled=false]:hover rect { stroke-width:3; }
          .shuffle-flow { stroke-dasharray:6 5; animation:shuffle .7s linear 2; }
          @keyframes shuffle { to { stroke-dashoffset:-22; } }
          #inspector { background:#f6f8fb; border:1px solid var(--border); border-radius:9px; padding:10px; min-width:0; }
          h3 { margin:0 0 7px; font-size:13px; line-height:1.3; }
          .metric-pair { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-bottom:9px; }
          .metric-pair > div { background:#edf4fc; border:1px solid #c8dcec; border-radius:6px; padding:7px; }
          .metric-pair > div.good-metric { background:#ecf8f3; border-color:#c2e0d2; }
          .metric-pair span,.metric-pair small { display:block; font-size:9px; color:var(--muted); }
          .metric-pair strong { display:block; font-size:25px; line-height:1.2; margin:2px 0; color:#1678b8; }
          .metric-pair .good-metric strong { color:#18764e; }
          dl { margin:0; }
          .fact { display:flex; justify-content:space-between; align-items:baseline; gap:8px; border-bottom:1px solid #e2e8f0; padding:4px 0; font-size:10px; }
          dt { color:var(--muted); font-weight:400; }
          dd { margin:0; text-align:right; font-weight:650; font-variant-numeric:tabular-nums; }
          .principle { margin-top:9px; padding:8px; border-left:3px solid #1678b8; border-radius:6px; background:#eaf3fb; font-size:11px; }
          .principle.teal { border-color:#0f8587; background:#e7f5f1; }
          .principle.amber { border-color:#b76b09; background:#fff5e4; }
          .principle.purple { border-color:#7754ae; background:#f0eafa; }
          .principle strong { display:block; margin-bottom:3px; }
          .principle p { margin:0; color:var(--muted); line-height:1.5; }
          .micro { color:#718195; font-size:10px; line-height:1.4; margin:7px 0 0; }
          .footer { display:flex; align-items:center; justify-content:space-between; gap:15px; padding:9px 15px; border-top:1px solid var(--border); background:#f9fbfd; }
          .code-area { display:flex; align-items:baseline; gap:11px; min-width:0; }
          .code-area > span { color:#8b9bab; font-size:9px; font-weight:750; white-space:nowrap; }
          #driver-code { color:#355d7a; font:10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; }
          .footer button { font-size:10px; padding:0; border:0; white-space:nowrap; background:transparent; color:#1678b8; }
          dialog { border:1px solid #ced9e5; border-radius:12px; padding:23px; width:min(650px,90vw); max-height:85dvh; color:var(--ink); box-shadow:0 20px 70px #172e4333; }
          dialog::backdrop { background:#172e4355; }
          dialog h2 { font-size:20px; }
          dialog p,dialog li { font-size:13px; line-height:1.6; color:var(--muted); }
          dialog a { color:#1678b8; }
          .dialog-top { display:flex; justify-content:space-between; gap:20px; align-items:start; margin-bottom:15px; }
          .dialog-top button { font-size:12px; }
          #concept-note { padding:9px 11px; border-left:3px solid #1678b8; background:#edf5fc; font-size:12px; }
          @media(min-width:1550px) { :host { --scene-height:490px; } }
          @media(max-width:1100px) { .tab { padding:10px; gap:7px; } .tab-sub { display:none; } .workbench { grid-template-columns:100px minmax(0,1fr) 215px; gap:10px; padding:0 10px 10px; } .step-copy { grid-template-columns:100px minmax(0,1fr); padding:10px; gap:10px; } .view-options { gap:6px; } .step-controls button { padding:7px 8px; } .toolbar-note { display:none; } }
          @media(max-width:900px) { :host { --scene-height:360px; } #toolbar { flex-wrap:wrap; } .step-controls { margin-left:auto; } .workbench { grid-template-columns:minmax(0,1fr) 215px; } .phase-rail { grid-column:1 / -1; border-top:0; padding:0; } .rail-title { display:none; } #phase-list { flex-direction:row; flex-wrap:wrap; } .phase-button { font-size:10px; padding:5px; } .phase-button > span { display:none; } .step-copy { grid-template-columns:1fr; gap:5px; min-height:0; } #concept { padding:0; } .tab-number { display:none; } .tab { justify-content:center; text-align:center; } .tab-name { font-size:11px; } }
          @media(max-width:620px) { .workbench { grid-template-columns:1fr; } #inspector { display:grid; grid-template-columns:1fr 1fr; gap:8px 14px; } #inspector h3 { grid-column:1 / -1; margin-bottom:0; } #inspector .micro { margin-top:0; } .tab { padding:9px 5px; } .tab-name { font-size:11px; } #toolbar { padding:9px; } .step-controls { width:100%; } #counter { margin-left:auto; } .view-options { flex-wrap:wrap; } .footer { align-items:start; } .code-area { display:block; } .code-area > span { display:block; margin-bottom:4px; } }
          .lifecycle-view .workbench { grid-template-columns:116px minmax(0,1fr); }
          .lifecycle-view #scene { padding:10px 18px; background:#fbfcfe; }
          .rdd-lesson { width:100%; display:flex; flex-direction:column; gap:10px; }
          .zone-label { font-size:10px; font-weight:750; letter-spacing:.04em; color:#667c91; }
          .saved-plan { display:flex; align-items:center; gap:18px; border:1px solid #cbdceb; border-radius:8px; padding:8px 13px; background:#edf5fc; }
          .recipe { flex:1; display:flex; align-items:center; gap:16px; margin-top:0; color:#718ca4; }
          .recipe code { color:#235b82; font:650 14px ui-monospace,SFMono-Regular,Menlo,monospace; }
          .cache-policy { font-size:11px; margin-left:auto; color:#6c7c8b; }
          .cache-policy.requested { color:#96610d; background:#fff0cd; border-radius:4px; padding:3px 7px; }
          .rdd-data-grid { display:grid; grid-template-columns:minmax(0,1fr) 150px minmax(0,1.15fr); gap:18px; align-items:start; }
          .log-partition,.error-partition { padding:7px 11px; margin-top:7px; border:1px solid #ccd8e5; border-radius:7px; background:white; min-height:72px; }
          .log-partition strong,.error-partition strong { display:block; font-size:10px; margin-bottom:3px; color:#6c8093; }
          .log-partition span,.error-partition span { display:block; font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; color:#38556e; }
          .log-partition .excluded { text-decoration:line-through; color:#a2adb8; }
          .executor-slot { margin-top:7px; padding:5px 8px 6px; border:1px solid #c4d2df; border-radius:8px; background:#eef2f7; }
          .executor-heading { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:10px; color:#516c84; }
          .executor-heading > span { font-size:9px; font-weight:650; }
          .executor-slot .error-partition { margin-top:3px; min-height:53px; padding:3px 8px; }
          .executor-slot .error-partition strong { margin-bottom:1px; line-height:1.2; }
          .error-partition.transient { border-style:dashed; border-color:#7ca9c9; background:white; }
          .error-partition.pending { border-style:dashed; background:#f6f8fb; }
          .error-partition.computed { border-color:#76b7a4; background:#eff9f5; }
          .error-partition .not-computed { font:13px/1.7 system-ui,sans-serif; color:#8b99a7; }
          .error-partition .match { color:#087352; font-weight:750; }
          .error-partition .nonmatch { color:#93a6b2; }
          .data-state { float:right; font-size:9px; color:#0b7b64; }
          .partition-note { font-size:10px; margin-top:5px; color:#718397; }
          .compute-gate { align-self:center; text-align:center; color:#93a2af; display:flex; flex-direction:column; align-items:center; font-size:11px; gap:2px; padding-bottom:10px; }
          .compute-gate strong { font-size:13px; }
          .compute-gate.running { color:#1678b8; }
          .compute-gate.reusing { color:#0f8587; }
          .flow-arrow { font-size:39px; line-height:1.1; }
          .bypassed { opacity:.43; }
          .rdd-outcome { display:flex; align-items:center; justify-content:space-between; border-top:1px solid #dde5ee; padding-top:9px; gap:12px; min-height:40px; }
          .action-result { display:flex; align-items:center; gap:18px; color:#527087; font-size:12px; }
          .action-result > strong { color:#527087; font-size:13px; }
          .action-result span strong { font-size:17px; color:#1678b8; margin-left:7px; }
          .results-label { font-size:10px; color:#6f8497; }
          .work-summary { display:flex; align-items:center; gap:15px; }
          .work-summary > span { font-size:11px; color:#456880; }
          .work-summary .scan-counter { color:#244b68; }
          .work-summary .scan-counter strong { background:#e3eff9; border-radius:6px; padding:0 9px; }
          .scan-counter { display:flex; align-items:center; gap:12px; font-size:12px; color:#587188; white-space:nowrap; }
          .scan-counter strong { font-size:25px; color:#1678b8; }
          @media(max-width:1100px) { .saved-plan { display:block; } .saved-plan .recipe { margin-top:4px; } .lifecycle-view .workbench { grid-template-columns:100px minmax(0,1fr); } .rdd-data-grid { grid-template-columns:minmax(0,1fr) 105px minmax(0,1.15fr); gap:10px; } .recipe { gap:10px; } .recipe code { font-size:12px; } .cache-policy { font-size:10px; } .data-state { float:none; display:block; } }
          @media(max-width:900px) { .lifecycle-view .workbench { grid-template-columns:1fr; } }
          @media(max-width:620px) { .lifecycle-view #scene { height:auto; padding:12px; } .rdd-data-grid { grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:10px; } .compute-gate { grid-column:1 / -1; grid-row:1; flex-direction:row; justify-content:center; padding:0; } .flow-arrow { font-size:23px; } .recipe { flex-wrap:wrap; } .cache-policy { margin-left:0; } .action-result { gap:10px; } .results-label { display:none; } .rdd-outcome { align-items:start; flex-wrap:wrap; } .executor-heading { flex-wrap:wrap; gap:2px; } .work-summary { gap:8px; } .log-partition span,.error-partition span { font-size:9px; overflow-wrap:anywhere; } }
          @media(prefers-reduced-motion:reduce) { * { animation:none !important; transition:none !important; } }
        </style>
        <div class="lab"><div class="tabs" role="tablist" aria-label="Spark lessons">${VIEWS.map((view, index) => `<button id="tab-${view.id}" class="tab" role="tab" data-view="${view.id}" aria-controls="window" aria-selected="false" tabindex="-1"><span class="tab-number">${String(index + 1).padStart(2, "0")}</span><span><span class="tab-name">${view.name}</span><span class="tab-sub">${view.sub}</span></span></button>`).join("")}</div>
          <section id="window" role="tabpanel" aria-labelledby="tab-lifecycle"><div id="toolbar"></div><div class="step-copy"><div id="concept"></div><div aria-live="polite" aria-atomic="true"><h2 id="step-title"></h2><p id="step-detail"></p></div></div><div class="workbench"><nav class="phase-rail" aria-label="Walkthrough steps"><p class="rail-title">WALKTHROUGH</p><div id="phase-list"></div></nav><div id="scene"></div><aside id="inspector" aria-label="Current Spark state"></aside></div></section>
          <div class="footer"><div class="code-area"><span>DRIVER CODE</span><code id="driver-code"></code></div><button data-action="about" aria-haspopup="dialog">Model & sources ↗</button></div>
        </div>
        <dialog aria-labelledby="about-title"><div class="dialog-top"><h2 id="about-title">About this teaching model</h2><button data-action="close-about">Close</button></div><p id="concept-note"></p>
          <p>Adapted from Lecture 13: Spark, especially slides 8–11, 17–23, with a smaller synthetic log and word dataset. Scala-style snippets mirror the lecture; the browser computes the illustrated examples in JavaScript rather than running Spark.</p>
          <ul><li>An RDD is a partitioned dataset description and lineage. Data previews are illustrative. Input metadata access is omitted; dataset-processing counters begin with actions.</li><li>The cache policy is memory-only, one copy per errors partition, with enough capacity and no eviction. Real Spark can retain different storage levels, evict blocks, and rebuild missing ones. Cached actions still execute tasks. The lifecycle view assigns one partition to each of two executors for illustration; an RDD can have many partitions per executor, and placement can change.</li><li>Stages are logical RDD shuffle stages for this example. Tasks within a stage are pipelined; returning scalar count results to the driver is not another key shuffle. Word count uses threshold 2 instead of the lecture’s 10.</li><li>The word-count key-to-bucket map is illustrative.</li><li>Recovery drops one cached C block, not an executor or driver. L stays available in HDFS. E and M are not cached; enabling the checkpoint assumes E has already been reliably checkpointed and its earlier lineage cut. A checkpoint call alone does not save records eagerly.</li></ul>
          <p>References: <a href="https://www.usenix.org/system/files/conference/nsdi12/nsdi12-final138.pdf" target="_blank" rel="noopener">Zaharia et al., Resilient Distributed Datasets (NSDI 2012)</a>; <a href="https://spark.apache.org/docs/3.5.6/rdd-programming-guide.html" target="_blank" rel="noopener">Apache Spark RDD programming guide</a>; <a href="https://spark.apache.org/docs/3.5.6/api/python/reference/api/pyspark.RDD.checkpoint.html" target="_blank" rel="noopener">Reliable checkpoint semantics</a>.</p>
        </dialog>`;
    }
  }

  if (!customElements.get("spark-rdd-lab")) customElements.define("spark-rdd-lab", SparkRDDLab);
})();
