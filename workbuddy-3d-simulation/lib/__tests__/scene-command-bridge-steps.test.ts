import { describe, expect, it } from 'vitest';
import { createSimulationRun, WUKUANG_SCENE_ID } from '../scene-command-bridge';

/**
 * 回归：桥接曾写死 8 步（mappings.length !== 8 拒绝 + 自带 8 步列表），
 * 而指挥端 11 步推演法预案只能拿到 8 个 stepId 回执，
 * 生命周期门禁要求回执精确覆盖全部步骤，导致签发与导出永久阻断。
 */
const ELEVEN_STEP_ACTION_IDS = [
  'receive_incident', 'lock_spatial_target', 'show_fire_partition', 'analyze_spread_risk',
  'select_attack_entry', 'select_water_source', 'draw_primary_route', 'draw_backup_route',
  'show_force_composition', 'sync_timeline', 'review_issue_export_reset',
];

const EIGHT_STEP_ACTION_IDS = [
  'receive_incident', 'lock_spatial_target', 'show_fire_partition', 'analyze_spread_risk',
  'confirm_operational_area', 'show_force_composition', 'sync_timeline', 'review_issue_export_reset',
];

function mappingsFor(planId: string, actionIds: string[]) {
  return actionIds.map((actionId, index) => ({
    stepId: `${planId}:step-${String(index + 1).padStart(2, '0')}`,
    sequence: index + 1,
    title: `步骤${index + 1}`,
    actionId,
  }));
}

describe('scene command bridge step construction', () => {
  it('builds every step of an 11-step plan so the receipt can cover all stepIds', () => {
    const run = createSimulationRun({
      planId: 'PLAN-11',
      sceneId: WUKUANG_SCENE_ID,
      mappings: mappingsFor('PLAN-11', ELEVEN_STEP_ACTION_IDS),
    });
    expect(run.plan.steps).toHaveLength(11);
    expect(run.plan.steps.map((step) => step.id)).toEqual(
      mappingsFor('PLAN-11', ELEVEN_STEP_ACTION_IDS).map((mapping) => mapping.stepId),
    );
    const codes = run.plan.steps.map((step) => step.code);
    expect(new Set(codes).size).toBe(11);
    expect(codes).toContain('SELECT_WATER_SOURCE');
    expect(codes).toContain('DRAW_PRIMARY_ROUTE');
    expect(codes).toContain('DRAW_BACKUP_ROUTE');
  });

  it('still maps the legacy 8-step library without duplicate fallback codes', () => {
    const run = createSimulationRun({
      planId: 'PLAN-8',
      sceneId: WUKUANG_SCENE_ID,
      mappings: mappingsFor('PLAN-8', EIGHT_STEP_ACTION_IDS),
    });
    expect(run.plan.steps).toHaveLength(8);
    const codes = run.plan.steps.map((step) => step.code);
    expect(new Set(codes).size).toBe(8);
    expect(codes[4]).toBe('SELECT_STAGING_ENTRY');
  });

  it('orders steps by sequence regardless of incoming order', () => {
    const shuffled = [...mappingsFor('PLAN-S', ELEVEN_STEP_ACTION_IDS)].reverse();
    const run = createSimulationRun({ planId: 'PLAN-S', sceneId: WUKUANG_SCENE_ID, mappings: shuffled });
    expect(run.plan.steps.map((step) => step.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(run.plan.steps[0].code).toBe('ALARM_RECEIVED');
  });
});
