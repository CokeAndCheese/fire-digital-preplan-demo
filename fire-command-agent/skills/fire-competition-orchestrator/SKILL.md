---
name: fire-competition-orchestrator
description: Coordinate the Sanya fire-rescue competition workflow across spatial location, I-V response assessment, route and water planning, force matching, structured plan generation, human review, and the 11-step 3D demonstration. Use when a command needs an end-to-end, reviewable competition run rather than an isolated query or when preparing final demo evidence.
---

# Fire Competition Orchestrator

Coordinate the five registered Skills as one reviewable command workflow. This Skill creates a draft and evidence trail; it never signs, dispatches, or changes the live 3D scene by itself.

## Workflow

1. Read `references/ustudio-agent-contract.md` before configuring or invoking the UStudio main agent.
2. Gather a precise incident input: building, scene ID, floor or room, fire type, trapped count, and burn area. Preserve missing fields as `pending_verification`.
3. Run, in order: spatial location, I-V assessment, route and water, force matching, then structured plan generation.
4. Return one workflow record containing the input, source status, each Skill result, uncertainties, and the next review action.
5. Request an explicit approval before starting the 11-step simulation, submitting a plan, or sending any command that changes another project.
6. Present sources and limitations plainly. Do not claim a route, a response level, a force availability state, or a 3D action when its source is unavailable.

## Guardrails

- Keep the UStudio agent responsible for reasoning and explanation; keep deterministic rules and child-project actions behind the registered Skills.
- Treat the Sanya force platform as a read-only registered-data source unless a real dispatch interface is provided.
- Send only the minimum necessary incident fields to each Skill.
- Keep all final plan, review, and simulation outputs linked by the same incident or plan ID.
- Use the action schema in `references/actions.schema.json`; never invent actions or silently bypass approval.
