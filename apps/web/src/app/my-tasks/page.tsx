import { Suspense } from 'react';
import { Loading } from '@/components/ui/feedback';
import { MyTasks } from '@/components/work/my-tasks';
export const metadata = { title: 'My tasks' };
export default function Page() {
  return (
    <Suspense fallback={<Loading>Loading your tasks…</Loading>}>
      <MyTasks />
    </Suspense>
  );
}
