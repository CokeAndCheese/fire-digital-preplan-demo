import { NextResponse } from 'next/server';
import { executeSkill } from '@/lib/skills/server';
import type { SkillExecutionRequest } from '@/lib/skills/types';
import { isOfflineDemoMode } from '@/lib/agent/competition-agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  if (!isOfflineDemoMode()) {
    return NextResponse.json(
      { message: '当前为八维通远端运行时，业务 Skill 必须通过 /api/agent/chat 交给已发布主智能体执行。' },
      { status: 409, headers: noStore },
    );
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ message: '不允许跨站调用本地 Skill。' }, { status: 403, headers: noStore });
  }
  const input = (await request.json().catch(() => null)) as SkillExecutionRequest | null;
  if (!input?.skillId || !input.actionId) {
    return NextResponse.json({ message: '缺少 skillId 或 actionId。' }, { status: 400, headers: noStore });
  }
  try {
    const result = await executeSkill(input);
    return NextResponse.json(result, { status: result.ok ? 200 : 502, headers: noStore });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Skill 执行失败。' },
      { status: 409, headers: noStore },
    );
  }
}
