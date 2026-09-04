import { NextResponse } from 'next/server';
import { listTwinsInstances } from '@/lib/ustudio';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const exclude = url.searchParams
    .getAll('exclude')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  try {
    const rows = await listTwinsInstances({
      sceneId: url.searchParams.get('sceneId') ?? undefined,
      excludeTwinsIdentifiers: exclude.length > 0 ? exclude : undefined,
    });
    return NextResponse.json(rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load instances';
    return NextResponse.json({ message }, { status: 500 });
  }
}
