import { SimulationLabClient } from './SimulationLabClient';
import { getRuntimeConfig } from '@/lib/app-key';

export const dynamic = 'force-dynamic';

export default function SimulationLabPage() {
  return <SimulationLabClient runtimeConfig={getRuntimeConfig()} />;
}
