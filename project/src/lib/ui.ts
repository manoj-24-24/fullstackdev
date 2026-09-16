import { useEffect } from 'react';

export const cn = (...classes: Array<string | false | null | undefined>): string => classes.filter(Boolean).join(' ');

export const formatDate = (date: string): string => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T00:00:00`));

export const today = (): string => new Date().toISOString().slice(0, 10);

export const friendlyError = (): string => 'Something went wrong. Please try again.';

// ---- Upload acceptance: PDF stays first-class, and documents, images,
// video, audio, archives, spreadsheets and code files are allowed on top.
// Google Docs exports (application/vnd.openxmlformats-officedocument.*, .gdoc)
// and legacy Office formats are included explicitly.
export const UPLOAD_ACCEPT = [
  'application/pdf',
  'image/*',
  'video/*',
  'audio/*',
  '.txt', '.md', '.csv',
  '.doc', '.docx', '.odt', '.rtf', '.pages',
  '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp', '.key',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.html', '.json', '.xml', '.yml', '.yaml', '.sql', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rs', '.php', '.rb', '.sh',
  '.gdoc', '.gsheet', '.gslides', '.gdraw',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed', 'application/x-7z-compressed', 'application/gzip', 'application/x-tar',
  'text/plain', 'text/markdown', 'text/csv', 'text/html', 'text/css', 'application/json', 'application/xml', 'text/xml',
  'application/rtf', 'application/x-rtf',
].join(',');

const UPLOAD_ALLOWED_PREFIXES = ['image/', 'video/', 'audio/', 'text/'];
const UPLOAD_ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed', 'application/x-7z-compressed', 'application/gzip', 'application/x-tar',
  'application/json', 'application/xml', 'application/rtf', 'application/x-rtf',
  'application/octet-stream',
  'application/gdoc', 'application/gsheet', 'application/gslides', 'application/gdraw',
]);
const UPLOAD_ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.doc', '.docx', '.odt', '.rtf', '.pages',
  '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp', '.key',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.html', '.htm', '.json', '.xml', '.yml', '.yaml', '.sql', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rs', '.php', '.rb', '.sh',
  '.gdoc', '.gsheet', '.gslides', '.gdraw',
]);

// True when the browser-reported MIME type or the file extension is on the
// accepted list. Some browsers report Google Docs exports as octet-stream or
// an empty type, so the extension check is what catches those.
export const isUploadAllowed = (file: { type?: string; name?: string }): boolean => {
  const type = (file.type || '').toLowerCase();
  if (type && (UPLOAD_ALLOWED_PREFIXES.some((p) => type.startsWith(p)) || UPLOAD_ALLOWED_TYPES.has(type))) return true;
  const name = (file.name || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot >= 0 && UPLOAD_ALLOWED_EXTENSIONS.has(name.slice(dot));
};

export const uploadTypeHint = 'PDF, Word, Excel, PowerPoint, images, video, audio, ZIP, code, and Google Docs exports · 25 MB maximum';

// One honest message for every failed upload: the server's own reason when it
// gave one (too large, wrong type…), otherwise a connection problem — which is
// what "Offline — showing your saved data" in the corner means.
export const uploadFailedMessage = (error?: { message?: string } | null): string => {
  if (error?.message) return `Upload failed: ${error.message}`;
  return 'Upload failed — the app could not reach the server. Check your connection (the Offline notice at the bottom means you are offline) and try again.';
};
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
