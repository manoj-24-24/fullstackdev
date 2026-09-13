import { useEffect } from 'react';

export const cn = (...classes: Array<string | false | null | undefined>): string => classes.filter(Boolean).join(' ');

export const formatDate = (date: string): string => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T00:00:00`));

export const today = (): string => new Date().toISOString().slice(0, 10);

export const friendlyError = (): string => 'Something went wrong. Please try again.';
// Time-aware greeting so it says the right thing all day, with a sun/moon icon.

export const authErrorMessage = (error: { message?: string; code?: string }): string => {
  const message = (error.message || '').toLowerCase();
  if (error.code === 'user_already_exists' || message.includes('already registered') || message.includes('already been registered')) return 'An account with this email already exists. Switch to sign in instead.';
  if (message.includes('invalid email')) return 'Enter a valid email address.';
  if (message.includes('password')) {
    const minimum = message.match(/at least (\\d+) characters/);
    if (minimum) return `Use a password with at least ${minimum[1]} characters.`;
    if (message.includes('compromised') || message.includes('breached') || message.includes('common')) return 'Choose a less common password for better account security.';
    return 'Choose a stronger password and try again.';
  }
  if (message.includes('rate limit')) return 'Too many attempts. Please wait a moment and try again.';
  if (message.includes('username') || message.includes('profiles_username')) return 'That username is already in use. Choose another one.';
  return 'We could not create that account right now. Please try again.';
};

export function useLiveRefresh(refetch: () => void, intervalMs = 8000): void {
  useEffect(() => {
    const timer = setInterval(refetch, intervalMs);
    const onFocus = (): void => { if (document.visibilityState === 'visible') refetch(); };
    // Fresh data must win the moment connectivity returns.
    const onBackOnline = (): void => { if (!(window as unknown as { __fsdOffline?: boolean }).__fsdOffline) refetch(); };
    window.addEventListener('fsd-connectivity', onBackOnline as EventListener);
    window.addEventListener('online', onBackOnline);
    document.addEventListener('visibilitychange', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('fsd-connectivity', onBackOnline as EventListener); window.removeEventListener('online', onBackOnline); document.removeEventListener('visibilitychange', onFocus); };
  });
}
