# I-V Evidence Rule Basis

Rule version: `sanya-fire-evidence-rules-v1`

This is the project-controlled competition assessment rule set introduced by request 03. It is versioned and deterministic, but it is not an administrative or legal issuance of a fire-service response level.

The engine refuses to recommend a level until all required incident fields have a usable value, a source ID, collection time, confidence from 0.5 to 1, and no unresolved conflict. The result always retains `officialIssuedLevel: null` and `reviewRequired: true`.

An `assessmentId` is derived from the rule version plus the incident's source-and-value fingerprint. Collection timestamps remain in the returned evidence, but are not part of that identity: repeating an unchanged incomplete evidence package returns the original sealed assessment instead of creating a fresh retry.

The calculation considers directly reported facts only: floor, burn area, spread trend, trapped, casualty and missing-person counts, special hazards, facility failures, weather constraints, and road constraints. It never infers venue type or risk from a building name.

Hard floors: reported casualties or missing people force at least I; ten or more trapped people force at least I; four or more trapped people, or major hazardous material with rapid spread, force at least II. Otherwise the score thresholds are I at 16, II at 11, III at 6, IV at 3, and V below 3.

Formal issuance, audit persistence, dispatch, simulation, and plan signing are deliberately outside this rule and require the downstream review and signing workflow.
