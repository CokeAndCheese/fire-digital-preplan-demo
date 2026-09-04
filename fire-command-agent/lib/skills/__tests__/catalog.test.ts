import { describe, expect, it } from 'vitest';
import { findSkillAction, SKILL_CATALOG } from '../catalog';

describe('skill catalog', () => {
  it('registers core and orchestration skills in workflow order', () => {
    expect(SKILL_CATALOG.map((skill) => skill.id)).toEqual([
      'scene-control',
      'response-level',
      'route-water',
      'fire-resource',
      'plan-template',
      'rescue-plan',
      'competition-orchestrator',
      'fire-zone-deploy',
    ]);
    expect(SKILL_CATALOG.filter((skill) => skill.role === 'core')).toHaveLength(6);
    expect(SKILL_CATALOG.filter((skill) => skill.role === 'orchestration')).toHaveLength(2);
  });

  it('marks state-changing actions as approval required', () => {
    expect(findSkillAction('scene-control', 'start_simulation')?.requiresApproval).toBe(true);
    expect(findSkillAction('response-level', 'submit_level_review')?.requiresApproval).toBe(true);
    expect(findSkillAction('rescue-plan', 'publish_plan')?.requiresApproval).toBe(true);
    expect(findSkillAction('fire-resource', 'query_nearby_units')?.requiresApproval).toBe(false);
    expect(findSkillAction('competition-orchestrator', 'run_approved_demo')?.requiresApproval).toBe(true);
    expect(findSkillAction('fire-zone-deploy', 'deploy_zone')?.requiresApproval).toBe(true);
  });
});
