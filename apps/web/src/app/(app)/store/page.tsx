import type { Metadata } from 'next';
import { StorePage } from '@/features/store/store-page';

export const metadata: Metadata = { title: 'Store' };

export default function Page() {
  return <StorePage />;
}
