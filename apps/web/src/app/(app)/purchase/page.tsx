import type { Metadata } from 'next';
import { PurchasePage } from '@/features/purchase/purchase-page';

export const metadata: Metadata = { title: 'Purchase' };

export default function Page() {
  return <PurchasePage />;
}
