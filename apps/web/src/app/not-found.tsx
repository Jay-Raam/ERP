import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground">The page may have moved, or the link is wrong.</p>
      <div>
        <Button asChild>
          <Link href="/">Go to home</Link>
        </Button>
      </div>
    </main>
  );
}
