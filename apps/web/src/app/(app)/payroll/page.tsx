import type { Metadata } from 'next';
import { PayrollPage } from '@/features/payroll/payroll-page';

export const metadata: Metadata = { title: 'Payroll' };

export default function Page() {
  return <PayrollPage />;
}
