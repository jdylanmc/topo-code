# Local story authoring

The `topo-story-authoring` skill gives a coding agent a local workflow for
creating and evolving a source-grounded story. The agent reads the branch
source, diff, and existing stories; edits the authored `stories/**/*.topo.json`
document; and uses Topocode's objective validation and preview commands. No
hosted model service is required, and `topo scan` never invokes an agent or
model.

Source-grounded stories may select any native diagram family and must keep
evidence on every section. Use `classification: "capability-demo"` only for an
explicitly conceptual, anchor-free renderer demonstration; it is labelled as
non-source-grounded and separated from factual catalogue entries. See
[source-grounded story preview](./story-preview.md) for the complete family,
classification, relationship-label, preview, and export contract.

## Executable before/after walkthrough

The regression fixture under `examples/story-authoring/` represents a real Git
repository at two points on a `payment-boundary` branch:

- `initial/` contains the first source and authored checkout story.
- `changed/` moves payment authorization to `src/payment.ts` and updates only
  the two affected anchors. The story ID, unrelated audit anchor and section,
  narrative, and connections remain unchanged.

`packages/cli/src/story-authoring.test.ts` creates the repository, commits the
initial source, authors the first story as an uncommitted draft, and runs:

```text
topo story validate <repo> <repo>/stories/checkout.topo.json
Validated stories/checkout.topo.json (checkout) against <revision> with working tree changes
  submit-checkout: src/checkout.ts:7-7
  charge-order: src/checkout.ts:10-12
  audit-order: src/checkout.ts:14-16
```

After committing and previewing that story, the test applies the changed source
while retaining the old story. Validation fails objectively with
`missing-pattern`. The test then applies the changed authored document, compares
the before/after identity and unrelated content, and validates the repaired
evidence:

```text
Validated stories/checkout.topo.json (checkout) against <revision> with working tree changes
  submit-checkout: src/checkout.ts:9-9
  charge-order: src/payment.ts:3-5
  audit-order: src/checkout.ts:12-14
```

Finally it commits the branch change, runs `topo scan` and
`topo story preview`, and verifies the locally viewable generated artifact at
`.topo/cache/site/stories/checkout/viewer.html` cites
`authorizePayment`. The authored story remains in `stories/`; generated
renderer and cache output remains in `.topo/cache/site/`.

Run the walkthrough with:

```sh
corepack yarn workspace @topo/cli build
corepack yarn workspace @topo/cli test -- story-authoring.test.ts
```

Successful schema and anchor resolution proves structure and source evidence
exist at that working-tree state. It does not prove that the explanation is
semantically accurate or complete; human review remains required.
