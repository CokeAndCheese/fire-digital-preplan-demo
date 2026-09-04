import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSkillRuntimes } from '../server';

const savedRuntimeMode = process.env.AGENT_RUNTIME_MODE;
const savedRescuePlanUrl = process.env.RESCUE_PLAN_URL;
const savedCompetitionUrl = process.env.COMPETITION_ORCHESTRATOR_URL;
const savedSceneUrl = process.env.SCENE_CONTROL_URL;
const savedRouteUrl = process.env.ROUTE_WATER_URL;

afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, value] of [
    ['AGENT_RUNTIME_MODE', savedRuntimeMode],
    ['RESCUE_PLAN_URL', savedRescuePlanUrl],
    ['COMPETITION_ORCHESTRATOR_URL', savedCompetitionUrl],
    ['SCENE_CONTROL_URL', savedSceneUrl],
    ['ROUTE_WATER_URL', savedRouteUrl],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('local competition runtime skill status', () => {
  it('keeps local orchestration executable when optional external bridges are down', async () => {
    process.env.AGENT_RUNTIME_MODE = 'offline_demo';
    process.env.RESCUE_PLAN_URL = 'http://127.0.0.1:1/api/skill-bridge/rescue-plan';
    process.env.COMPETITION_ORCHESTRATOR_URL = 'http://127.0.0.1:1/api/skill-bridge/competition';
    process.env.SCENE_CONTROL_URL = '';
    process.env.ROUTE_WATER_URL = '';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('external bridge unavailable'));

    const runtimes = await getSkillRuntimes();
    expect(runtimes.find((skill) => skill.id === 'rescue-plan')).toMatchObject({ status: 'online', mode: 'simulation' });
    expect(runtimes.find((skill) => skill.id === 'competition-orchestrator')).toMatchObject({ status: 'online', mode: 'simulation' });
  });

  it('keeps local controlled orchestration online in remote connected mode', async () => {
    process.env.AGENT_RUNTIME_MODE = 'remote';
    process.env.RESCUE_PLAN_URL = 'http://127.0.0.1:1/api/skill-bridge/rescue-plan';
    process.env.COMPETITION_ORCHESTRATOR_URL = 'http://127.0.0.1:1/api/skill-bridge/competition';
    process.env.SCENE_CONTROL_URL = '';
    process.env.ROUTE_WATER_URL = '';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('external bridge unavailable'));

    const runtimes = await getSkillRuntimes();
    expect(runtimes.find((skill) => skill.id === 'rescue-plan')).toMatchObject({ status: 'online', mode: 'simulation' });
    expect(runtimes.find((skill) => skill.id === 'competition-orchestrator')).toMatchObject({ status: 'online', mode: 'simulation' });
  });
});
