import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSceneBootstrap, isEmptySceneBootstrap } from '../ustudio';

function apiResponse(result: unknown): Response {
  return new Response(JSON.stringify({
    success: true,
    code: '0000',
    message: 'success',
    result,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getSceneBootstrap', () => {
  it('falls back to the first available scene when the requested scene was deleted', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(apiResponse([
        { scene_id: 'scene-current', scene_name: 'Current scene' },
        { scene_id: 'scene-other', scene_name: 'Other scene' },
      ]));
    vi.stubGlobal('fetch', fetchMock);

    const bootstrap = await getSceneBootstrap({ sceneId: 'scene-deleted' });

    expect(isEmptySceneBootstrap(bootstrap)).toBe(false);
    if (isEmptySceneBootstrap(bootstrap)) return;
    expect(bootstrap.scene.scene_id).toBe('scene-current');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({});
  });

  it('returns an empty bootstrap without requesting details when all scenes were deleted', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(apiResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    const bootstrap = await getSceneBootstrap({ sceneId: 'scene-deleted' });

    expect(isEmptySceneBootstrap(bootstrap)).toBe(true);
    expect(bootstrap.sceneCount).toBe(0);
    expect(bootstrap.scenes).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
