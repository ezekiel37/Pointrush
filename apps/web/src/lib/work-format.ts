export function backingNaira(kobo: string) {
  const amount = BigInt(kobo);
  return `₦${(amount / 100n).toLocaleString('en-NG')}.${(amount % 100n).toString().padStart(2, '0')}`;
}
export function workDate(value: string) {
  return (
    new Intl.DateTimeFormat('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Africa/Lagos',
    }).format(new Date(value)) + ' WAT'
  );
}
