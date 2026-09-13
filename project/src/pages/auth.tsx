import { useState, FormEvent } from 'react';
import { authErrorMessage, cn } from '@/lib/ui';
import { PasswordField } from '@/components/shared';
import { Check, ChevronRight, Code2, Mail, Send, ShieldCheck, Sparkles } from 'lucide-react';
import type { Role } from '@/types';
import { supabase } from '@/lib/supabase';

export function PasswordResetScreen(): JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const [email, setEmail] = useState(params.get('email') || '');
  const [token] = useState(params.get('token') || '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetLink, setResetLink] = useState('');
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!token) {
      if (!email) { setError('Enter the email on your account.'); return; }
      setBusy(true);
      const { data, error: requestError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
      setBusy(false);
      if (requestError) { setError(requestError.message || 'We could not prepare a reset link. Please try again.'); return; }
      setResetLink(`${window.location.origin}/reset-password?email=${encodeURIComponent(email)}&token=${data?.code ?? ''}`);
      return;
    }
    if (password.length < 6) { setError('Use a password with at least 6 characters.'); return; }
    if (password !== confirmation) { setError('The passwords do not match.'); return; }
    setBusy(true);
    const { error: resetError } = await supabase.auth.resetPassword({ email, token, password });
    setBusy(false);
    if (resetError) setError(resetError.message || 'We could not update your password. Please request a new reset link.');
    else setMessage('Your password has been updated. You can sign in with it now.');
  };
  return <div className="flex min-h-screen items-center justify-center bg-[#f4f8f7] px-6 py-12"><div className="w-full max-w-md"><div className="mb-8"><p className="eyebrow">Account security</p><h1 className="mt-2 text-3xl font-bold text-[#102a3a]">{token ? 'Create a new password' : 'Reset your password'}</h1><p className="mt-3 text-sm leading-6 text-[#61777c]">{token ? 'Choose a new password for your FullstackDev account.' : 'Enter your account email and we will prepare a secure reset link for you.'}</p></div>{error && <div className="mb-5 rounded-xl border border-[#f3c7c7] bg-[#fff4f4] px-4 py-3 text-sm text-[#a33b3b]">{error}</div>}{message && <div className="mb-5 rounded-xl border border-[#b8e6d0] bg-[#effbf5] px-4 py-3 text-sm text-[#176345]">{message}<button className="mt-3 block font-bold text-[#087f78] hover:underline" onClick={() => { window.history.pushState({}, '', '/login'); window.location.reload(); }}>Return to sign in</button></div>}{resetLink && !token && <div className="mb-5 rounded-xl border border-[#b8e6d0] bg-[#effbf5] px-4 py-3 text-sm text-[#176345]"><Mail className="mb-1 h-4 w-4" />Your secure reset link is ready. <a className="font-bold underline" href={resetLink}>Click here to set a new password</a>.</div>}{token ? <form onSubmit={submit} className="card space-y-4 p-6"><PasswordField value={password} onChange={setPassword} placeholder="New password" minLength={6} hint="Use at least 6 characters." /><PasswordField value={confirmation} onChange={setConfirmation} placeholder="Confirm new password" minLength={6} /><button className="btn-primary w-full py-3.5" disabled={busy || Boolean(message)}>{busy ? 'Updating…' : 'Update password'}<ChevronRight className="h-4 w-4" /></button></form> : <form onSubmit={submit} className="card space-y-4 p-6"><input className="field" type="email" placeholder="Your account email" value={email} onChange={(event) => setEmail(event.target.value)} /><button className="btn-primary w-full py-3.5" disabled={busy || Boolean(resetLink)}>{busy ? 'Preparing…' : 'Send reset link'}<ChevronRight className="h-4 w-4" /></button></form>}</div></div>;
}

export function AuthScreen({ admin = false }: { admin?: boolean }): JSX.Element {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [values, setValues] = useState({ email: '', password: '', fullName: '', username: '' });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [showForgot, setShowForgot] = useState(false); const [resetUrl, setResetUrl] = useState('');
  const sendReset = async (): Promise<void> => {
    setBusy(true); setError(''); setResetUrl('');
    const { data, error: resetError } = await supabase.auth.resetPasswordForEmail(values.email, { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    if (resetError) { setError(resetError.message || 'We could not prepare a reset link. Check the email and try again.'); return; }
    setResetUrl(`${window.location.origin}/reset-password?email=${encodeURIComponent(values.email)}&token=${data?.code ?? ''}`);
  };
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setBusy(true); setError('');
    if (!values.email || values.password.length < 6 || (mode === 'signup' && !values.fullName)) { setError('Please complete every required field. Passwords must be at least 6 characters.'); setBusy(false); return; }
    const result = mode === 'signup' ? await supabase.auth.signUp({ email: values.email, password: values.password, options: { data: { full_name: values.fullName, username: values.username, role } } }) : await supabase.auth.signInWithPassword({ email: values.email, password: values.password });
    if (result.error) { setError(mode === 'login' ? 'The email or password is not correct.' : authErrorMessage(result.error)); setBusy(false); return; }
    if (mode === 'signup') { setMode('login'); setError('Account created. You can now sign in.'); setBusy(false); return; }
    const userId = result.data.user?.id;
    if (!userId) { setError('We could not start your session.'); setBusy(false); return; }
    const { data: foundProfile } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
    const expected: Role = admin ? 'admin' : role;
    if (!foundProfile || foundProfile.role !== expected) { await supabase.auth.signOut(); setError(`This account is not registered as a ${expected}.`); setBusy(false); return; }
    window.location.href = admin ? '/admin' : role === 'teacher' ? '/teacher' : '/dashboard';
  };
  return <div className="grid min-h-screen lg:grid-cols-[0.9fr_1.1fr]">
    <div className="relative hidden overflow-hidden bg-[#061c2c] p-12 text-white lg:flex lg:flex-col lg:justify-between"><div className="absolute -right-40 -top-40 h-96 w-96 rounded-full bg-[#087f78]/30 blur-3xl" /><div className="relative"><div className="flex items-center gap-3"><div className="rounded-xl bg-[#8de6c5] p-2 text-[#062b37]"><Code2 className="h-5 w-5" /></div><span className="font-bold tracking-tight">Fullstack<span className="text-[#8de6c5]">Dev</span></span></div><div className="mt-32 max-w-md"><p className="eyebrow text-[#8de6c5]">Build. Share. Grow.</p><h1 className="mt-5 text-5xl font-bold leading-[1.08]">Your progress,<br /><span className="text-[#8de6c5]">made visible.</span></h1><p className="mt-6 max-w-sm text-base leading-7 text-white/60">A focused home for developers to turn daily learning into a portfolio of meaningful work.</p></div></div><div className="relative flex items-center gap-3 text-sm text-white/50"><Sparkles className="h-4 w-4 text-[#8de6c5]" /> Ship real work, get real feedback, grow in the open.</div></div>
    <div className="flex items-center justify-center bg-[#f4f8f7] px-6 py-12"><div className="w-full max-w-md"><div className="mb-10 lg:hidden"><div className="flex items-center gap-3"><div className="rounded-xl bg-[#087f78] p-2 text-white"><Code2 className="h-5 w-5" /></div><span className="font-bold">Fullstack<span className="text-[#087f78]">Dev</span></span></div></div><div className="mb-8"><p className="eyebrow">{admin ? 'Admin portal' : 'Welcome back'}</p><h2 className="mt-2 text-3xl font-bold text-[#102a3a]">{mode === 'login' ? 'Sign in to your workspace' : 'Create your account'}</h2><p className="mt-2 text-sm text-[#61777c]">{admin ? 'Secure access for platform administrators.' : 'Keep your learning momentum moving forward.'}</p></div>{!admin && <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl bg-[#e4f0ed] p-1"><button className={cn('rounded-lg px-3 py-2 text-sm font-semibold transition', role === 'student' ? 'bg-white text-[#087f78] shadow-sm' : 'text-[#61777c]')} onClick={() => setRole('student')}>Student</button><button className={cn('rounded-lg px-3 py-2 text-sm font-semibold transition', role === 'teacher' ? 'bg-white text-[#087f78] shadow-sm' : 'text-[#61777c]')} onClick={() => setRole('teacher')}>Teacher</button></div>}{error && <div className={cn('mb-5 rounded-xl border px-4 py-3 text-sm', error.startsWith('Account') ? 'border-[#b8e6d0] bg-[#effbf5] text-[#176345]' : 'border-[#f3c7c7] bg-[#fff4f4] text-[#a33b3b]')}>{error}</div>}<form onSubmit={submit} className="space-y-4">{mode === 'signup' && <><input className="field" placeholder="Full name" value={values.fullName} onChange={(e) => setValues({ ...values, fullName: e.target.value })} /><input className="field" placeholder="Username (optional)" value={values.username} onChange={(e) => setValues({ ...values, username: e.target.value })} /></>}<input className="field" type="email" placeholder="Email address" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} /><PasswordField value={values.password} onChange={(password) => setValues({ ...values, password })} placeholder="Password" minLength={6} hint={mode === 'signup' ? 'Use at least 6 characters.' : undefined} /><button className="btn-primary w-full py-3.5" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}<ChevronRight className="h-4 w-4" /></button>{mode === 'login' && (showForgot ? (resetUrl ? <div className="mt-4 rounded-xl border border-[#b8e6d0] bg-[#effbf5] px-4 py-3 text-sm text-[#176345]"><Mail className="mb-1 h-4 w-4" />Reset link ready for <b>{values.email}</b>. <a className="font-bold underline" href={resetUrl}>Click here to set a new password</a>.<button type="button" className="mt-2 block font-semibold text-[#087f78] hover:underline" onClick={() => { setShowForgot(false); setResetUrl(''); }}>Back to sign in</button></div> : <div className="mt-4 space-y-3 rounded-xl border border-[#e5efec] bg-[#f6fcf9] p-4"><p className="text-sm font-semibold text-[#185464]">Reset your password</p><p className="text-xs text-[#6c8589]">Enter your account email and we will prepare a secure reset link for you.</p><input className="field" type="email" placeholder="Your account email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} /><button type="button" className="btn-primary w-full" disabled={busy || !values.email} onClick={() => void sendReset()}>{busy ? 'Preparing…' : 'Send reset link'}</button><button type="button" className="w-full text-center text-xs font-semibold text-[#6c8589] hover:underline" onClick={() => setShowForgot(false)}>Back to sign in</button></div>) : <button type="button" className="mt-4 w-full text-center text-sm text-[#087f78] hover:underline" onClick={() => { setShowForgot(true); setResetUrl(''); setError(''); }}>Forgot your password?</button>)}</form>{!admin && <button className="mt-6 w-full text-center text-sm font-semibold text-[#087f78] hover:underline" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setShowForgot(false); setResetUrl(''); }}>{mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}</button>}{!admin && mode === 'login' && <a href="/admin/login" className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs font-semibold text-[#6c8589] hover:text-[#087f78]"><ShieldCheck className="h-3.5 w-3.5" />Admin sign in</a>}</div></div></div>;
}
