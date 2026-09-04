import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadI18n(locale: 'zh' | 'en') {
  vi.stubEnv('NEXT_PUBLIC_LOCALE', locale);
  vi.resetModules();
  return import('../i18n');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('render settings i18n', () => {
  it('provides complete Chinese labels and errors', async () => {
    const { i18n } = await loadI18n('zh');

    expect({
      title: i18n('plugin.render.title'),
      atmosphere: i18n('plugin.render.atmosphere'),
      datetime: i18n('plugin.render.datetime'),
      longitude: i18n('plugin.render.longitude'),
      latitude: i18n('plugin.render.latitude'),
      altitude: i18n('plugin.render.altitude'),
      applyOrigin: i18n('plugin.render.applyOrigin'),
      toneMapping: i18n('plugin.render.toneMapping'),
      exposure: i18n('plugin.render.exposure'),
      noToneMapping: i18n('plugin.render.toneMapping.none'),
      neutralToneMapping: i18n('plugin.render.toneMapping.neutral'),
      atmosphereUnavailable: i18n('plugin.render.error.atmosphereUnavailable'),
      datetimeInvalid: i18n('plugin.render.error.datetimeInvalid'),
      runtimeUnavailable: i18n('plugin.render.error.runtimeUnavailable'),
    }).toEqual({
      title: '渲染设置',
      atmosphere: '开启大气',
      datetime: '日期和时间',
      longitude: '经度',
      latitude: '纬度',
      altitude: '高程',
      applyOrigin: '应用坐标',
      toneMapping: '色调',
      exposure: '曝光',
      noToneMapping: '无',
      neutralToneMapping: '中性',
      atmosphereUnavailable: '大气效果未就绪',
      datetimeInvalid: '日期时间格式无效',
      runtimeUnavailable: 'SoonSpace 运行时未就绪',
    });
  });

  it('provides complete English labels and errors', async () => {
    const { i18n } = await loadI18n('en');

    expect({
      title: i18n('plugin.render.title'),
      atmosphere: i18n('plugin.render.atmosphere'),
      datetime: i18n('plugin.render.datetime'),
      longitude: i18n('plugin.render.longitude'),
      latitude: i18n('plugin.render.latitude'),
      altitude: i18n('plugin.render.altitude'),
      applyOrigin: i18n('plugin.render.applyOrigin'),
      toneMapping: i18n('plugin.render.toneMapping'),
      exposure: i18n('plugin.render.exposure'),
      noToneMapping: i18n('plugin.render.toneMapping.none'),
      neutralToneMapping: i18n('plugin.render.toneMapping.neutral'),
      atmosphereUnavailable: i18n('plugin.render.error.atmosphereUnavailable'),
      datetimeInvalid: i18n('plugin.render.error.datetimeInvalid'),
      runtimeUnavailable: i18n('plugin.render.error.runtimeUnavailable'),
    }).toEqual({
      title: 'Render Settings',
      atmosphere: 'Enable atmosphere',
      datetime: 'Date and time',
      longitude: 'Longitude',
      latitude: 'Latitude',
      altitude: 'Altitude',
      applyOrigin: 'Apply coordinates',
      toneMapping: 'Tone Mapping',
      exposure: 'Exposure',
      noToneMapping: 'None',
      neutralToneMapping: 'Neutral',
      atmosphereUnavailable: 'Atmosphere is not ready',
      datetimeInvalid: 'Date and time format is invalid',
      runtimeUnavailable: 'SoonSpace runtime is not ready',
    });
  });
});
