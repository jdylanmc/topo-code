# Third-party notices

This package vendors the pristine Archify 3.0.0 release ZIP at revision
`9286c3b9c2cef359e98586b420d769d87bcb163f`.

`archify-pin.json` records the official archive URL and SHA-256. All 104
upstream files are unchanged; `archify-integrity.json` checks their exact
inventory and bytes. Topocode's pin metadata remains outside the pristine
vendor tree. The previous runtime manifest is preserved unchanged in
`integrity/archify-2.17.0-dev.1.json`.

Renderer adaptations belong in Topocode's adapter, not the upstream copy.
Contribute required renderer changes upstream first; an explicitly approved
patch must be separately listed with its upstream status. There are no vendor
patches in this distribution. No runtime download occurs during build or use.

The complete upstream license and notices are retained verbatim in:

- `vendor/archify/LICENSE`
- `vendor/archify/THIRD_PARTY_NOTICES.md`
