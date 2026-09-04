import { SoonspaceSceneViewer } from '@/components/SoonspaceSceneViewer';
import { MultiAgentWidget } from '@/components/MultiAgentWidget';
import { FireSimulationPanel } from '@/components/fire-simulation';
import { SceneDeployRunner } from '@/components/fire-simulation/SceneDeployRunner';
import { getRuntimeConfig } from '@/lib/app-key';

export const dynamic = 'force-dynamic';

export default function Page() {
  const runtimeConfig = getRuntimeConfig();
  const fallbackText = runtimeConfig.locale === 'en-US'
    ? {
        title: 'Loading preview...',
        detail: 'Preparing scene runtime...',
      }
    : {
        title: '正在加载预览画面...',
        detail: '正在准备场景运行时...',
      };
  return (
    <>
      <div id="jarvis-preview-fallback" className="previewServerFallback" role="status" aria-live="polite">
        <div className="previewServerFallback__panel">
          <div className="previewServerFallback__title">{fallbackText.title}</div>
          <div className="previewServerFallback__bar" aria-hidden>
            <span />
          </div>
          <div className="previewServerFallback__detail">{fallbackText.detail}</div>
        </div>
      </div>
      <SoonspaceSceneViewer runtimeConfig={runtimeConfig} />
      <FireSimulationPanel minimal />
      <SceneDeployRunner />
      <MultiAgentWidget runtimeConfig={runtimeConfig} />
    </>
  );
}
