import { NextResponse } from 'next/server';
import { getConnectivitySceneEdges } from '@/lib/ustudio';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      sceneId?: string;
      storyNodeIds?: string[];
      spaceId?: string;
    };
    const edges = await getConnectivitySceneEdges({
      sceneId: body.sceneId,
      storyNodeIds: Array.isArray(body.storyNodeIds) ? body.storyNodeIds : [],
      spaceId: body.spaceId,
    });
    return NextResponse.json(edges);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load connectivity graph';
    return NextResponse.json({ message }, { status: 500 });
  }
}
