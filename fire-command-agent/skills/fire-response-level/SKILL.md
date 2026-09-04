---
name: fire-response-level
description: Assess a fire incident against the configured I-V response-level rule base and fire-service knowledge base, preserve the evidence used, explain the proposed level, and submit the result for human review. Use when an incident needs response grading, escalation or downgrade reasoning, or an auditable level recommendation before plan generation.
---

# Fire Response Level

Read `references/actions.schema.json` before constructing an action. Use `scripts/invoke.mjs` so every assessment passes through the audited agent runtime.

## Workflow

1. Build one structured incident evidence package. Every field must keep its value, source, confidence, collection time, and manual-confirmation state.
2. Run `assess_response_level` to obtain a proposed I-V level and matched rule evidence.
3. Run `explain_level_basis` when the reviewer needs a human-readable basis.
4. Present missing facts and conflicting rules explicitly.
5. Run `submit_level_review` only after approval.

## Guardrails

- Treat the result as a recommendation until a qualified commander formally issues it.
- Do not infer venue type, response level, missing personnel counts, or spatial facts from a building name, floor, or general knowledge.
- When evidence is missing or conflicting, seal the attempt as `pending_manual_review`; do not retry it by changing wording, querying another Skill, or re-querying the same spatial data.
- Preserve rule IDs, evidence sources, inputs, confidence, manual-confirmation state, and timestamps.
- Submitting review is not formal issuance and cannot start dispatch, simulation, or plan signing.
