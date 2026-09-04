import { NextResponse } from 'next/server';
import { getSkillRuntimes } from '@/lib/skills/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ skills: await getSkillRuntimes() });
}
