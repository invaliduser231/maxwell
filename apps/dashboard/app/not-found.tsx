import Link from 'next/link';

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <img src="/mascot/skeptical.svg" alt="" width={72} height={72} />
      <h1 className="mx-h1">Nothing here</h1>
      <p className="mx-sub" style={{ margin: 0 }}>
        The page is gone, or you have no access to it.
      </p>
      <Link className="mx-btn" href="/">
        Choose a community
      </Link>
    </main>
  );
}
