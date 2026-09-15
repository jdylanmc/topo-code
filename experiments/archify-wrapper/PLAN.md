## Goal

Run three isolated proof-of-concept experiments to determine whether topo-code can wrap unmodified Archify as its initial diagramming engine. Start with wrapping; consider a fork later only when observed feature gaps or required behavior changes justify ownership of the implementation.

Related: #1. This is an investigation plan, not authorization for production integration or a settled renderer decision.

## Product direction established with the maintainer

**Topo is an architectural whiteboard an agent uses to document intention and architecture, then presents to a human.**

- Agent-authored explanations are the primary experience. The repository graph and source code provide supporting evidence.
- Diagrams use ordinary primitives: boxes, arrows, labels, shapes, colors, borders, and backgrounds. The distinctive value is generating meaningful explanations from code and maintaining them as the system changes.
- Prefer succinct, linked, coordinated views with drill-down and navigation back up, rather than one overloaded canvas.
- Support architectural documentation spanning components, code flows, UML, data flows, and algorithms. Do not assume Archify's existing diagram modes cover every future need.
- Coding agents should use topo skills to update `.topo` alongside code and commit both in their PRs. Local engineers can preview and request corrections.
- CI should check committed artifacts and publish a PR-specific static staging preview. Merging evolves documentation and implementation together.
- The intended review experience lets an architect understand intent and provide architectural feedback without routinely reading implementation code. Artifact validity must not be presented as proof of semantic correctness or complete change coverage.
- Humans should not author JSON. A future FigJam-style canvas could let a human sketch boxes and arrows, then ask an agent to clarify and enrich them against the codebase. Distinguish proposed intent from observed implementation.

## Questions

1. Can a thin wrapper produce useful, code-grounded diagrams without modifying Archify?
2. Can separate Archify artifacts form coherent, explorable static documentation?
3. Can the wrapper support explanation updates and architectural change review while preserving identity, evidence, and explicit failure behavior?

## POC 1: Code-grounded whiteboard

**Approach**

- Pin Archify to a known commit and invoke its existing CLI through a minimal experimental wrapper.
- Use topo-code itself as read-only source evidence.
- Author a small explanation of the scan-to-site flow, approximately 8-12 primary components.
- Map diagram identities back to relevant source entities and evidence; preserve the distinction between observed facts and interpretation.
- Generate and inspect the actual standalone HTML.

**Observations**

- Record required ID/schema translations and whether they remain wrapper-owned.
- Exercise valid input, an invalid diagram, and an invalid source reference.
- Check repeated rendering of the same frozen specification; document any byte differences rather than assuming reproducibility.
- Confirm errors are visible and a rejected candidate is not presented as current output.

**Decision signal:** supported if the unmodified CLI can produce a useful evidence-linked explanation with explicit mappings and failure handling. Record any missing semantics or required upstream changes.

## POC 2: Linked architectural documentation

**Approach**

- Create an overview and two focused diagrams, such as artifact generation and browser loading.
- Add the smallest static wrapper/index needed for overview-to-detail and return navigation.
- Exercise actual browser navigation and Archify's relevant native interactions.
- Test relative asset/link behavior under a nested static URL path resembling PR staging.

**Observations**

- Can navigation work without patching Archify or relying on undocumented DOM internals?
- Which context can be preserved through supported links, and what is lost?
- Are diagrams readable and self-contained at their chosen scope?
- Separate agent browser observations from the maintainer's judgment of explanatory quality.

**Decision signal:** supported if unmodified artifacts form a usable linked documentation experience. Note whether a separate wrapper navigation shell is sufficient or viewer changes are necessary.

## POC 3: PR evolution and failure boundaries

**Approach**

- Use controlled synthetic before/after fixtures; do not change product code.
- Update an explanation while preserving identities of unchanged components and relationships.
- Render the resulting system view and an architectural delta using Archify's existing comparison support.
- Exercise missing references, invalid input, and stale explanation metadata.

**Observations**

- Distinguish meaningful topology/semantic changes from layout-only movement.
- Identify which checks Archify supplies and which topo must own, particularly freshness and change coverage.
- Check that invalid generation preserves last-good output without misrepresenting it as the new candidate.
- Do not claim source-reference verification proves behavior or that a controlled fixture proves real CI integration.

**Decision signal:** supported if change review can be expressed through the wrapper with inspectable identity mappings and explicit stale/invalid states. Unimplemented freshness checks must be reported as gaps.

## Execution boundaries

- **Proposed budget: 30 minutes total for the initial pass; maintainer confirmation pending.** Stop at the agreed limit and report incomplete experiments. Do not expand the budget silently.
- Use uniquely named session scratch storage outside the product checkout.
- No product edits, dependency-manifest changes in topo-code, commits, deployment, paid model calls, or production integration.
- No Archify source modifications during the wrapper experiments. Required modifications become findings, not an implicit fork.
- This agent may author the experimental specifications; no separate model-service integration is necessary.
- Use public/read-only repository evidence and synthetic fixtures. Do not upload private code or credentials.
- Stop experiment-owned servers at completion; retain runnable artifacts and evidence in temporary session storage.
- Actual CI deployment, production topo skills, future canvas authoring, and full UML/algorithm coverage are outside this initial pass.

## Findings to return

- [ ] Pinned versions, environment, exact commands, inputs, and artifact locations.
- [ ] Browser-exercised HTML examples with reproducible navigation.
- [ ] Per-POC supported / contradicted / inconclusive verdict.
- [ ] Failures, untested cases, and semantic-quality limitations.
- [ ] Clear separation of native Archify behavior, adapter work, and features requiring upstream changes or a fork.
- [ ] Maintainer visual feedback recorded separately, or explicitly pending.
- [ ] Recommendation: continue wrapping, investigate a specific upstream contribution/fork, or reconsider the boundary.

Evidence should justify the next decision, not promote experimental code into the product.

## Starting evidence

Research inspected Archify commit `d673e8300df60a5c8166abe78787fdc78f6b8000` and topo-code commit `339135d`. No wrapper has been executed yet.

- [Archify authoring workflow](https://github.com/tt-a1i/archify/blob/d673e8300df60a5c8166abe78787fdc78f6b8000/archify/SKILL.md): typed specifications, bounded composition, validation and repair loop.
- [Architecture renderer](https://github.com/tt-a1i/archify/blob/d673e8300df60a5c8166abe78787fdc78f6b8000/archify/renderers/architecture/render-architecture.mjs#L52-L60): CLI-oriented module initialization, not a clean import-only rendering API.
- [Viewer contract](https://github.com/tt-a1i/archify/blob/d673e8300df60a5c8166abe78787fdc78f6b8000/archify/references/viewer-runtime.md): exploration, guided views, exports, and truth boundaries.
- [Source evidence contract](https://github.com/tt-a1i/archify/blob/d673e8300df60a5c8166abe78787fdc78f6b8000/archify/references/authoring-contract.md#repository-evidence): architecture-only source verification against a pinned Git revision.
- [Delivery contract](https://github.com/tt-a1i/archify/blob/d673e8300df60a5c8166abe78787fdc78f6b8000/archify/references/delivery-contract.md): last-good output, deterministic receipts, and separate browser/perceptual evidence.
- [Third-party notices](https://github.com/tt-a1i/archify/blob/d673e8300df60a5c8166abe78787fdc78f6b8000/archify/THIRD_PARTY_NOTICES.md): Archify is MIT, but fonts and brand assets carry additional obligations.

## Unresolved product policy

Whether CI should block missing/stale topo documentation or initially publish warnings remains a human decision. These experiments should expose detection capabilities without silently choosing enforcement policy.
