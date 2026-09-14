# Changelog

Notable changes to this private, locally run project are recorded here. Topocode
does not currently publish versioned releases.

## Unreleased

### Fixed

- Catch strict TypeScript errors in browser end-to-end tests and helpers during
  the standard regression gate.
- Keep scanner tests isolated when temporary storage is inside an ignored
  checkout directory, without requiring a caller Git ceiling override.
- Allow browser suites in separate checkouts to run concurrently through a
  validated per-suite port override.
