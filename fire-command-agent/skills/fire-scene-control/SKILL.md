---
name: fire-scene-control
description: Resolve and control fire-scene spatial objects through the authenticated uStudio Skill Bridge. Use when the agent needs to locate or highlight a building, floor, room, or fire compartment, obtain a spatial target for downstream reasoning, switch 2D or 3D view, or start an approved fire simulation. Require approval before any action that changes the live scene or starts a simulation.
---

# Fire Spatial Location And Scene Control

Use the deterministic bridge client in `scripts/invoke.mjs`. Never control the target through iframe DOM clicks.

## Workflow

1. Read `references/actions.schema.json` before constructing an action.
2. Resolve a precise target through `lib/scenario-registry.ts`. Names may only select a unique registered entry; an absent, stale, or conflicting ID must stop the action for manual review.
3. Ask for approval for `locate_space` and `start_simulation`.
4. Run:

```powershell
$json = '{"sceneId":"<injected-from-scenario-registry>","floor":"1F","room":"商铺1"}'
$input64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
node scripts/invoke.mjs --action locate_space --input-base64 $input64 --approved
```

5. Report the returned execution ID, bridge mode, command status, and any SDK error without claiming success when the bridge only queued or rejected the command.

## Guardrails

- Call only actions listed in the schema.
- Do not create a second scene viewer or manipulate Three.js objects directly.
- Use the public UStudio SDK methods exposed by the target project.
- Treat `offline`, `timeout`, and `source_unavailable` as failures.
- Never include bridge tokens in messages, logs, or tool arguments.
