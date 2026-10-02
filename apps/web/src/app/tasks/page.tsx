import { Suspense } from 'react';
import { Loading } from '@/components/ui/feedback';
import { TaskList } from '@/components/work/task-list';
export const metadata = { title: 'Find tasks' };
export default function Page() {
  return (
    <Suspense fallback={<Loading>Loading tasks…</Loading>}>
      <TaskList />
    </Suspense>
  );
}
