# CLI reference

Run commands inside your project using `npm exec --no -- topo`, or use `topo`
directly after a global installation. Node.js 22+ and a Git repository are
required. Repository arguments default to the current directory where shown.

```text
topo init [repository] [--skills]
topo scan [repository] [--allow-partial] [--responsibilities path]
topo ingest <repository> <report.json> [more.json ...]
topo enrich [repository]
topo preview <repository> <story>
topo story validate <repository> <story>
topo story preview <repository> <story>
topo serve [repository] [--port 4173]
topo bundle [repository] [--output directory] [--base-path /path/]
```

| Command | Purpose |
| --- | --- |
| `init` | Create configuration and a ready-to-serve Home without scanning. `--skills` opts into local agent guidance. |
| `scan` | Generate structural evidence and repository exploration; render committed stories. Strict by default. |
| `ingest` | Ingest normalized report evidence against a clean scanned revision. |
| `enrich` | Explicitly run the repository-configured external command for inferred commentary. Never runs as part of scan. |
| `story validate` | Validate an authored draft and resolve its source anchors. |
| `story preview` | Render committed stories and refresh Home without requiring a scan. |
| `preview` | Legacy shorthand for story preview. |
| `serve` | Serve locally on `127.0.0.1`; default port is 4173. |
| `bundle` | Emit static files with all required runtime assets and notices. |

`--help` (or `-h`) prints the installed CLI contract. Unknown commands, arguments,
and unsupported option combinations fail explicitly.

## Important options

`scan --allow-partial` publishes a visibly incomplete preview and returns exit
code **2**. It is not a success override. Explicit Rust/Tauri analysis currently
requires this acknowledgement.

`scan --responsibilities <path>` accepts an explicit responsibility-grouping
proposal. See [logical architecture](./logical-architecture.md).

`bundle --base-path` must be `/` or an absolute URL path ending in `/`. It creates
that path beneath the output directory. Default output is `.topo/bundle`.

`serve --port 0` requests an available port; use the printed URL.

## Related contracts

- [Configuration and workspace lifecycle](./workspace.md)
- [Story authoring](./story-authoring.md)
- [Report ingestion](./reports.md)
- [Explicit enrichment](./enrichment.md)
- [Rust/Tauri support and limits](./rust-tauri.md)
