import { notFound } from 'next/navigation';
import { z } from 'zod';
import { TaskDetail } from '@/components/work/task-detail';
export const metadata = { title: 'Task details' };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <TaskDetail key={id} id={id} />;
}
