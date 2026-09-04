import { NextResponse } from 'next/server';
import { getSceneInstanceTree } from '@/lib/ustudio';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const tree = await getSceneInstanceTree({
      sceneId: url.searchParams.get('sceneId') ?? undefined,
    });
    return NextResponse.json(tree);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load scene tree';
    return NextResponse.json({ message }, { status: 500 });
  }
}
