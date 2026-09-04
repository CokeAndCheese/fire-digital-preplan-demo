export type GeneratedPanelInfo = {
  id: string;
  name: string;
  aliases?: string[];
  domId: string;
  description: string;
};

export const GENERATED_PANELS: GeneratedPanelInfo[] = [
  {
    id: 'fire-rescue-plan',
    name: '灭火救援预案生成',
    aliases: ['灭火救援', '救援预案', '预案生成', 'Fire Rescue Plan'],
    domId: 'panel-fire-rescue-plan',
    description:
      '选择楼层房间并录入起火位置、被困人数、燃烧面积，秒级生成可签发的灭火救援预案，支持 3D 推演。',
  },
];
