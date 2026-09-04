import { describe, expect, it } from 'vitest';
import {
  collectEquipmentObjectIds,
  collectWaterSourceObjectIds,
  extractScenePosition,
  parsePathPoints,
  parsePoint,
} from '../index';

describe('scene route resolver - 单点解析', () => {
  it('解析 {x,y,z}', () => {
    expect(parsePoint({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 });
  });
  it('解析 [x,y,z]', () => {
    expect(parsePoint([1, 2, 3])).toEqual({ x: 1, y: 2, z: 3 });
  });
  it('解析 "x&y&z" 字符串', () => {
    expect(parsePoint('18.23&13.00&0.82')).toEqual({ x: 18.23, y: 13, z: 0.82 });
  });
  it('解析 {longitude,latitude}', () => {
    expect(parsePoint({ longitude: 109.5, latitude: 18.2 })).toEqual({ x: 109.5, y: 18.2, z: 0 });
  });
  it('空/非法返回 null', () => {
    expect(parsePoint(null)).toBeNull();
    expect(parsePoint('abc')).toBeNull();
  });
});

describe('scene route resolver - 路径解析', () => {
  it('解析 result.path 嵌套路径', () => {
    const payload = { result: { path: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 5, z: 0 }, { x: 20, y: 0, z: 0 }] } };
    expect(parsePathPoints(payload)).toHaveLength(3);
  });
  it('解析 data.points 数组', () => {
    const payload = { data: { points: [[0, 0, 0], [1, 1, 1]] } };
    expect(parsePathPoints(payload)).toHaveLength(2);
  });
  it('解析 data.route 数组', () => {
    const payload = { data: { route: [{ x: 0, y: 0 }, { x: 2, y: 3 }, { x: 4, y: 1 }] } };
    expect(parsePathPoints(payload)).toHaveLength(3);
  });
  it('路径点不足 2 个返回 null', () => {
    const payload = { result: { path: [{ x: 0, y: 0 }] } };
    expect(parsePathPoints(payload)).toBeNull();
  });
  it('非法载荷返回 null', () => {
    expect(parsePathPoints('bad')).toBeNull();
    expect(parsePathPoints({})).toBeNull();
  });
});

describe('scene route resolver - 节点坐标', () => {
  it('优先使用 position', () => {
    expect(extractScenePosition({ position: { x: 5, y: 6, z: 7 }, centroid: { x: 1, y: 1 } })).toEqual({ x: 5, y: 6, z: 7 });
  });
  it('回退 centroid', () => {
    expect(extractScenePosition({ centroid: { x: 1, y: 2, z: 3 } })).toEqual({ x: 1, y: 2, z: 3 });
  });
  it('回退 x/y/z', () => {
    expect(extractScenePosition({ x: 9, y: 8, z: 7 })).toEqual({ x: 9, y: 8, z: 7 });
  });
});

describe('scene route resolver - 设备本体筛选', () => {
  const tree = {
    id: 'building-out',
    name: '五矿国际广场',
    type: 'Building',
    children: [
      {
        id: 'story-20',
        name: '20F',
        type: 'Story',
        children: [
          { id: 'room-20f-1', name: '机房1', type: 'Space' },
          { id: 'hydrant-01', name: '室外消火栓', type: 'Hydrant' },
          { id: 'pump-01', name: '水泵接合器', type: 'SiameseConnection' },
          { id: 'alarm-01', name: '感烟报警器', type: 'Alarm' },
        ],
      },
    ],
  };
  it('按类型/名称关键字筛出消火栓、水泵接合器，忽略无关对象', () => {
    const ids = collectEquipmentObjectIds(tree as never);
    expect(ids).toContain('hydrant-01');
    expect(ids).toContain('pump-01');
    expect(ids).not.toContain('alarm-01');
    expect(ids).not.toContain('room-20f-1');
  });
  it('去重', () => {
    const dupe = { id: 'a', name: '消火栓', type: 'Hydrant', children: [{ id: 'a', name: '消火栓', type: 'Hydrant' }] };
    expect(collectEquipmentObjectIds(dupe as never)).toEqual(['a']);
  });
});

describe('scene route resolver - 水源本体筛选', () => {
  it('仅命中供水类本体，排除消火栓按钮与无关设备', () => {
    const tree = {
      id: 'root',
      name: '五矿国际广场-新',
      type: 'Site',
      children: [
        { id: 'oh-01', name: '室外消火栓', type: 'OutdoorFireHydrant' },
        { id: 'ih-01', name: '室内消火栓', type: 'IndoorFireHydrant' },
        { id: 'pa-01', name: '水泵接合器', type: 'PumpAdapter' },
        { id: 'tank-01', name: '消防水箱', type: 'FireWaterTank' },
        { id: 'ws-01', name: '水源地', type: 'WaterSource' },
        { id: 'btn-01', name: '室内消火栓', type: 'HydrantButton' },
        { id: 'btn-02', name: '消火栓按钮', type: 'HydrantButton' },
        { id: 'light-01', name: '消防应急照明灯具', type: 'EmergencyLightingFixture' },
        { id: 'sign-01', name: '疏散标志灯', type: 'EvacuationSignLight' },
        { id: 'cam-01', name: '枪机摄像机', type: 'BulletCamera' },
      ],
    };
    const ids = collectWaterSourceObjectIds(tree as never);
    expect(ids).toContain('oh-01');
    expect(ids).toContain('ih-01');
    expect(ids).toContain('pa-01');
    expect(ids).toContain('tank-01');
    expect(ids).toContain('ws-01');
    // 消火栓按钮/触发器不是取水水源，排除
    expect(ids).not.toContain('btn-01');
    expect(ids).not.toContain('btn-02');
    // 无关设备排除
    expect(ids).not.toContain('light-01');
    expect(ids).not.toContain('sign-01');
    expect(ids).not.toContain('cam-01');
  });
});
