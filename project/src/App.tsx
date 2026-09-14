import { useState, useEffect, useRef } from 'react';
import { DeniedScreen, LoadingScreen, RoleBadge } from '@/components/shared';
import { AuthScreen, PasswordResetScreen } from '@/pages/auth';
import { AppShell } from '@/components/AppShell';
import type { Profile, Notification } from '@/types';
import { supabase } from '@/lib/supabase';

// Push subscriptions need the key as raw bytes (URL-safe base64 -> Uint8Array).
function urlB64ToUint8Array(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function App() {
  const [session, setSession] = useState<{ userId: string } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState(new URL(window.location.href).pathname);

  useEffect(() => {
    const loadSession = async (): Promise<void> => {
      const { data } = await supabase.auth.getSession();
      if (data.session) { setSession({ userId: data.session.user.id }); await loadProfile(data.session.user.id); }
      setLoading(false);
    };
    const loadProfile = async (id: string): Promise<void> => {
      const { data } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
      if (data) setProfile(data as Profile);
      else {
        // Stale session pointing at a deleted account — drop it so the user
        // reaches the sign-in screen instead of an endless loading spinner.
        await supabase.auth.signOut();
        setSession(null); setProfile(null);
      }
    };
    void loadSession();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      (async () => {
        if (nextSession) { setSession({ userId: nextSession.user.id }); await loadProfile(nextSession.user.id); }
        else { setSession(null); setProfile(null); }
        setLoading(false);
      })();
    });
    const onPop = (): void => setRoute(new URL(window.location.href).pathname);
    window.addEventListener('popstate', onPop);
    return () => { listener.subscription.unsubscribe(); window.removeEventListener('popstate', onPop); };
  }, []);

  // Route state tracks the pathname only — query strings (e.g. ?subject=Frontend)
  // must not leak into route matching, or every route falls through to "Page not found".
  const navigate = (path: string): void => { window.history.pushState({}, '', path); setRoute(new URL(path, window.location.origin).pathname); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const signOut = async (): Promise<void> => { await supabase.auth.signOut(); navigate('/login'); };
  // Live notification popups: poll for unread items, toast in-app, and raise a
  // real OS notification when the app is installed or running in background.
  const [toasts, setToasts] = useState<Notification[]>([]);
  const [notifAsk, setNotifAsk] = useState(false);
  const [offline, setOfflineState] = useState(!navigator.onLine);
  useEffect(() => {
    const w = window as unknown as { __fsdOffline?: boolean };
    const onConn = (e: Event): void => { const v = !!(e as CustomEvent).detail?.offline; w.__fsdOffline = v; setOfflineState(v); };
    const onOnline = (): void => { w.__fsdOffline = false; setOfflineState(false); };
    const onOfflineEvt = (): void => { w.__fsdOffline = true; setOfflineState(true); };
    w.__fsdOffline = !navigator.onLine;
    window.addEventListener('fsd-connectivity', onConn as EventListener);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOfflineEvt);
    return () => { window.removeEventListener('fsd-connectivity', onConn as EventListener); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOfflineEvt); };
  }, []);
  const seenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  useEffect(() => {
    if (!profile) return;
    const showOne = async (n: Notification): Promise<void> => {
      setToasts((t) => [...t.filter((x) => x.id !== n.id), n]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), 7000);
      try {
        if ('Notification' in window && window.Notification.permission === 'granted' && (document.hidden || window.matchMedia('(display-mode: standalone)').matches)) {
          const reg = await navigator.serviceWorker?.getRegistration();
          const opts: NotificationOptions = { body: n.message, icon: '/icon-192.png?v=2', badge: '/icon-192.png?v=2', tag: n.id, data: { url: '/notifications' } };
          if (reg) await reg.showNotification(n.title, opts); else new window.Notification(n.title, opts);
        }
      } catch { /* notifications unavailable */ }
    };
    const poll = async (): Promise<void> => {
      const { data } = await supabase.from('notifications').select('*').eq('user_id', profile.id).eq('read', false).order('created_at', { ascending: false }).limit(5);
      const rows = (data || []) as Notification[];
      // First poll only primes the seen-set (no popups for pre-existing mail);
      // everything arriving after that pops for real.
      if (!primedRef.current) { for (const r of rows) seenRef.current.add(r.id); primedRef.current = true; return; }
      const fresh = rows.filter((n) => !seenRef.current.has(n.id));
      for (const n of fresh) { seenRef.current.add(n.id); void showOne(n); }
    };
    void poll();
    const iv = setInterval(() => { void poll(); }, 10000);
    return () => clearInterval(iv);
  }, [profile?.id]);
  useEffect(() => { try { if (!localStorage.getItem('fsd_notif_asked') && 'Notification' in window && window.Notification.permission === 'default') setNotifAsk(true); } catch { /* ignore */ } }, []);
  // Grant permission, then hand the browser's push subscription to the server so
  // notifications reach this device even when the app is closed.
  const enableNotifs = async (): Promise<void> => {
    setNotifAsk(false);
    try { localStorage.setItem('fsd_notif_asked', '1'); } catch { /* ignore */ }
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
      if (await Notification.requestPermission() !== 'granted') return;
    } catch { /* ignore */ }
    void subscribePush();
  };

  // Ask the server for new notifications since the last poll, so we only toast
  // genuinely fresh mail. Registered with the server so push reaches this device
  // even when the app is closed.
  const subscribePush = async (): Promise<void> => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      const reg = await navigator.serviceWorker.ready;
      const keyRes = await fetch('/api/push/key');
      const { data: keyData } = (await keyRes.json()) as { data?: { key?: string; enabled?: boolean } };
      if (!keyData?.enabled || !keyData.key) return;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(keyData.key) });
      }
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token || '';
      await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    } catch { /* push is best-effort; in-app toasts still work */ }
  };

  // Also subscribe silently on load when permission was already granted earlier.
  useEffect(() => { if ((window as unknown as { __fsdPushHooked?: boolean }).__fsdPushHooked) return; (window as unknown as { __fsdPushHooked?: boolean }).__fsdPushHooked = true; if ('Notification' in window && Notification.permission === 'granted' && profile?.id) { void subscribePush(); } }, [profile?.id]);
  const openToast = async (n: Notification): Promise<void> => { setToasts((t) => t.filter((x) => x.id !== n.id)); await supabase.from('notifications').update({ read: true }).eq('id', n.id); navigate('/notifications'); };
  if (loading) return <LoadingScreen />;
  if (route === '/reset-password') return <PasswordResetScreen />;
  if (!session) return route === '/admin/login' ? <AuthScreen admin /> : <AuthScreen />;
  if (!profile) return <LoadingScreen />;
  if (route === '/login' || route === '/admin/login') { navigate(profile.role === 'admin' ? '/admin' : profile.role === 'teacher' ? '/teacher' : '/dashboard'); return null; }
  if (route.startsWith('/admin') && !route.startsWith('/admin-notes') && profile.role !== 'admin') return <DeniedScreen navigate={navigate} />;
  if (route === '/teacher' && profile.role !== 'teacher' && profile.role !== 'admin') return <DeniedScreen navigate={navigate} />;
  return <><AppShell profile={profile} route={route} navigate={navigate} signOut={signOut} />{offline && <div className="fixed bottom-4 left-4 z-[60] flex items-center gap-2 rounded-full bg-[#fff7df] px-4 py-2 text-xs font-bold text-[#7a5b0d] shadow-lg"><span className="h-2 w-2 animate-pulse rounded-full bg-[#d9a514]" />Offline — showing your saved data. New changes can't be saved right now.</div>}{toasts.length > 0 && <div className="fixed right-4 top-4 z-[60] w-80 max-w-[calc(100vw-2rem)] space-y-2">{toasts.map((n) => <button key={n.id} onClick={() => void openToast(n)} className="card w-full p-4 text-left shadow-lg transition hover:border-[#9ad7c5]"><p className="text-sm font-bold">{n.title}</p>{n.sender_name && <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[#6c8589]"><span className="font-semibold">From {n.sender_name}</span><RoleBadge role={n.sender_role} /></p>}<p className="mt-1 line-clamp-2 text-sm leading-5 text-[#6c8589]">{n.message}</p></button>)}</div>}{notifAsk && <div className="fixed bottom-4 left-1/2 z-[60] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 rounded-xl border border-[#b8e6d0] bg-white px-4 py-3 shadow-lg"><p className="text-sm font-semibold">Get popups for new messages and approvals?</p><div className="mt-2 flex items-center gap-3"><button className="btn-primary px-3 py-1.5 text-xs" onClick={() => void enableNotifs()}>Enable notifications</button><button className="text-xs font-semibold text-[#6c8589]" onClick={() => { setNotifAsk(false); try { localStorage.setItem('fsd_notif_asked', '1'); } catch { /* ignore */ } }}>Not now</button></div></div>}</>;
}

export default App;
