import { getApiHealth } from '@/lib/api-health';

export const dynamic = 'force-dynamic';

const FOUNDATION = [
  'Monorepo, linting, commit hooks and CI',
  'API bootstrap with validated environment',
  'One error shape across REST and GraphQL',
  'Design tokens and shared UI primitives',
];

export default async function HomePage() {
  const api = await getApiHealth();

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-4 py-16 sm:px-6">
      <header className="space-y-2">
        <p className="text-sm font-medium text-primary">ERP</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          Platform foundation is in place
        </h1>
        <p className="text-muted-foreground">
          Sign-in, organisations and permissions come next. This page confirms the web app can reach
          the API.
        </p>
      </header>

      <section
        aria-label="API status"
        className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4"
      >
        <div>
          <p className="text-sm font-medium">API</p>
          <p className="text-sm text-muted-foreground">
            {api.online
              ? api.instance
                ? `Answering from instance ${api.instance}`
                : 'Answering health checks'
              : 'Not reachable. Start it with pnpm dev.'}
          </p>
        </div>
        <span
          role="status"
          className={
            api.online
              ? 'inline-flex items-center gap-2 text-sm font-medium text-success'
              : 'inline-flex items-center gap-2 text-sm font-medium text-destructive'
          }
        >
          <span aria-hidden className="size-2 rounded-full bg-current" />
          {api.online ? 'Online' : 'Offline'}
        </span>
      </section>

      <section aria-labelledby="foundation-heading" className="space-y-3">
        <h2 id="foundation-heading" className="text-sm font-medium">
          Included in this stage
        </h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {FOUNDATION.map((item) => (
            <li key={item} className="flex gap-3">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
