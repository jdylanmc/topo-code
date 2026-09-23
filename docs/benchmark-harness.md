# Retired WebGL benchmark archive

The checked-in files under `benchmarks/results/` are immutable historical
evidence from the retired PixiJS/WebGL repository explorer. They remain useful
for understanding earlier architecture, acceptance decisions, and measurement
limitations, but they do not describe the generated shell or the pinned
Archify viewers shipped by Topocode today.

The executable benchmark harness, fixture server, generated fixtures, browser
observers, and lifecycle tests were removed with the explorer source. The
recorded results are therefore **not reproducible from the current tree** and
must not be presented as current shell, Archify, scanner, graph, or package
performance. Each result retains its original source hashes and metadata; read
those fields before comparing historical captures.

Historical measurements include controller wall-clock phases, delivered-frame
intervals, input observations, WebGL buffer submissions, and workload-specific
acceptance floors. Those semantics remain documented inside the result files
and in the source-bound product documents that cite them. Long frames and
incomplete runs remain part of the archive rather than being rewritten or
reclassified.

Current correctness and viewport acceptance use the ordinary regression gate:

```sh
corepack yarn test:regression
```

That gate builds the data contract and command-line interface, exercises the
generated shell and real Archify artifacts through Playwright, and verifies
readability, containment, navigation, source evidence, focus behavior, and
canonical exports. It is not a performance benchmark or a substitute for human
perceptual review.
