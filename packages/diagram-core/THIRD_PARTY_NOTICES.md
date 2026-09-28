# Third-party notices

This adapter consumes `@jdylanmc/topo-archify@0.1.0`, the pristine Archify 3.0.0
release ZIP at revision
`9286c3b9c2cef359e98586b420d769d87bcb163f`.

`archify-pin.json` records the official archive URL and SHA-256. All 104
upstream files are unchanged; the renderer package's `runtime-integrity.json`
checks their exact inventory and bytes. Topocode verifies the package against
its expected pin. Historical manifests remain unchanged in
`integrity/archify-2.17.0-dev.1.json` and `integrity/archify-3.0.0.json`.

Renderer adaptations belong in Topocode's adapter, not the upstream copy.
Contribute required renderer changes upstream first; an explicitly approved
patch must be separately listed with its upstream status. There are no vendor
patches in this distribution. No runtime download occurs during build or use.

The complete upstream license and notices are retained verbatim in:

- `@jdylanmc/topo-archify/runtime/LICENSE`
- `@jdylanmc/topo-archify/runtime/THIRD_PARTY_NOTICES.md`
