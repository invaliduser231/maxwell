'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <img src="/mascot/error.svg" alt="" width={72} height={72} />
      <h1 className="mx-h1">Something broke</h1>
      <button type="button" className="mx-btn" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
