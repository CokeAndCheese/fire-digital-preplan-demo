/**
 * 作战区域部署几何计算（纯函数，可单测）。
 *
 * 输入：火点场景坐标 + 可选项（警戒半径、接近方向、各楼层高度等）。
 * 输出：若干个"区域"（闭合多边形，用于停放/登高/器材/警戒）+ "路线"（进攻/三层疏散）。
 * 坐标用场景坐标系（x/y/z）。几何为**坐标生成的近似区域**（围绕火点地面投影），
 * 预留真实路面/出入口接口，后续数据补上即可替换 `generateZoneDeploy` 的几何来源。
 */

import type { Point3, SimulationAction } from './contracts';

export type ZoneId = 'parking' | 'aerial' | 'equipment' | 'cordon';

export type DeployZone = {
  id: ZoneId;
  name: string;
  /** 闭合多边形顶点（首尾相连） */
  polygon: Point3[];
  color: string;
  kind: 'area';
};

export type DeployRoute = {
  id: 'attack' | 'interior_attack' | 'evacuation_fire' | 'evacuation_above' | 'evacuation_below' | 'main_route' | 'backup_route';
  name: string;
  path: Point3[];
  color: string;
};

export type ZoneDeploy = {
  firePoint: Point3;
  groundZ: number;
  zones: DeployZone[];
  routes: DeployRoute[];
};

export type ZoneDeployOptions = {
  /** 地面高度 z（缺省用 firePoint.z） */
  groundZ?: number;
  /** 警戒区半径（米/场景单位），默认 60 */
  cordonRadius?: number;
  /** 接近方向（角度，度）。默认 0（正东）指火点停放/作业面的主方向。 */
  approachDeg?: number;
  /** 着火层 / 上层 / 下层 的高度（z）。缺省用 firePoint.z 推算。 */
  floorZ?: { fire?: number; above?: number; below?: number };
  /** 每个区域的大小，默认矩形。 */
  zoneSize?: { parkingW?: number; parkingD?: number; aerialW?: number; aerialD?: number; equipmentW?: number; equipmentD?: number };
};

const deg2rad = (d: number): number => (d * Math.PI) / 180;

/** 绕 (cx,cy) 旋转一个点，供"接近方向"控制区域朝向。 */
function rotate(px: number, py: number, cx: number, cy: number, deg: number): [number, number] {
  const a = deg2rad(deg);
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
}

/** 生成一个以 (cx,cy) 为中心、宽 w 深 d 的矩形（闭合多边形），按 approachDeg 旋转。 */
function rectCentered(cx: number, cy: number, z: number, w: number, d: number, deg: number, offset = 0): Point3[] {
  const hw = w / 2;
  const hd = d / 2;
  const corners: [number, number][] = [
    [cx - hw, cy - hd],
    [cx + hw, cy - hd],
    [cx + hw, cy + hd],
    [cx - hw, cy + hd],
  ];
  return corners.map(([px, py]) => {
    const [rx, ry] = rotate(px, py, cx, cy, deg);
    return { x: rx + offset, y: ry, z };
  });
}

/** 圆近似多边形（警戒区）。 */
function circle(cx: number, cy: number, z: number, r: number, segments = 16): Point3[] {
  const pts: Point3[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), z });
  }
  return pts;
}

/**
 * 生成作战区域部署。
 * @param firePoint 火点场景坐标（地面投影取 x/y，z 用 groundZ 或火点 z）
 * @param options 可选项；缺省用合理默认。
 */
export function generateZoneDeploy(firePoint: Point3, options: ZoneDeployOptions = {}): ZoneDeploy {
  const groundZ = options.groundZ ?? firePoint.z;
  const approachDeg = options.approachDeg ?? 0;
  const cordonRadius = options.cordonRadius ?? 60;
  const size = options.zoneSize ?? {};
  const parkingW = size.parkingW ?? 18;
  const parkingD = size.parkingD ?? 10;
  const aerialW = size.aerialW ?? 14;
  const aerialD = size.aerialD ?? 8;
  const equipmentW = size.equipmentW ?? 12;
  const equipmentD = size.equipmentD ?? 6;

  const cx = firePoint.x;
  const cy = firePoint.y;

  // 停放区（最近路面近似）：放在火点前方，沿接近方向。
  const parking = rectCentered(cx, cy, groundZ, parkingW, parkingD, approachDeg, parkingD * 0.5 + 6);
  // 登高作业面：靠近火点一侧（消防车登高），略小。
  const aerial = rectCentered(cx, cy, groundZ, aerialW, aerialD, approachDeg, aerialD * 0.5 + 1);
  // 器材摆放区：停放区旁。
  const equipment = rectCentered(cx, cy, groundZ, equipmentW, equipmentD, approachDeg, -parkingD * 0.5 - 4);
  // 警戒区：以火点为中心的半径圆。
  const cordon = circle(cx, cy, groundZ, cordonRadius);

  const floorZ = options.floorZ ?? {
    fire: firePoint.z,
    above: firePoint.z + 4,
    below: Math.max(0, firePoint.z - 4),
  };

  // 进攻路线：停放区中心 → 火点地面投影。
  const parkingCenter = rectCentered(cx, cy, groundZ, 0.001, 0.001, 0, parkingD * 0.5 + 6)[0];
  const attack: Point3[] = [
    { x: parkingCenter.x, y: parkingCenter.y, z: groundZ },
    { x: cx, y: cy, z: groundZ },
  ];

  // 疏散路线（着火层/上层/下层）：各层从火点 x/y 沿接近方向反向到一个"出口"点，再回落地面。
  const evacPath = (z: number, dir: number, offset: number): Point3[] => {
    const exit = rotate(cx, cy, cx, cy, approachDeg + dir);
    // 出口点在该层
    const exitFloor = { x: exit[0] + offset, y: exit[1] + offset, z };
    // 出口点在地面
    const exitGround = { x: exitFloor.x, y: exitFloor.y, z: groundZ };
    const start = { x: cx, y: cy, z };
    return [start, exitFloor, exitGround];
  };

  const zones: DeployZone[] = [
    { id: 'parking', name: '车辆停放区', polygon: parking, color: '#2FD4BF', kind: 'area' },
    { id: 'aerial', name: '登高作业面', polygon: aerial, color: '#5AA9E6', kind: 'area' },
    { id: 'equipment', name: '器材摆放区', polygon: equipment, color: '#F0B34A', kind: 'area' },
    { id: 'cordon', name: '警戒区', polygon: cordon, color: '#FF5B60', kind: 'area' },
  ];

  const { mainRoute, backupRoute } = demoAttackRoutes(cx, cy, groundZ, approachDeg, parkingD * 0.5 + 6);

  // 内攻路线（高层内攻通行做法）：停放区集合 → 起火层下一层集结点 → 沿楼梯上至起火层出枪阵地（室内消火栓）。
  // 体现"车不进楼、内攻沿楼梯至起火层下一层设集结点、再向起火层推进、出枪阵地=起火层室内消火栓"。
  const stagingBelowZ = floorZ.below ?? Math.max(0, firePoint.z - 4);
  const fireZ = floorZ.fire ?? firePoint.z;
  const stagingPoint = rotate(cx, cy, cx, cy, approachDeg + 20);
  const interiorAttack: Point3[] = [
    { x: parkingCenter.x, y: parkingCenter.y, z: groundZ },
    { x: stagingPoint[0], y: stagingPoint[1], z: stagingBelowZ },   // 起火层下一层集结点
    { x: stagingPoint[0] * 0.92 + cx * 0.08, y: stagingPoint[1] * 0.92 + cy * 0.08, z: stagingBelowZ }, // 楼梯间转点
    { x: cx, y: cy, z: fireZ },                                      // 起火层出枪阵地（室内消火栓）
  ];

  const routes: DeployRoute[] = [
    { id: 'attack', name: '进攻路线', path: attack, color: '#2FD4BF' },
    { id: 'interior_attack', name: '内攻路线（集结点→起火层出枪阵地）', path: interiorAttack, color: '#2FD4BF' },
    { id: 'evacuation_fire', name: '着火层疏散路线', path: evacPath(floorZ.fire ?? firePoint.z, 180, 10), color: '#28C76F' },
    { id: 'evacuation_above', name: '着火层上层疏散路线', path: evacPath(floorZ.above ?? firePoint.z + 4, 180, 14), color: '#28C76F' },
    { id: 'evacuation_below', name: '着火层下层疏散路线', path: evacPath(floorZ.below ?? Math.max(0, firePoint.z - 4), 180, 18), color: '#28C76F' },
    // 演示版主/备进攻路线：坐标近似（无真实路网）。主路线=停车点→进攻入口→火点；备用路线=另一集结点绕行。
    { id: 'main_route', name: '主路线', path: mainRoute, color: '#2FD4BF' },
    { id: 'backup_route', name: '备用路线', path: backupRoute, color: '#F0B34A' },
  ];

  return { firePoint, groundZ, zones, routes };
}

/** 生成演示版主/备进攻路线（坐标近似，非真实路网）。 */
function demoAttackRoutes(cx: number, cy: number, groundZ: number, approachDeg: number, parkingOffset: number): { mainRoute: Point3[]; backupRoute: Point3[] } {
  // 停车点：火点沿接近方向前方 parkingOffset 处（地面投影）
  const park = rotate(cx, cy, cx, cy, approachDeg);
  const parkX = cx + (park[0] - cx);
  const parkY = cy + (park[1] - cy) + parkingOffset;
  // 主路线：停车点 → 侧向拐点 → 火点地面投影
  const turn1 = rotate(parkX, parkY, cx, cy, approachDeg + 38);
  const mainRoute: Point3[] = [
    { x: parkX, y: parkY, z: groundZ },
    { x: turn1[0], y: turn1[1], z: groundZ },
    { x: cx, y: cy, z: groundZ },
  ];
  // 备用路线：另一侧集结点 → 反向拐点 → 火点地面投影
  const altStart = rotate(cx, cy, cx, cy, approachDeg + 180);
  const altX = cx + (altStart[0] - cx) - parkingOffset;
  const altY = cy + (altStart[1] - cy);
  const altTurn = rotate(altX, altY, cx, cy, approachDeg + 142);
  const backupRoute: Point3[] = [
    { x: altX, y: altY, z: groundZ },
    { x: altTurn[0], y: altTurn[1], z: groundZ },
    { x: cx, y: cy, z: groundZ },
  ];
  return { mainRoute, backupRoute };
}

/** 闭合多边形：把首点复制到末尾，使 drawRoute 画出的折线视觉闭合。 */
function closePolygon(points: Point3[]): Point3[] {
  if (points.length < 3) return points;
  return [...points, { ...points[0] }];
}

/**
 * 把 ZoneDeploy 转成可绘制动作（全部复用 DRAW_ROUTE）：
 * - 区域：closed polygon（routeKey=`zone:<id>`）
 * - 路线：open path（routeKey=`route:<id>`）
 * 供推演控制器/适配器在三维里绘制。
 */
export function zoneDeployToActions(deploy: ZoneDeploy): SimulationAction[] {
  const actions: SimulationAction[] = [];
  for (const zone of deploy.zones) {
    actions.push({
      type: 'DRAW_ROUTE',
      routeKey: `zone:${zone.id}`,
      routeName: zone.name,
      color: zone.color,
      points: closePolygon(zone.polygon),
    });
  }
  for (const route of deploy.routes) {
    actions.push({
      type: 'DRAW_ROUTE',
      routeKey: `route:${route.id}`,
      routeName: route.name,
      color: route.color,
      points: route.path,
    });
  }
  return actions;
}
