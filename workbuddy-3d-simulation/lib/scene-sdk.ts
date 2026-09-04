import type { CustomFunctionUStudioSdk, UStudioSdk } from 'ustudio-sdk';

export type SceneSdk = CustomFunctionUStudioSdk<UStudioSdk>;

declare global {
  interface Window {
    __scene?: SceneSdk;
    __sceneId?: string;
  }
}

export function sceneSdk(): SceneSdk {
  if (typeof window === 'undefined' || !window.__scene) {
    throw new Error('场景 SDK 未就绪');
  }
  return window.__scene;
}
