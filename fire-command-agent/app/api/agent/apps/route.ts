import { NextResponse } from 'next/server';
import { localCompetitionAgent, isOfflineDemoMode } from '@/lib/agent/competition-agent';
import { inspectCompetitionRuntimeBinding } from '@/lib/agent/runtime-binding';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (isOfflineDemoMode()) {
    return NextResponse.json({
      rows: [localCompetitionAgent()],
      runtime: await inspectCompetitionRuntimeBinding(),
    });
  }
  request.signal.throwIfAborted();
  const runtime = await inspectCompetitionRuntimeBinding();
  if (runtime.status !== 'ready' || !runtime.app) {
    return NextResponse.json({ message: runtime.message, runtime }, { status: 503 });
  }
  return NextResponse.json({
    rows: [{ app_id: runtime.app.appId, name: runtime.app.name, status: runtime.app.status }],
    runtime,
  });
}
