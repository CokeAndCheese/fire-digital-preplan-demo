import { describe, expect, it } from 'vitest';
import { generateZoneDeploy, zoneDeployToActions } from '../index';

describe('zone deploy - 生成作战区域', () => {
  it('生成 4 个区域（停放/登高/器材/警戒）', () => {
    const dep = generateZoneDeploy({ x: 100, y: 200, z: 3 });
    expect(dep.zones).toHaveLength(4);
    expect(dep.zones.map((z) => z.id)).toEqual(['parking', 'aerial', 'equipment', 'cordon']);
    // 每个区域都是闭合多边形（>=3 顶点）
    dep.zones.forEach((z) => expect(z.polygon.length).toBeGreaterThanOrEqual(3));
  });

  it('警戒区是圆（近似多边形），半径受 cordonRadius 控制', () => {
    const dep = generateZoneDeploy({ x: 0, y: 0, z: 0 }, { cordonRadius: 80 });
    const cordon = dep.zones.find((z) => z.id === 'cordon')!;
    expect(cordon.polygon.length).toBe(16);
    // 半径 80：任意顶点到中心距离约为 80
    cordon.polygon.forEach((p) => {
      const d = Math.hypot(p.x - 0, p.y - 0);
      expect(d).toBeCloseTo(80, 5);
    });
  });

  it('进攻路线从停放区到火点地面投影', () => {
    const dep = generateZoneDeploy({ x: 100, y: 100, z: 5 });
    const attack = dep.routes.find((r) => r.id === 'attack')!;
    expect(attack.path.length).toBeGreaterThanOrEqual(2);
    // 终点是火点地面投影
    expect(attack.path[attack.path.length - 1].x).toBe(100);
    expect(attack.path[attack.path.length - 1].y).toBe(100);
  });

  it('生成 3 条疏散路线（着火层/上/下）', () => {
    const dep = generateZoneDeploy({ x: 0, y: 0, z: 12 }, { groundZ: 0, floorZ: { fire: 12, above: 16, below: 8 } });
    const evac = dep.routes.filter((r) => r.id.startsWith('evacuation'));
    expect(evac).toHaveLength(3);
    expect(evac.map((r) => r.id)).toEqual(['evacuation_fire', 'evacuation_above', 'evacuation_below']);
    // 每条疏散路线起点在对应层(z)，终点回落到地面
    const fire = evac.find((r) => r.id === 'evacuation_fire')!;
    expect(fire.path[0].z).toBe(12);
    expect(fire.path[fire.path.length - 1].z).toBe(0);
  });

  it('生成演示版主路线与备用路线（独立路径）', () => {
    const dep = generateZoneDeploy({ x: 10, y: 10, z: 0 });
    const main = dep.routes.find((r) => r.id === 'main_route')!;
    const backup = dep.routes.find((r) => r.id === 'backup_route')!;
    expect(main).toBeTruthy();
    expect(backup).toBeTruthy();
    expect(main.path.length).toBeGreaterThanOrEqual(2);
    expect(backup.path.length).toBeGreaterThanOrEqual(2);
    // 主/备路线终点都是火点地面投影
    expect(main.path[main.path.length - 1]).toEqual({ x: 10, y: 10, z: 0 });
    expect(backup.path[backup.path.length - 1]).toEqual({ x: 10, y: 10, z: 0 });
    // 主/备路线不同源（起点不同），是独立路径
    expect(main.path[0]).not.toEqual(backup.path[0]);
  });

  it('各区域颜色与标识稳定', () => {
    const dep = generateZoneDeploy({ x: 10, y: 20, z: 0 });
    expect(dep.zones.find((z) => z.id === 'parking')!.color).toBe('#2FD4BF');
    expect(dep.zones.find((z) => z.id === 'cordon')!.color).toBe('#FF5B60');
    expect(dep.routes.find((r) => r.id === 'attack')!.color).toBe('#2FD4BF');
  });
});

describe('zone deploy - 转可绘制动作', () => {
  it('区域生成闭合多边形(首尾同点)，路线生成开放路径，全部 DRAW_ROUTE', () => {
    const dep = generateZoneDeploy({ x: 50, y: 60, z: 2 });
    const actions = zoneDeployToActions(dep);
    expect(actions.length).toBe(dep.zones.length + dep.routes.length); // 4 + 4 = 8
    expect(actions.every((a) => a.type === 'DRAW_ROUTE')).toBe(true);
    // 区域多边形：首尾同点（闭合）
    const parking = actions.find((a) => a.type === 'DRAW_ROUTE' && a.routeKey === 'zone:parking') as
      { type: 'DRAW_ROUTE'; routeKey: string; points: Array<{ x: number; y: number; z: number }> } | undefined;
    expect(parking).toBeTruthy();
    expect(parking!.points.length).toBe(dep.zones.find((z) => z.id === 'parking')!.polygon.length + 1);
    expect(parking!.points[0]).toEqual(parking!.points[parking!.points.length - 1]);
    // routeKey 前缀区分区域/路线
    expect(actions.some((a) => a.type === 'DRAW_ROUTE' && (a as { routeKey?: string }).routeKey?.startsWith('zone:'))).toBe(true);
    expect(actions.some((a) => a.type === 'DRAW_ROUTE' && (a as { routeKey?: string }).routeKey?.startsWith('route:'))).toBe(true);
  });
});
