import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal';
import { imprint } from '@/lib/legal/imprint';

export const metadata: Metadata = { title: 'Impressum' };

export default function Imprint() {
  return <LegalPage source={imprint} lang="de" />;
}
