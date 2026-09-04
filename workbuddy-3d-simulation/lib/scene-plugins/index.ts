export * from './types';
export { PluginManager } from './PluginManager';
export { localStoragePersistence } from './persistence';
export { UStudioSceneTool } from './plugins/UStudioSceneTool';
export { RenderSettingsTool } from './plugins/RenderSettingsTool';

import type { ScenePlugin } from './types';
import { UStudioSceneTool } from './plugins/UStudioSceneTool';
import { RenderSettingsTool } from './plugins/RenderSettingsTool';

export function createDefaultPlugins(): ScenePlugin[] {
  return [new UStudioSceneTool(), new RenderSettingsTool()];
}
