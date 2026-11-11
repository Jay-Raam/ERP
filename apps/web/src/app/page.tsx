import { redirect } from 'next/navigation';

// Anonymous visitors never get here: the proxy sends them to /login first.
export default function RootPage() {
  redirect('/dashboard');
}
