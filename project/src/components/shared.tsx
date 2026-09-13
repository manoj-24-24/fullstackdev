import { useState, useEffect, ReactNode } from 'react';
import { cn, formatDate } from '@/lib/ui';
import { BookOpen, ChevronRight, Code2, Eye, EyeOff, GraduationCap, Moon, ShieldCheck, Sun } from 'lucide-react';
import type { Role, Profile, Contribution, Activity } from '@/types';

export const roleStyles: Record<string, { badge: string; icon: typeof ShieldCheck }> = {
  admin: { badge: 'bg-[#ede9fe] text-[#6d5ae0]', icon: ShieldCheck },
  teacher: { badge: 'bg-[#fff7df] text-[#a47816]', icon: BookOpen },
  student: { badge: 'bg-[#e7f7f1] text-[#087f78]', icon: GraduationCap },
};

export function greetingInfo(): { text: string; Icon: typeof Sun } { const h = new Date().getHours(); return h < 12 ? { text: 'Good morning', Icon: Sun } : h < 17 ? { text: 'Good afternoon', Icon: Sun } : h < 21 ? { text: 'Good evening', Icon: Moon } : { text: 'Good night', Icon: Moon }; }
// Day/night theme: persisted per browser, applied as a class on <html>.

export function useTheme(): [boolean, () => void] {
  const [night, setNight] = useState<boolean>(() => { try { return localStorage.getItem('fsd_theme') === 'night'; } catch { return false; } });
  useEffect(() => {
    document.documentElement.classList.toggle('night', night);
    try { localStorage.setItem('fsd_theme', night ? 'night' : 'day'); } catch { /* ignore */ }
  }, [night]);
  return [night, () => setNight((n) => !n)];
}
// Keeps dashboards live: refetch every 8s and whenever the tab regains focus.
// This is what makes the approval workflow feel direct — a student submission
// lands in the admin queue without anyone refreshing, and an approval shows up
// on the student dashboard the same way.

export function LoadingScreen(): JSX.Element { return <div className="flex min-h-screen items-center justify-center bg-[#061c2c]"><div className="text-center text-white"><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-[#7de0c0]" /><p className="text-sm text-white/70">Loading your workspace</p></div></div>; }

export function DeniedScreen({ navigate }: { navigate: (path: string) => void }): JSX.Element { return <div className="flex min-h-screen items-center justify-center bg-[#061c2c] p-6"><div className="card max-w-md p-8 text-center"><ShieldCheck className="mx-auto mb-5 h-12 w-12 text-[#087f78]" /><h1 className="text-2xl font-bold text-[#102a3a]">Access restricted</h1><p className="mt-3 text-sm leading-6 text-[#61777c]">This area is reserved for another role in the platform.</p><button className="btn-primary mt-6" onClick={() => navigate('/dashboard')}>Return to dashboard</button></div></div>; }

// Role identity: a matching icon + tinted badge for every reviewer or sender.

export function RoleBadge({ role }: { role?: string | null }): JSX.Element | null {
  if (!role) return null;
  const s = roleStyles[role] || roleStyles.student;
  const Icon = s.icon;
  return <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', s.badge)}><Icon className="h-3 w-3" />{role}</span>;
}

// Password input with a show/hide eye toggle, used on every auth screen.

export function PasswordField(props: { value: string; onChange: (v: string) => void; placeholder: string; minLength?: number; hint?: string }): JSX.Element {
  const [visible, setVisible] = useState(false);
  return <div>
    <div className="relative">
      <input className="field pr-12" type={visible ? 'text' : 'password'} minLength={props.minLength} placeholder={props.placeholder} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      <button type="button" title={visible ? 'Hide password' : 'Show password'} aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-[#8ca1a3] transition hover:bg-[#f0faf7] hover:text-[#087f78]">{visible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
    </div>
    {props.hint && <p className="mt-2 text-xs text-[#7b9295]">{props.hint}</p>}
  </div>;
}

export function Avatar({ profile, size = 'md' }: { profile: Profile; size?: 'sm' | 'md' | 'lg' }): JSX.Element { const sizes = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-20 w-20 text-2xl' }; return profile.avatar ? <img src={profile.avatar} alt={profile.full_name} className={cn('rounded-full object-cover', sizes[size])} /> : <div className={cn('flex items-center justify-center rounded-full bg-[#b9ead7] font-bold text-[#087f78]', sizes[size])}>{(profile.full_name || profile.username || 'D').slice(0, 1).toUpperCase()}</div>; }

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: ReactNode; title: string; description?: string; action?: ReactNode }): JSX.Element { return <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="eyebrow">{eyebrow}</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-[#102a3a] sm:text-4xl">{title}</h1>{description && <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6c8589]">{description}</p>}</div>{action}</div>; }

export function StatCard({ label, value, detail, icon: Icon, onClick, title }: { label: string; value: string; detail: string; icon: typeof Code2; onClick?: () => void; title?: string }): JSX.Element { const inner = <><div className="flex items-start justify-between"><div><p className="text-sm text-[#6c8589]">{label}</p><p className="mt-3 text-3xl font-bold tracking-tight text-[#102a3a]">{value}</p></div><div className="rounded-xl bg-[#e7f7f1] p-2.5 text-[#087f78]"><Icon className="h-5 w-5" /></div></div><p className="mt-3 text-xs text-[#8ca1a3]">{detail}</p></>; return onClick ? <button title={title || `View ${label.toLowerCase()}`} onClick={onClick} className="card p-5 text-left transition hover:-translate-y-0.5 hover:border-[#9ad7c5]">{inner}</button> : <div className="card p-5">{inner}</div>; }

export function calculateStreak(activities: Activity[]): number { const days = new Set(activities.filter((a) => a.contribution_count > 0).map((a) => a.activity_date)); let count = 0; const cursor = new Date(); while (days.has(cursor.toISOString().slice(0, 10))) { count += 1; cursor.setDate(cursor.getDate() - 1); } return count; }

export function ActivityGrid({ activities }: { activities: Activity[] }): JSX.Element { const counts = new Map(activities.map((a) => [a.activity_date, a.contribution_count])); return <div className="mt-5 grid grid-cols-10 gap-1.5 sm:grid-cols-15">{Array.from({ length: 30 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - (29 - index)); const key = date.toISOString().slice(0, 10); const count = counts.get(key) || 0; return <div key={key} title={`${key}: ${count} contribution${count === 1 ? '' : 's'}`} className={cn('aspect-square rounded-[4px]', count === 0 ? 'bg-[#edf3f1]' : count === 1 ? 'bg-[#b9ead7]' : count === 2 ? 'bg-[#5fc7aa]' : 'bg-[#087f78]')} />; })}</div>; }

export function ContributionRow({ contribution, onClick }: { contribution: Contribution; onClick: () => void }): JSX.Element { return <button onClick={onClick} className="group flex w-full items-center justify-between rounded-xl border border-[#e5efec] p-4 text-left transition hover:border-[#9ad7c5] hover:bg-[#f6fcf9]"><div className="flex min-w-0 items-center gap-3"><div className="rounded-xl bg-[#edf7f4] p-2.5 text-[#087f78]"><Code2 className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-sm font-bold text-[#185464]">{contribution.title}</p><p className="mt-1 text-xs text-[#8ca1a3]">{contribution.subjects?.name || 'Uncategorized'} · {formatDate(contribution.contribution_date)}</p></div></div><div className="flex items-center gap-3"><StatusPill status={contribution.status} />{contribution.score !== null && <span className="hidden text-sm font-bold text-[#087f78] sm:inline">{contribution.score}%</span>}<ChevronRight className="h-4 w-4 text-[#9db1b2] transition group-hover:translate-x-1" /></div></button>; }

export function StatusPill({ status }: { status: string }): JSX.Element { return <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-bold capitalize', status === 'approved' ? 'bg-[#e7f7f1] text-[#18704d]' : status === 'needs_improvement' ? 'bg-[#fff3df] text-[#9d6718]' : 'bg-[#edf2f2] text-[#6c8589]')}>{status.replace('_', ' ')}</span>; }

export function EmptyState({ icon: Icon, title, text, action, onClick }: { icon: typeof Code2; title: string; text: string; action?: string; onClick?: () => void }): JSX.Element { return <div className="py-12 text-center"><Icon className="mx-auto h-10 w-10 text-[#9acfc0]" /><p className="mt-4 font-bold text-[#185464]">{title}</p><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#7b9295]">{text}</p>{action && onClick && <button className="btn-secondary mt-5" onClick={onClick}>{action}</button>}</div>; }

export function LoadingPanel(): JSX.Element { return <div className="card flex min-h-[320px] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#dce9e6] border-t-[#087f78]" /></div>; }

export function ErrorBanner({ text }: { text: string }): JSX.Element { return <div className="mb-6 rounded-xl border border-[#f3c7c7] bg-[#fff4f4] px-4 py-3 text-sm text-[#a33b3b]">{text}</div>; }

export function NotFound({ navigate }: { navigate: (path: string) => void }): JSX.Element { return <div className="card mx-auto max-w-lg p-10 text-center"><h1 className="text-2xl font-bold">Page not found</h1><p className="mt-3 text-sm text-[#6c8589]">That workspace page does not exist.</p><button className="btn-primary mt-6" onClick={() => navigate('/dashboard')}>Go to dashboard</button></div>; }

// ---- Admin learning notes: authored by admins, visible to every role, no approval. ----
