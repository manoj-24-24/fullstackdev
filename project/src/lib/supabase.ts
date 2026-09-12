/* eslint-disable @typescript-eslint/no-explicit-any */
// MySQL-backed client for FullstackDev.
// Talks to the local Express backend (server/) via /api/* and exposes the
// exact same API surface the rest of the app already uses, so no other
// file had to change when Supabase was replaced.

const API = '/api';
// Session storage with per-window identity + cross-restart persistence:
// - sessionStorage (per browser window/tab) holds the ACTIVE session, so two
//   windows can be signed in as different roles without overwriting each other.
// - localStorage holds the LAST login per window-slot so closing and reopening
//   the browser restores the session — "once logged in, always logged in" until
//   an explicit sign-out. Sign-out clears both, so the next window opens signed out.
const SESSION_KEY = 'fsd_session';
const REMEMBER_KEY = 'fsd_remember';
// Legacy keys from earlier designs — migrated once.
const LEGACY_TAB_KEYS = ['fsd_session_tab'];

interface SessionUser {
  id: string;
  email: string;
  user_metadata?: { full_name?: string; username?: string };
}
interface Session {
  access_token: string;
  user: SessionUser;
}
type AuthListener = (event: string, session: Session | null) => void;

type QueryResponse = { data: any; error: { message: string; code?: string } | null };
type ApiError = { message: string; code?: string } | null;

let authListeners: AuthListener[] = [];

// ---- Offline cache: identity-scoped, last-response-per-query ----
// Every SELECT's successful response is cached under the signed-in user's id,
// so offline the app re-renders exactly what that user last saw — never another
// account's data. Sign-out wipes the user's bucket from disk.
const OFFLINE_PREFIX = 'fsd_offline_';
const OFFLINE_CAP = 300;
type CacheEntry = { t: number; res: QueryResponse };
type OfflineBucket = Record<string, CacheEntry>;

function cacheKeyFor(body: unknown): string {
  const b = body as Record<string, unknown>;
  return JSON.stringify([b.op, b.table, b.select, b.filters, b.order, b.limit, b.single]);
}
function bucketFor(userId: string): OfflineBucket {
  try {
    const raw = localStorage.getItem(OFFLINE_PREFIX + userId);
    return raw ? (JSON.parse(raw) as OfflineBucket) : {};
  } catch {
    return {};
  }
}
function saveBucket(userId: string, bucket: OfflineBucket): void {
  try {
    const keys = Object.keys(bucket);
    if (keys.length > OFFLINE_CAP) {
      keys.sort((a, b) => bucket[a].t - bucket[b].t);
      for (const k of keys.slice(0, keys.length - OFFLINE_CAP)) delete bucket[k];
    }
    localStorage.setItem(OFFLINE_PREFIX + userId, JSON.stringify(bucket));
  } catch {
    // Storage full/unavailable — the cache is best-effort.
  }
}
export function clearOfflineCache(userId?: string): void {
  try {
    if (userId) {
      localStorage.removeItem(OFFLINE_PREFIX + userId);
      return;
    }
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(OFFLINE_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}
let offlineMode = false;
function setOffline(v: boolean): void {
  if (offlineMode === v) return;
  offlineMode = v;
  window.dispatchEvent(new CustomEvent('fsd-connectivity', { detail: { offline: v } }));
}

function readSession(): Session | null {
  try {
    // 1) The active per-window session always wins.
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw) as Session;
    // 2) Otherwise restore the remembered login (same browser, after restart).
    const remembered = localStorage.getItem(REMEMBER_KEY);
    if (remembered) {
      sessionStorage.setItem(SESSION_KEY, remembered);
      return JSON.parse(remembered) as Session;
    }
    // 3) One-time migration from earlier storage designs.
    for (const k of LEGACY_TAB_KEYS) {
      const legacy = sessionStorage.getItem(k);
      if (legacy) {
        sessionStorage.setItem(SESSION_KEY, legacy);
        localStorage.setItem(REMEMBER_KEY, legacy);
        sessionStorage.removeItem(k);
        return JSON.parse(legacy) as Session;
      }
    }
    const legacyMain = localStorage.getItem(SESSION_KEY);
    if (legacyMain) {
      sessionStorage.setItem(SESSION_KEY, legacyMain);
      localStorage.setItem(REMEMBER_KEY, legacyMain);
      localStorage.removeItem(SESSION_KEY);
      return JSON.parse(legacyMain) as Session;
    }
    return null;
  } catch {
    return null;
  }
}
function writeSession(session: Session | null): void {
  try {
    if (session) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      localStorage.setItem(REMEMBER_KEY, JSON.stringify(session));
    } else {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(REMEMBER_KEY);
    }
  } catch {
    // Storage unavailable (private mode) — session simply won't persist.
  }
}

async function request<T = any>(path: string, options: { method?: string; body?: unknown; form?: FormData } = {}): Promise<{ data: T; error: ApiError }> {
  const headers: Record<string, string> = {};
  const session = readSession();
  if (session) headers.Authorization = `Bearer ${session.access_token}`;
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  // Reads through the generic query endpoint are cache-eligible; writes and
  // auth calls are not — they must fail honestly when offline.
  const bodyObj = options.body as Record<string, unknown> | undefined;
  const cacheable = path === '/query' && bodyObj?.op === 'select';
  const userId = session?.user.id;
  try {
    const res = await fetch(`${API}${path}`, { method: options.method || 'POST', headers, body });
    setOffline(false);
    const json = await res.json().catch(() => null);
    if (json && typeof json === 'object' && 'error' in json) return json as { data: T; error: ApiError };
    if (cacheable && userId) {
      const bucket = bucketFor(userId);
      bucket[cacheKeyFor(options.body)] = { t: Date.now(), res: { data: json, error: null } };
      saveBucket(userId, bucket);
    }
    return { data: json as T, error: null };
  } catch {
    if (cacheable && userId) {
      const hit = bucketFor(userId)[cacheKeyFor(options.body)];
      if (hit) {
        setOffline(true);
        return hit.res as { data: T; error: ApiError };
      }
    }
    setOffline(true);
    return {
      data: null as T,
      error: {
        message: cacheable
          ? 'You are offline and this page has no saved data yet. Reconnect once to cache it.'
          : 'You are offline — your change was NOT saved. Reconnect and try again.',
      },
    };
  }
}

type Filter = { column: string; operator: string; value: unknown };
type OrderBy = { column: string; ascending: boolean };

class QueryBuilder {
  private op = 'select';
  private selectCols = '*';
  private filters: Filter[] = [];
  private orderBy: OrderBy[] = [];
  private limitCount?: number;
  private payload?: Record<string, unknown>;
  private onConflict?: string;
  private single = false;

  constructor(private readonly table: string) {}

  select(cols = '*'): this {
    this.selectCols = cols;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push({ column, operator: 'eq', value });
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push({ column, operator: 'neq', value });
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push({ column, operator: 'in', value: values });
    return this;
  }
  order(column: string, opts: { ascending?: boolean } = {}): this {
    this.orderBy.push({ column, ascending: opts.ascending ?? true });
    return this;
  }
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }
  maybeSingle(): this {
    this.single = true;
    return this;
  }
  insert(data: Record<string, unknown>): this {
    this.op = 'insert';
    this.payload = data;
    return this;
  }
  update(data: Record<string, unknown>): this {
    this.op = 'update';
    this.payload = data;
    return this;
  }
  upsert(data: Record<string, unknown>, opts: { onConflict?: string } = {}): this {
    this.op = 'upsert';
    this.payload = data;
    this.onConflict = opts.onConflict;
    return this;
  }
  delete(): this {
    this.op = 'delete';
    return this;
  }

  then<TResult1 = QueryResponse, TResult2 = never>(
    onfulfilled?: ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<QueryResponse> {
    return request(`/query`, {
      body: {
        op: this.op,
        table: this.table,
        select: this.selectCols,
        filters: this.filters,
        order: this.orderBy,
        limit: this.limitCount,
        data: this.payload,
        onConflict: this.onConflict,
        single: this.single,
      },
    });
  }
}

export const supabase = {
  auth: {
    getSession: async () => {
      const session = readSession();
      if (!session) return { data: { session: null }, error: null };
      return { data: { session }, error: null };
    },

    onAuthStateChange: (callback: AuthListener): { data: { subscription: { unsubscribe: () => void } } } => {
      authListeners.push(callback);
      const session = readSession();
      if (session) callback('INITIAL_SESSION', session);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              authListeners = authListeners.filter((listener) => listener !== callback);
            },
          },
        },
      };
    },

    signUp: async ({ email, password, options }: { email: string; password: string; options?: { data?: Record<string, unknown> } }) => {
      const res = await request<{ user: SessionUser }>('/auth/signup', { body: { email, password, data: options?.data || {} } });
      return { data: { user: res.data?.user ?? null }, error: res.error };
    },

    signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
      const res = await request<{ user: SessionUser; session: Session }>('/auth/login', { body: { email, password } });
      if (res.error || !res.data?.session) {
        return { data: { user: null, session: null }, error: res.error };
      }
      const session = res.data.session;
      writeSession(session);
      for (const listener of authListeners) listener('SIGNED_IN', session);
      return { data: { user: session.user, session }, error: null };
    },

    signOut: async () => {
      const current = readSession();
      writeSession(null);
      // Wipe this user's offline cache from disk so shared computers never
      // leak their last-seen data to the next person.
      if (current) clearOfflineCache(current.user.id);
      for (const listener of authListeners) listener('SIGNED_OUT', null);
      return { error: null };
    },

    updateUser: async ({ password }: { password: string }) => {
      const res = await request<{ user: SessionUser }>('/auth/update-password', { body: { password } });
      return { data: { user: readSession()?.user ?? null }, error: res.error };
    },

    getUser: async () => ({ data: { user: readSession()?.user ?? null }, error: null }),

    // Initiates a reset: the server creates a one-hour token bound to the email
    // and returns it (no mail provider in this project), so the UI can offer the
    // user a clickable reset link.
    resetPasswordForEmail: async (email: string, options?: { redirectTo?: string }) => {
      const res = await request<{ ok?: boolean; code?: string | null }>('/auth/reset-password', { body: { email, redirectTo: options?.redirectTo } });
      return { data: { code: res.data?.code ?? null }, error: res.error };
    },

    // Completes a reset: exchanges the emailed/linked token for a new password.
    resetPassword: async ({ email, token, password }: { email: string; token: string; password: string }) => {
      const res = await request<{ ok?: boolean }>('/auth/reset-password', { body: { email, token, newPassword: password } });
      return { data: { ok: res.data?.ok ?? false }, error: res.error };
    },
  },

  from: (table: string): QueryBuilder => new QueryBuilder(table),

  rpc: async (name: string, args: Record<string, unknown>) => request<null>('/rpc', { body: { name, args } }),

  storage: {
    from: (bucket: string) => ({
      upload: async (path: string, file: File | Blob, opts: { contentType?: string; upsert?: boolean } = {}) => {
        const form = new FormData();
        form.append('bucket', bucket);
        form.append('path', path);
        form.append('file', file);
        form.append('contentType', opts.contentType || 'application/octet-stream');
        const res = await request<{ path: string | null }>('/storage/upload', { form });
        return { data: { path: res.data?.path ?? null }, error: res.error };
      },
      createSignedUrl: async (path: string, expiresIn?: number) => request<{ signedUrl: string }>('/storage/signed-url', { body: { bucket, path, expiresIn } }),
      remove: async (paths: string[]) => request<null>('/storage/remove', { body: { bucket, paths } }),
    }),
  },
};