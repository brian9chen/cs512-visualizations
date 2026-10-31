(() => {
  "use strict";

  const LOGS = Object.freeze([
    Object.freeze(["INFO ready", "ERROR MySQL timeout", "ERROR HDFS read"]),
    Object.freeze(["ERROR MySQL refused", "WARN retry", "ERROR scheduler busy"]),
    Object.freeze(["INFO heartbeat", "ERROR HDFS missing", "ERROR MySQL retry"]),
  ]);
  const ERRORS = Object.freeze(LOGS.map((partition) => Object.freeze(partition.filter((line) => line.startsWith("ERROR")))));
  const SERVICES = Object.freeze(ERRORS.map((partition) => Object.freeze(partition.map((line) => line.split(" ")[1]))));
  const FINAL = Object.freeze(SERVICES.map((partition) => Object.freeze(partition.filter((service) => service !== "scheduler"))));
  const WORD_LINES = Object.freeze([
    Object.freeze(["spark reads logs", "spark caches logs"]),
    Object.freeze(["workers read logs", "workers cache rdds"]),
    Object.freeze(["spark schedules tasks", "workers rebuild rdds"]),
  ]);
  const WORD_PARTITION = Object.freeze({ spark: 0, rdds: 0, schedules: 0, logs: 1, caches: 1, cache: 1, rebuild: 1, workers: 2, reads: 2, read: 2, tasks: 2 });
  const WORDS = Object.freeze(WORD_LINES.map((partition) => Object.freeze(partition.flatMap((line) => line.split(" ")))));
  const NARROW = Object.freeze(WORDS.map((partition) => Object.freeze(partition.map((word) => word.toLowerCase()).filter((word) => word.length >= 5))));
  const COMBINED = Object.freeze(WORDS.map((partition) => Object.freeze(Object.fromEntries([...new Set(partition)].map((word) => [word, partition.filter((item) => item === word).length])))));
  const BUCKETS = Object.freeze([0, 1, 2].map((bucket) => Object.freeze(Object.keys(WORD_PARTITION).filter((word) => WORD_PARTITION[word] === bucket).map((word) => Object.freeze({ word, values: Object.freeze(COMBINED.filter((part) => part[word]).map((part) => part[word])) })))));
  const COUNTS = Object.freeze(BUCKETS.map((bucket) => Object.freeze(bucket.map(({ word, values }) => Object.freeze({ word, count: values.reduce((a, b) => a + b, 0) })))));
  const FREQUENT = Object.freeze(COUNTS.map((partition) => Object.freeze(partition.filter(({ count }) => count >= 2))));

  function sequence(initial) {
    let state = { ...initial };
    const steps = [];
    return {
      steps,
      add(phase, title, detail, code, patch = {}) {
        state = { ...state, phase, title, detail, code, ...patch };
        steps.push(structuredClone(state));
      },
    };
  }

  const LIFECYCLE_LOGS = Object.freeze(LOGS.slice(0, 2));
  const LIFECYCLE_ERRORS = Object.freeze(ERRORS.slice(0, 2));

  function lifecycleSteps(caching = true) {
    const q = sequence({ caching, marked: false, computed: false, resident: false, scans: 0, filterRecords: 0, active: "plan", result: { all: null, mysql: null } });
    const add = q.add.bind(q);
    add("Define RDD", "filter() saves a plan. It does not read the log.", "An RDD is a dataset split into partitions. Spark knows how to build the two errors partitions, but has not computed their records yet.", 'val errors = logs.filter(_.startsWith("ERROR"))');
    add(caching ? "Mark to cache" : "Skip caching", caching ? "persist() still does not run the filter" : "Without persist(), results will not be kept for reuse",
      caching ? "It asks Spark to keep the errors partitions after an action computes them. The log has still been scanned zero times."
        : "The plan is still available. Each count will have to read the log and build the errors partitions again.", caching ? "errors.persist()" : "// no persist()", { marked: caching });
    add("Count errors", "count() triggers the work: read → filter → count", caching ? "Workers read six log records and keep the four errors. count() returns 4. Because persist() was requested, those error records stay in memory."
      : "Workers read six log records and find four errors. count() returns 4. These records are shown as this action’s output; they are not saved in memory.", "errors.count() // 4", { computed: true, resident: caching, scans: 1, filterRecords: 6, active: "compute", result: { all: 4, mysql: null } });
    add("Count MySQL", caching ? "The next count starts with the saved errors" : "Without caching, the next count repeats the work",
      caching ? "Workers check the four saved errors for MySQL and return 2. They do not read the log or rerun the ERROR filter."
        : "Workers read the log and rerun the ERROR filter, then check for MySQL. The answer is still 2, but the log has now been scanned twice.", 'errors.filter(_.contains("MySQL")).count() // 2', { scans: caching ? 1 : 2, filterRecords: caching ? 6 : 12, active: caching ? "reuse" : "recompute", result: { all: 4, mysql: 2 } });
    return q.steps;
  }

  function executionSteps(operation = "shuffle") {
    const wide = operation === "shuffle";
    const q = sequence({ operation, stages: wide ? 2 : 1, tasks: 0, combined: false, shuffled: false, transformed: false, filtered: false, result: null, action: false, shuffleRecords: 0 });
    const add = q.add.bind(q);
    add("Plan", wide ? "A shuffle divides this DAG into two stages" : "Several narrow transformations can share one stage",
      wide ? "Word count groups equal keys, so this unpartitioned input requires a shuffle. reduceByKey() defines an RDD; the final count() requests execution."
        : "Each parent partition feeds one output partition. flatMap, map, and filter can be pipelined in one task per partition. Narrow does not mean free CPU work.", wide ? 'val counts = lines.flatMap(_.split(" ")).map(w => (w, 1)).reduceByKey(_ + _)'
        : 'val kept = lines.flatMap(_.split(" ")).map(_.toLowerCase).filter(_.length >= 5)');
    add("Launch", "The action starts the required stage tasks", "The driver traverses lineage and schedules three input-partition tasks. The planned data preview becomes worker computation only after this action.", wide ? "val frequent = counts.filter { case (_, n) => n >= 2 }; frequent.count()" : "kept.count()", { tasks: 3, action: true });
    if (wide) {
      add("Combine", "Combine equal keys locally before the shuffle", "Each input task tokenizes its lines and combines its own repeated keys. Eighteen word occurrences become fifteen partial key-count records to shuffle.", "// per-partition combine: (spark,1) + (spark,1) → (spark,2)", { combined: true });
      add("Shuffle", "Redistribute partial counts by key", "Every key has one target partition. A parent can contribute to several children, so the dependency is wide. Map outputs are written and reducer tasks fetch the corresponding buckets.", "// shuffle buckets → target key partition", { shuffled: true, shuffleRecords: 15, tasks: 6 });
      add("Reduce", "Sum, then filter inside stage 2", "Three reduce-side tasks sum the fetched partials. The following n ≥ 2 filter is narrow and stays in this stage. The threshold is lowered from 10 in the lecture to fit this small dataset.", "counts.filter { case (_, n) => n >= 2 }", { filtered: true, transformed: true });
      add("Count", "Return partition counts to the driver", "Two frequent keys are in C0, one in C1, and one in C2. The driver combines the scalar partial counts: 2 + 1 + 1 = 4. This final count is not another RDD shuffle.", "// frequent.count() = 4", { result: FREQUENT.flat().length });
      add("Complete", "Two stages; narrow operators are fused within each", "A stage boundary is an execution boundary at the required shuffle. It is not a boundary after every RDD transformation.", "// 3 input tasks + 3 reduce-side tasks");
    } else {
      add("Map", "Tokenize and map within each partition", "A task can produce an iterator of words and immediately pass each word to the next operator. Spark need not write a separate dataset between every narrow transformation.", 'lines.flatMap(_.split(" ")).map(_.toLowerCase)', { transformed: true });
      add("Filter", "Filter locally in the same tasks", "Words of length at least five remain in their original partition path. No key redistribution or shuffle buckets are required.", "// inside kept: filter(_.length >= 5)", { filtered: true });
      add("Count", "Combine three scalar partial results", "The kept counts are 4, 3, and 5. The driver receives their sum, 12. Returning small task results is not the key-repartitioning shuffle illustrated in word count.", "// kept.count() = 12", { result: NARROW.flat().length });
      add("Complete", "One stage, three tasks, zero shuffle records", "The map and filter work can be pipelined. They still process data; avoiding a shuffle removes redistribution, not all computation.", "// one task per input partition");
    }
    return q.steps;
  }

  function recoverySteps({ target = null, checkpoint = false } = {}) {
    const q = sequence({ target, checkpoint, lost: false, traced: false, read: false, rebuilding: false, restored: false, reads: 0, recordsRead: 0, transforms: 0, recoveryTasks: 0, worker: target === null ? null : (target + 1) % 3 });
    const add = q.add.bind(q);
    add("Ready", "Drop a cached partition to start a recovery", "C is already computed and cached once. E and M are not retained in memory. Click C0, C1, or C2 below; only one cached block is lost in this experiment.", "val C = lines.filter(isError).map(service).filter(_ != \"scheduler\").persist()");
    if (target === null) return q.steps;
    add("Lost", `Cached C${target} is missing`, "The RDD definition and deterministic functions still exist at the driver. The other cached C partitions remain available. Losing a cached block does not change the logical dataset.", `// drop cached block C${target}`, { lost: true });
    add("Trace", checkpoint ? `Trace C${target} back to checkpointed E${target}` : `Trace C${target} back to stable input L${target}`,
      checkpoint ? "The toggle represents a completed reliable checkpoint of E. Its earlier lineage has been cut, so recovery starts from the saved E partition, then reruns map and the final filter."
        : "This chain contains only narrow dependencies. Only Lᵢ → Eᵢ → Mᵢ → Cᵢ is needed. No other input partition or cached C block needs to be recomputed.", checkpoint ? `E${target} (checkpoint) → M${target} → C${target}` : `L${target} → E${target} → M${target} → C${target}`, { traced: true });
    add("Read", checkpoint ? "Read the saved checkpoint partition" : "Read the required stable log partition",
      checkpoint ? `Read ${ERRORS[target].length} error records from the durable E${target} checkpoint. Merely calling checkpoint() would not have created this saved data; checkpoint completion is assumed here.`
        : `Read the ${LOGS[target].length} records in L${target} from surviving durable input. Lineage cannot recreate unavailable original information without a surviving source or checkpoint.`, checkpoint ? `// HDFS checkpoint E${target}` : `// HDFS input L${target}`, { read: true, reads: 1, recordsRead: checkpoint ? ERRORS[target].length : LOGS[target].length });
    add("Rebuild", `Reconstruct C${target} on Worker ${((target + 1) % 3) + 1}`,
      `One recovery task pipelines ${checkpoint ? "two" : "three"} transformations for this partition. The remaining cached C blocks are reused, not recomputed.`, checkpoint ? "checkpoint E → map(service) → filter" : "HDFS L → filter(ERROR) → map(service) → filter", { rebuilding: true, transforms: checkpoint ? 2 : 3, recoveryTasks: 1 });
    add("Restore", `C${target} is back in the cache`, "The same immutable input and deterministic transformations reproduce the same records. The restored cache block now lives on a different executor.", `// C${target} = [${FINAL[target].join(", ")}]`, { lost: false, restored: true, rebuilding: false });
    add("Reuse", "Continue without rolling back unrelated work", "Only the selected partition was reconstructed. This narrow example has a short dependency path; recovering a partition after a shuffle may require outputs from many parents.", "// reuse all three C partitions");
    return q.steps;
  }

  const model = Object.freeze({ LOGS, ERRORS, SERVICES, FINAL, LIFECYCLE_LOGS, LIFECYCLE_ERRORS, WORD_LINES, WORDS, WORD_PARTITION, COMBINED, BUCKETS, COUNTS, FREQUENT, NARROW, lifecycleSteps, executionSteps, recoverySteps });
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  else globalThis.SparkModel = model;
})();
