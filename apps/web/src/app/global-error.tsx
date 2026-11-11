'use client';

// Replaces the root layout when the layout itself fails, so it cannot rely on
// global CSS or fonts being available.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          margin: 0,
          padding: 16,
        }}
      >
        <main style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 24, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ color: '#555', margin: '0 0 16px' }}>
            The app could not load. Try again in a moment.
          </p>
          {error.digest ? (
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#777' }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #ccc',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
