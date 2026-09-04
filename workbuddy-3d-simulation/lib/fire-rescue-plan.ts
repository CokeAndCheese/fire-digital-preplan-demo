/**
 * 灭火救援预案生成逻辑
 *
 * 纯本地规则引擎，根据现场态势秒级生成结构化预案。
 * 不涉及外部 AI 服务，保证响应时间和可离线使用。
 */

export type FireSituation = {
  floorId: string;
  floorName: string;
  roomId: string;
  roomName: string;
  fireLocation: string;
  trappedCount: number;
  burnArea: number;
};

export type RiskLevel = 'low' | 'medium' | 'high' | 'urgent';

export type DeploymentUnit = {
  name: string;
  count: number;
  task: string;
};

export type TimelineStep = {
  minute: number;
  action: string;
};

export type FireRescuePlan = {
  id: string;
  buildingName: string;
  title: string;
  createdAt: string;
  riskLevel: RiskLevel;
  riskLevelText: string;
  situation: FireSituation;
  deployments: DeploymentUnit[];
  fireStrategy: string;
  priorities: string[];
  timeline: TimelineStep[];
  signedAt?: string;
  signedBy?: string;
};

export function riskLevelFrom(burnArea: number, trappedCount: number): RiskLevel {
  if (burnArea >= 100 || trappedCount >= 20) return 'urgent';
  if (burnArea >= 50 || trappedCount >= 10) return 'high';
  if (burnArea >= 20 || trappedCount >= 3) return 'medium';
  return 'low';
}

export function riskLevelText(level: RiskLevel): string {
  switch (level) {
    case 'urgent':
      return '极高';
    case 'high':
      return '高';
    case 'medium':
      return '中';
    case 'low':
      return '低';
  }
}

export function riskBadgeClass(level: RiskLevel): string {
  switch (level) {
    case 'urgent':
      return 'badge-urgent';
    case 'high':
      return 'badge-high';
    case 'medium':
      return 'badge-medium';
    case 'low':
      return 'badge-low';
  }
}

export function generatePlanId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function generateRescuePlan(
  situation: FireSituation,
  buildingName = '五矿国际广场',
): FireRescuePlan {
  const { floorName, roomName, fireLocation, trappedCount, burnArea } = situation;
  const riskLevel = riskLevelFrom(burnArea, trappedCount);

  const deployments: DeploymentUnit[] = [
    {
      name: '水枪组',
      count: riskLevel === 'urgent' ? 3 : riskLevel === 'high' ? 2 : 1,
      task: '内攻灭火、压制火点',
    },
    {
      name: '搜救组',
      count: trappedCount > 0 ? (trappedCount >= 10 ? 2 : 1) : 0,
      task: '疏散被困人员、协助转移',
    },
    {
      name: '破拆组',
      count: riskLevel === 'urgent' || riskLevel === 'high' ? 1 : 0,
      task: '开辟通道、排除障碍',
    },
    {
      name: '排烟照明组',
      count: 1,
      task: '排烟散热、现场照明',
    },
    {
      name: '警戒组',
      count: 1,
      task: '外围警戒、引导增援',
    },
  ].filter((u) => u.count > 0);

  const priorities: string[] = [];
  if (trappedCount > 0) priorities.push('人员搜救');
  priorities.push('火势控制');
  if (burnArea >= 30) priorities.push('排烟散热');
  priorities.push('财产保护');
  if (riskLevel === 'urgent') priorities.push('防止蔓延');

  const strategyParts: string[] = [];
  if (fireLocation.includes('电气') || fireLocation.includes('电')) {
    strategyParts.push('先断电后灭火，避免用水直接扑救带电部位');
  } else {
    strategyParts.push('内部强攻近战，快速压制明火');
  }
  if (burnArea >= 50) {
    strategyParts.push('大面积燃烧时采用堵截包围、分段消灭战术');
  }
  if (trappedCount > 0) {
    strategyParts.push('搜救与灭火同步展开，优先确保人员安全');
  }
  if (riskLevel === 'urgent') {
    strategyParts.push('启动全楼应急广播，请求增援力量');
  }

  const timeline: TimelineStep[] = [
    { minute: 0, action: '接警并高亮起火房间，锁定救援入口' },
    { minute: 2, action: `${floorName}救援组抵达${roomName}作业面` },
    { minute: 4, action: trappedCount > 0 ? '搜救组进入房间疏散被困人员' : '水枪组内攻压制火点' },
    { minute: 6, action: '扑灭明火并启动排烟散热' },
    { minute: 8, action: '复查阴燃、移交现场' },
  ];

  return {
    id: generatePlanId(),
    buildingName,
    title: `${buildingName} ${floorName} · ${roomName} 灭火救援预案`,
    createdAt: new Date().toISOString(),
    riskLevel,
    riskLevelText: riskLevelText(riskLevel),
    situation,
    deployments,
    fireStrategy: strategyParts.join('；'),
    priorities,
    timeline,
  };
}

export function signPlan(plan: FireRescuePlan, signedBy = '值班指挥员'): FireRescuePlan {
  return {
    ...plan,
    signedAt: new Date().toISOString(),
    signedBy,
  };
}
