import { Suspense } from 'react';
import dynamic from 'next/dynamic';

const AnalyzePage = dynamic(() => import('@/components/AnalyzePage'), { ssr: false });

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AnalyzePage />
    </Suspense>
  );
}
