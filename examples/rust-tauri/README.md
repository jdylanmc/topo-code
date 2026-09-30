# Synthetic Rust/Tauri source

This fixture is for static evidence, not a buildable Tauri application. It
intentionally requires no Cargo build or installed application dependencies.
It contains no real application's source, diagrams or cached output.

In a new disposable Git repository, run the installed `topo init . --skills`,
copy `src/`, `src-tauri/` and `stories/` here into that repository, and merge
`topo.config.json` into its persistent `.topo/config.json`. Keep an actual
repository ID; the fixture uses `synthetic-snapshot`. Give the synthetic Git
repository its own test origin and first commit. Follow installed
`docs/rust-tauri.md` for validation, committed preview, partial scan (exit 2),
serve, bundle and cache recreation. Do not copy this example over real source.

The expected frontend-to-handler binding is `refresh -> snapshot`; `snapshot`
returns ready or pending based on the input. The author traces those branches
without claiming a compiler-derived control-flow graph. The second story is a
native Architecture view sharing the handler anchor.
