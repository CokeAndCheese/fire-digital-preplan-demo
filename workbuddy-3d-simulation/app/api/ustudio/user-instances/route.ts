import { NextResponse } from 'next/server';
import { listUserSceneInstances } from '@/lib/ustudio';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const rows = await listUserSceneInstances({
      sceneId: url.searchParams.get('sceneId') ?? undefined,
    });
    return NextResponse.json(rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load user instances';
    return NextResponse.json({ message }, { status: 500 });
  }
}
