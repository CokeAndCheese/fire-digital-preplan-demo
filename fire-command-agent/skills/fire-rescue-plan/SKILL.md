---
name: fire-rescue-plan
description: Aggregate spatial location, I-V response assessment, route and water, and force-matching results into structured fire-rescue plan JSON through the authenticated plan Skill Bridge, then query, review, export, or submit a versioned plan. Use when the closed-loop workflow needs a structured plan, historical plan, human review, Word delivery, or version signing. Require approval before publishing or submitting a plan.
---

# Structured Fire Rescue Plan And Delivery

Use `scripts/invoke.mjs` so plan operations always pass through the same audited runtime as the command workspace.

## Workflow

1. Read `references/actions.schema.json`.
2. Collect building and fire facts plus available outputs from the four core Skills. Mark every missing source explicitly.
3. Run `generate_plan` or `query_plan` without approval.
4. Present the structured JSON, evidence sources, gaps, and version for review.
5. Run `publish_plan` only after explicit approval, then preserve Word export and signing receipts when the bridge provides them.

```powershell
$json = '{"building":"五矿国际广场","floor":"8F","room":"808","fireType":"电气火灾","trappedCount":2,"burnArea":35}'
$input64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
node scripts/invoke.mjs --action generate_plan --input-base64 $input64
```

## Guardrails

- Preserve factual gaps; do not invent unit names, phone numbers, building dimensions, or arrival times.
- Treat generated plans as drafts until published.
- Return plan ID, version, status, and risk level.
- Never publish without approval.
