import { NextResponse } from 'next/server';
import {
  describeUStudioError,
  getSceneBootstrap,
  isEmptySceneBootstrap,
  type SceneBootstrap,
  type SceneBootstrapResponse,
} from '@/lib/ustudio';

export const dynamic = 'force-dynamic';

function summarizeBootstrap(bootstrap: SceneBootstrap) {
  return {
    sceneId: bootstrap.scene.scene_id,
    sceneName: bootstrap.scene.scene_name,
    sceneCount: bootstrap.sceneCount,
    scenes: (bootstrap.scenes ?? []).slice(0, 10).map((scene) => ({
      sceneId: scene.scene_id,
      sceneName: scene.scene_name,
    })),
  };
}

function summarizeBootstrapResponse(bootstrap: SceneBootstrapResponse) {
  if (isEmptySceneBootstrap(bootstrap)) {
    return {
      empty: true,
      message: bootstrap.message,
      sceneCount: bootstrap.sceneCount,
      scenes: [],
    };
  }
  return summarizeBootstrap(bootstrap);
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const sceneId = url.searchParams.get('sceneId') ?? undefined;
  const sceneName = url.searchParams.get('sceneName') ?? undefined;
  const requestId = `${startedAt}-${Math.random().toString(36).slice(2, 8)}`;

  console.info('[ustudio/bootstrap] request', {
    requestId,
    params: { sceneId, sceneName },
    search: url.search,
  });

  try {
    const bootstrap = await getSceneBootstrap({
      sceneId,
      sceneName,
    });

    console.info('[ustudio/bootstrap] success', {
      requestId,
      durationMs: Date.now() - startedAt,
      ...summarizeBootstrapResponse(bootstrap),
    });

    return NextResponse.json(bootstrap);
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载 ustudio 场景失败';
    const upstream = describeUStudioError(error);
    console.error('[ustudio/bootstrap] failed', {
      requestId,
      durationMs: Date.now() - startedAt,
      params: { sceneId, sceneName },
      message,
      upstream,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ message, ...(upstream ?? {}) }, { status: 500 });
  }
}
