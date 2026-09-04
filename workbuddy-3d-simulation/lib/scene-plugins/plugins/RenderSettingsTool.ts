import { Vector3 } from 'three';
import type { SoonspaceRuntime } from '@/lib/soonspace-runtime';
import { i18n } from '@/lib/i18n';
import type { PluginContext, PluginControl, PluginManifest, ScenePlugin } from '../types';

type AnyObject = Record<string, any>;
type ToneMappingType = 'None' | 'Reinhard' | 'Cineon' | 'ACESFilmic' | 'AGX' | 'Neutral';

const TONE_MAPPING_TYPES: ToneMappingType[] = ['None', 'Reinhard', 'Cineon', 'ACESFilmic', 'AGX', 'Neutral'];
const TONE_MAPPING_LABEL_KEYS: Record<ToneMappingType, string> = {
  None: 'plugin.render.toneMapping.none',
  Reinhard: 'plugin.render.toneMapping.reinhard',
  Cineon: 'plugin.render.toneMapping.cineon',
  ACESFilmic: 'plugin.render.toneMapping.acesFilmic',
  AGX: 'plugin.render.toneMapping.agx',
  Neutral: 'plugin.render.toneMapping.neutral',
};

function finiteNumber(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function coordinateDraft(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function parseRequiredNumber(value: string, field: string): number {
  const normalized = value.trim();
  if (!normalized) throw new Error(i18n('plugin.render.error.required', { field }));
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(i18n('plugin.render.error.invalid', { field }));
  return parsed;
}

export class RenderSettingsTool implements ScenePlugin {
  readonly manifest: PluginManifest = {
    id: 'render-settings',
    title: i18n('plugin.render.title'),
    activation: 'always',
    defaultOpen: false,
  };

  private ctx: PluginContext | null = null;
  private runtime: SoonspaceRuntime | null = null;
  private cps: AnyObject | null = null;
  private ssp: AnyObject | null = null;
  private atmosphereEnabled = false;
  private datetime = localDateTimeValue(new Date());
  private longitude = 120;
  private latitude = 30;
  private altitude = 20;
  private longitudeDraft = '120';
  private latitudeDraft = '30';
  private altitudeDraft = '20';
  private toneMapping: ToneMappingType = 'ACESFilmic';
  private exposure = 0.8;
  private toneMappingCustomized = false;
  private exposureCustomized = false;

  attach(ctx: PluginContext): void {
    this.ctx = ctx;
    this.runtime = ctx.getResource?.('runtime') as SoonspaceRuntime | null;
    this.cps = this.runtime?.getCps() ?? null;
    this.ssp = this.runtime?.getSsp() ?? null;
    const atmosphere = this.atmosphere;
    const gisSettings = this.cps?.metaData?.gisSettings;
    this.datetime = localDateTimeValue(atmosphere.date instanceof Date ? atmosphere.date : new Date());
    this.longitude = finiteNumber(gisSettings?.longitude, finiteNumber(atmosphere.longitude, 120));
    this.latitude = finiteNumber(gisSettings?.latitude, finiteNumber(atmosphere.latitude, 30));
    this.altitude = finiteNumber(gisSettings?.altitude, finiteNumber(atmosphere.altitude, 20));
    this.longitudeDraft = String(this.longitude);
    this.latitudeDraft = String(this.latitude);
    this.altitudeDraft = String(this.altitude);
    this.toneMappingCustomized = false;
    this.exposureCustomized = false;
  }

  enable(): void {}

  disable(): void {
    this.atmosphere.stop();
    this.atmosphereEnabled = false;
    this.applyCustomizedToneMapping();
  }

  dispose(): void {
    this.ctx = null;
    this.runtime = null;
    this.cps = null;
    this.ssp = null;
  }

  getControls(): PluginControl[] {
    return [
      { kind: 'toggle', id: 'atmosphere', label: i18n('plugin.render.atmosphere'), default: this.atmosphereEnabled },
      { kind: 'datetime', id: 'datetime', label: i18n('plugin.render.datetime'), default: this.datetime },
      { kind: 'number', id: 'longitude', label: i18n('plugin.render.longitude'), min: -180, max: 180, step: 0.000001, default: this.longitude, value: this.longitudeDraft },
      { kind: 'number', id: 'latitude', label: i18n('plugin.render.latitude'), min: -90, max: 90, step: 0.000001, default: this.latitude, value: this.latitudeDraft },
      { kind: 'number', id: 'altitude', label: i18n('plugin.render.altitude'), step: 0.1, default: this.altitude, value: this.altitudeDraft },
      { kind: 'button', id: 'applyOrigin', label: i18n('plugin.render.applyOrigin') },
      {
        kind: 'select',
        id: 'toneMapping',
        label: i18n('plugin.render.toneMapping'),
        options: TONE_MAPPING_TYPES.map((value) => ({ value, label: i18n(TONE_MAPPING_LABEL_KEYS[value]) })),
        default: this.toneMapping,
      },
      { kind: 'slider', id: 'exposure', label: i18n('plugin.render.exposure'), min: 0, max: 10, step: 0.1, default: this.exposure },
    ];
  }

  onControl(controlId: string, value: unknown): void {
    if (controlId === 'atmosphere') {
      this.setAtmosphereEnabled(Boolean(value));
      return;
    }
    if (controlId === 'datetime') {
      this.setDateTime(value);
      return;
    }
    if (controlId === 'longitude') {
      this.longitudeDraft = coordinateDraft(value, this.longitudeDraft);
      return;
    }
    if (controlId === 'latitude') {
      this.latitudeDraft = coordinateDraft(value, this.latitudeDraft);
      return;
    }
    if (controlId === 'altitude') {
      this.altitudeDraft = coordinateDraft(value, this.altitudeDraft);
      return;
    }
    if (controlId === 'applyOrigin') {
      this.applyOrigin();
      return;
    }
    if (controlId === 'toneMapping') {
      if (TONE_MAPPING_TYPES.includes(value as ToneMappingType)) {
        this.toneMapping = value as ToneMappingType;
        this.toneMappingCustomized = true;
      }
      this.applyToneMapping();
      return;
    }
    if (controlId === 'exposure') {
      this.exposure = Math.min(10, Math.max(0, finiteNumber(value, this.exposure)));
      this.exposureCustomized = true;
      this.applyToneMapping();
    }
  }

  private get atmosphere(): AnyObject {
    const atmosphere = this.cps?.atmospherePlugin;
    if (!atmosphere) throw new Error(i18n('plugin.render.error.atmosphereUnavailable'));
    return atmosphere;
  }

  private setAtmosphereEnabled(enabled: boolean): void {
    const atmosphere = this.atmosphere;
    this.atmosphereEnabled = enabled;
    if (enabled) {
      const bounds = this.cps?.sceneGroup?.getBoundingBox?.();
      if (bounds) {
        const center = bounds.getCenter(new Vector3());
        const size = bounds.getSize(new Vector3());
        atmosphere.target.copy(center);
        atmosphere.distance = size.length();
      }
      atmosphere.start();
      atmosphere.updateModelLightingMask();
      if (!this.toneMappingCustomized) this.toneMapping = 'AGX';
      if (!this.exposureCustomized) this.exposure = 10;
    } else {
      atmosphere.stop();
      if (!this.toneMappingCustomized) this.toneMapping = 'ACESFilmic';
      if (!this.exposureCustomized) this.exposure = 0.8;
    }
    this.applyCustomizedToneMapping();
    this.ctx?.requestRender?.();
  }

  private setDateTime(value: unknown): void {
    if (typeof value !== 'string') return;
    const next = new Date(value);
    if (Number.isNaN(next.getTime())) throw new Error(i18n('plugin.render.error.datetimeInvalid'));
    this.datetime = value;
    this.atmosphere.date.setTime(next.getTime());
    this.atmosphere.neesUpdate = true;
    this.ssp?.render?.();
    this.ctx?.requestRender?.();
  }

  private applyOrigin(): void {
    const longitude = parseRequiredNumber(this.longitudeDraft, i18n('plugin.render.longitude'));
    const latitude = parseRequiredNumber(this.latitudeDraft, i18n('plugin.render.latitude'));
    const altitude = parseRequiredNumber(this.altitudeDraft, i18n('plugin.render.altitude'));
    if (longitude < -180 || longitude > 180) throw new Error(i18n('plugin.render.error.longitudeRange'));
    if (latitude < -90 || latitude > 90) throw new Error(i18n('plugin.render.error.latitudeRange'));
    if (!this.runtime) throw new Error(i18n('plugin.render.error.runtimeUnavailable'));
    this.longitude = longitude;
    this.latitude = latitude;
    this.altitude = altitude;
    this.runtime.setRenderOrigin(longitude, latitude, altitude);
    this.ctx?.requestRender?.();
  }

  private applyToneMapping(): void {
    this.ssp?.setToneMapping?.({ type: this.toneMapping, exposure: this.exposure });
    this.ssp?.render?.();
  }

  private applyCustomizedToneMapping(): void {
    if (this.toneMappingCustomized || this.exposureCustomized) this.applyToneMapping();
  }
}
