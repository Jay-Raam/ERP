import type { Metadata } from 'next';
import { UsersPage } from '@/features/admin/users-page';

export const metadata: Metadata = { title: 'Users' };

export default function Page() {
  return <UsersPage />;
}
