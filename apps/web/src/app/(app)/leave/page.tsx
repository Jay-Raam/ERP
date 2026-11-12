import type { Metadata } from 'next';
import { LeavePage } from '@/features/hr/leave-page';

export const metadata: Metadata = { title: 'Leave' };

export default function Page() {
  return <LeavePage />;
}
