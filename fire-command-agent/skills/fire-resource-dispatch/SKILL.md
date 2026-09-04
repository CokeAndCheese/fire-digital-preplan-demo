---
name: fire-resource-dispatch
description: Match verified fire stations, vehicles, personnel, equipment, contacts, availability, and distance from the configured municipal resource platform, then propose an auditable force composition. Use when the agent needs nearby units, official contact details, capability matching, or a force recommendation. Never fabricate unavailable resource data.
---

# Fire Resource Matching And Dispatch

Use `scripts/invoke.mjs`. The target platform is `https://platform.sanya119.online/`; read its registered force data through the configured `FIRE_RESOURCE_PLATFORM_URL` only and surface connectivity failures directly.

## Workflow

1. Read `references/actions.schema.json`.
2. Use `query_nearby_units` for location-based lookup.
3. Use `get_unit_contact` only with a returned unit ID.
4. Present verified source records before proposing a dispatch.
5. Run `dispatch_recommendation` only after approval.

```powershell
$json = '{"address":"三亚市吉阳区","radiusKm":10}'
$input64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
node scripts/invoke.mjs --action query_nearby_units --input-base64 $input64
```

## Guardrails

- Do not invent station names, phone numbers, distances, vehicles, personnel, or availability.
- If the municipal platform or required API is unavailable, return `source_unavailable`.
- Separate verified fields from recommendations.
- Preserve the source timestamp and resource record IDs.
