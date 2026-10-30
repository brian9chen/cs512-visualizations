# CPS 512 visualizations

Plain HTML and JavaScript, using the course site's existing stylesheet. No build step.

## Preview

From this directory:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000/visualizations/chord.html>. Save changes and refresh.
The gallery is at <http://localhost:8000/visualization.html>.

## Handoff

Copy these new files into the matching directories in the course repo:

- `visualizations/chord.html`
- `js/chord-model.js`
- `js/chord-animation.js`
- `visualizations/spanner.html`
- `js/spanner-model.js`
- `js/spanner-animation.js`

Add links to the new pages in the course's `visualization.html`.
This workspace's gallery contains matching cards you can copy.
The components isolate their styles with Shadow DOM.

## Chord

The two original examples use a stable 6-bit ring:

- Node 7 looks up key 54: **7 → 44 → 50 → 56**.
- Node 44 looks up key 5 across zero: **44 → 60 → 2 → 7**.

Check lookup behavior (requires Node.js for tests only):

```sh
node --test tests/*.test.cjs
```

`css/style.css` is a reference copy from the [course site](https://courses.cs.duke.edu/fall26/compsci512/visualization.html)
for local preview. Use the course repo's existing stylesheet when copying visualizations over.

Algorithm: [Stoica et al., Chord, SIGCOMM 2001](https://pdos.csail.mit.edu/papers/chord:sigcomm01/chord_sigcomm.pdf).

## Spanner

Open <http://localhost:8000/visualizations/spanner.html>.
Five tabs cover the full transfer, 2PL, ordinary 2PC, TrueTime, and MVCC snapshot reads.
Controls are manual. Each tab retains its progress; uncertainty is shared across timestamp-based views.

The full protocol offers single-group placement and a leader failure after the commit decision is replicated.
The 2PC view contrasts a separate unreplicated coordinator; prepared participants block until recovery.
Snapshot reads demonstrate both replication lag and unresolved-prepare limits on safe time.

This is a teaching model of the [2012 Spanner protocol](https://www.usenix.org/system/files/conference/osdi12/osdi12-final-16.pdf).
Message batching, lease recovery, and delays are simplified; all timestamps are illustrative.
The page's “Model & sources” dialog explains the assumptions.
