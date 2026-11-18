/** An address for logs: enough to correlate ("au…@texer.org"), not the address itself. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '(none)';
  const at = email.lastIndexOf('@');
  if (at < 1) return '…';
  return `${email.slice(0, Math.min(2, at))}…${email.slice(at)}`;
}
