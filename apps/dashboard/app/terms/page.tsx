import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal';
import { titled } from '@/lib/i18n/server';
import { terms } from '@/lib/legal/terms';

export const generateMetadata: () => Promise<Metadata> = titled('Terms');

export default function Terms() {
  return <LegalPage source={terms} lang="en" />;
}
