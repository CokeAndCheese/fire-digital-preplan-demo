import { NextResponse } from 'next/server';
import { getReachableSceneEdges } from '@/lib/ustudio';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      sceneId?: string;
      storyNodeIds?: string[];
      nodeId?: string;
    };
    const edges = await getReachableSceneEdges({
      sceneId: body.sceneId,
      storyNodeIds: Array.isArray(body.storyNodeIds) ? body.storyNodeIds : [],
      nodeId: body.nodeId,
    });
    return NextResponse.json(edges);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load reachable graph';
    return NextResponse.json({ message }, { status: 500 });
  }
}
