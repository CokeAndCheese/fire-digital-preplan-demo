import fireResourceManifest from '@/skills/fire-resource-dispatch/runtime.json';
import planTemplateManifest from '@/skills/fire-plan-template/runtime.json';
import rescuePlanManifest from '@/skills/fire-rescue-plan/runtime.json';
import competitionOrchestratorManifest from '@/skills/fire-competition-orchestrator/runtime.json';
import responseLevelManifest from '@/skills/fire-response-level/runtime.json';
import routeWaterManifest from '@/skills/fire-route-water/runtime.json';
import sceneControlManifest from '@/skills/fire-scene-control/runtime.json';
import zoneDeployManifest from '@/skills/fire-zone-deploy/runtime.json';
import type { SkillDefinition, SkillId } from './types';

function manifest(value: unknown): SkillDefinition {
  const skill = value as SkillDefinition;
  if (!skill.id || !skill.packageName || !skill.name || !skill.endpointEnv || !skill.role || !Array.isArray(skill.actions)) {
    throw new Error('Skill runtime manifest is invalid.');
  }
  return skill;
}

export const SKILL_CATALOG: SkillDefinition[] = [
  manifest(sceneControlManifest),
  manifest(responseLevelManifest),
  manifest(routeWaterManifest),
  manifest(fireResourceManifest),
  manifest(planTemplateManifest),
  manifest(rescuePlanManifest),
  manifest(competitionOrchestratorManifest),
  manifest(zoneDeployManifest),
];

export function findSkill(skillId: string): SkillDefinition | undefined {
  return SKILL_CATALOG.find((skill) => skill.id === (skillId as SkillId));
}

export function findSkillAction(skillId: string, actionId: string) {
  return findSkill(skillId)?.actions.find((action) => action.id === actionId);
}
