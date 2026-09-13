// One-shot refactor tool: splits src/App.tsx into modules by moving the EXACT
// declaration line ranges (no rewriting of bodies), then writes App.tsx as a
// shell. Deleted after the split lands. Restore sources (git restore) before
// re-running; src/types.ts gets appended to, so restore it too.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const src = readFileSync('src/App.tsx', 'utf8')
  // Same-line top-level declarations (`interface X {...}function Y(...)`) get one
  // decl per physical line; splitting is whitespace-only, safe for verbatim moves.
  .replace(/\}(?=function |interface |const |let |export )/g, '}\n');
const lines = src.split('\n');

// 1. Top-level declaration starts: functions, consts, and interfaces.
const startRe =
  /^(?:export default )?(?:async )?function ([A-Za-z_$][\w$]*)|^(?:const|let) ([A-Za-z_$][\w$]*)\s*[:=]|^interface ([A-Za-z_$][\w$]*)/;
const raw = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(startRe);
  if (m && !lines[i].startsWith(' ')) raw.push({ name: m[1] || m[2] || m[3], start: i });
}
// Multiple declarations can share one physical line (e.g. `interface X {...}function Y(...)`).
// Keep one decl per line; later names on that line become aliases of the first.
const decls = [];
const alias = {};
const seenStart = new Map();
for (const d of raw) {
  const first = seenStart.get(d.start);
  if (first) alias[d.name] = first;
  else { seenStart.set(d.start, d.name); decls.push(d); }
}
const canon = (n) => alias[n] || n;

// 2. End each declaration at the next top-level declaration line.
for (let i = 0; i < decls.length; i++) {
  const next = decls[i + 1];
  let end = next ? next.start : lines.length;
  while (end > decls[i].start + 1 && lines[end - 1].trim() === '') end--;
  decls[i].end = end;
}
const byName = Object.fromEntries(decls.map((d) => [d.name, d]));
const text = (name) => lines
  .slice(byName[canon(name)].start, byName[canon(name)].end)
  .filter((l) => l.trim() !== 'export default App;') // belongs to the shell only
  .join('\n');

// 3. Module assignment. Every moved symbol listed once (aliases excluded).
const modules = {
  'src/lib/ui.ts': ['cn', 'formatDate', 'today', 'friendlyError', 'authErrorMessage', 'useLiveRefresh'],
  'src/components/shared.tsx': ['roleStyles', 'greetingInfo', 'useTheme', 'LoadingScreen', 'DeniedScreen', 'RoleBadge', 'PasswordField', 'Avatar', 'PageHeader', 'StatCard', 'calculateStreak', 'ActivityGrid', 'ContributionRow', 'StatusPill', 'EmptyState', 'LoadingPanel', 'ErrorBanner', 'NotFound'],
  'src/components/viewer.tsx': ['ReviewReferences', 'CodeBlock', 'FileViewer', 'FileLink', 'NoteFileLink'],
  'src/components/AppShell.tsx': ['ShellProps', 'AppShell'],
  'src/components/ContributionDetail.tsx': ['syncContributionReviewState', 'ContributionDetail'],
  'src/pages/auth.tsx': ['PasswordResetScreen', 'AuthScreen'],
  'src/pages/student.tsx': ['FormValues', 'Dashboard', 'Contributions', 'ContributionForm', 'Progress', 'longestStreak', 'Notifications', 'ProfilePage', 'SettingsPage'],
  'src/pages/teacher.tsx': ['TeacherDashboard', 'Students', 'StudentDetail'],
  'src/pages/learning-path.tsx': ['SyllabusSection', 'LearningPath', 'NotesSection', 'NoteCard', 'NoteManageModal'],  'src/pages/admin.tsx': ['AdminDashboard', 'useAdminNotes', 'AdminNotesSection', 'AdminNotesBoard', 'AdminNoteDetail'],
};
// Interfaces shared by several modules land in the existing types file.
const TYPES_APPEND = ['AdminNote', 'NoteFeedbackItem'];

// 4. Sanity: every module member must exist; nothing may land twice.
const placed = new Set();
for (const [file, names] of Object.entries(modules)) {
  for (const name of names) {
    if (!byName[name]) { console.error(`MISSING in App.tsx: ${name} (wanted in ${file})`); process.exit(1); }
    if (placed.has(name)) { console.error(`DUPLICATE placement: ${name}`); process.exit(1); }
    placed.add(name);
  }
}

// 5. Shared vocabulary: lucide specifiers (with aliases), exported type names.
const lucideLocal = new Map(); // local name -> original lucide name
for (const m of src.matchAll(/import\s*{([^}]+)}\s*from 'lucide-react'/g)) {
  for (const part of m[1].split(',')) {
    const t = part.trim();
    if (!t) continue;
    const am = t.match(/^(\w+)\s+as\s+(\w+)$/);
    if (am) lucideLocal.set(am[2], am[1]);
    else lucideLocal.set(t, t);
  }
}
const typesSrc = readFileSync('src/types.ts', 'utf8');
const allTypeNames = [...typesSrc.matchAll(/^export (?:type|interface) (\w+)/gm)].map((m) => m[1]).concat(TYPES_APPEND);
const HELPERS = ['cn', 'formatDate', 'today', 'friendlyError', 'authErrorMessage', 'useLiveRefresh'];
const REACT_TOKENS = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'FormEvent', 'ReactNode', 'ChangeEvent'];

const ownerOf = {};
for (const [file, names] of Object.entries(modules)) for (const n of names) { ownerOf[n] = file; ownerOf[canon(n)] = file; }

function buildModule(file, names) {
  const isTypes = file === 'src/types.ts';
  const moved = names.concat(isTypes ? [] : []);
  const chunks = moved.map(text);
  const body = chunks.join('\n\n');
  const used = new Set();
  for (const chunk of chunks) {
    for (const m of chunk.matchAll(/\b([A-Za-z_][\w$]*)\b/g)) used.add(m[1]);
  }
  const importLines = [];
  // Cross-module imports (owner-resolved).
  const fromUi = [], fromShared = [], other = [];
  for (const name of [...used].sort()) {
    const owner = ownerOf[name];
    if (!owner || owner === file) continue;
    if (HELPERS.includes(name)) fromUi.push(name);
    else if (owner === 'src/components/shared.tsx') fromShared.push(name);
    else other.push([name, owner]);
  }
  if (fromUi.length) importLines.push(`import { ${fromUi.join(', ')} } from '@/lib/ui';`);
  if (fromShared.length) importLines.push(`import { ${fromShared.join(', ')} } from '@/components/shared';`);
  for (const [name, from] of other) importLines.push(`import { ${name} } from '@/${from.replace(/^src\//, '').replace(/\.tsx$/, '')}';`);
  // React hooks/types actually used.
  const reactUsed = REACT_TOKENS.filter((t) => chunks.some((c) => new RegExp(`\\b${t}\\b`).test(c)));
  if (reactUsed.length) importLines.unshift(`import { ${reactUsed.join(', ')} } from 'react';`);
  // lucide icons incl. aliases.
  const iconParts = [];
  for (const [local, orig] of [...lucideLocal.entries()].sort()) {
    if (chunks.some((c) => new RegExp(`\\b${local}\\b`).test(c))) iconParts.push(local === orig ? local : `${orig} as ${local}`);
  }
  if (iconParts.length && file.endsWith('.tsx')) importLines.push(`import { ${iconParts.join(', ')} } from 'lucide-react';`);
  // Domain types from @/types (skip names this file itself declares or lucide locals).
  const localDecl = new Set(names);
  const typeImports = allTypeNames.filter((t) => !localDecl.has(t) && !lucideLocal.has(t) && chunks.some((c) => new RegExp(`\\b${t}\\b`).test(c)));
  if (typeImports.length) importLines.push(`import type { ${typeImports.join(', ')} } from '@/types';`);
  if (chunks.some((c) => /(^|[^.\w])supabase\b/.test(c))) importLines.push(`import { supabase } from '@/lib/supabase';`);

  // Export every moved symbol (name-anchored, survives same-line declarations).
  let exported = body;
  for (const name of moved) {
    if (lines[byName[canon(name)].start].startsWith('interface')) {
      exported = exported.replace(new RegExp(`\\binterface ${canon(name)}\\b`), `export interface ${canon(name)}`);
    } else {
      exported = exported.replace(new RegExp(`\\b(async )?function ${canon(name)}\\b`), (_m, as) => `export ${as || ''}function ${canon(name)}`);
      exported = exported.replace(new RegExp(`\\b(const|let) ${canon(name)}\\b`), `export const ${canon(name)}`);
    }
  }
  if (isTypes) {
    // Append to the existing hand-written types file.
    const current = readFileSync(file, 'utf8');
    writeFileSync(file, `${current.replace(/\s*$/, '')}\n\n// Moved verbatim from App.tsx during the module split.\n${chunks.join('\n').replace(/^interface /gm, 'export interface ')}\n`);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${importLines.join('\n')}\n\n${exported}\n`);
  }
  console.log(`${file}${isTypes ? ' (append)' : ''}: ${names.length} decls, ${body.split('\n').length} lines`);
}

for (const [file, names] of Object.entries(modules)) { if (file === 'src/types.ts') continue; buildModule(file, names); }
buildModule('src/types.ts', TYPES_APPEND);

// 6. Rewrite App.tsx as the shell: auth/session (App) stays; everything else imported.
const appChunk = text('App');
const appUsed = new Set();
for (const m of appChunk.matchAll(/\b([A-Za-z_][\w$]*)\b/g)) appUsed.add(m[1]);
const importLines = [];
const reactUsed = REACT_TOKENS.filter((t) => new RegExp(`\\b${t}\\b`).test(appChunk));
if (reactUsed.length) importLines.push(`import { ${reactUsed.join(', ')} } from 'react';`);
const shellFrom = {};
for (const name of appUsed) {
  const owner = ownerOf[name];
  if (!owner) continue;
  (shellFrom[owner] ||= []).push(name);
}
for (const [file, names] of Object.entries(shellFrom)) {
  importLines.push(`import { ${names.sort().join(', ')} } from '@/${file.replace(/^src\//, '').replace(/\.tsx$/, '')}';`);
}
const iconParts = [];
for (const [local, orig] of [...lucideLocal.entries()].sort()) {
  if (appUsed.has(local)) iconParts.push(local === orig ? local : `${orig} as ${local}`);
}
if (iconParts.length) importLines.push(`import { ${iconParts.join(', ')} } from 'lucide-react';`);
const typeImports = allTypeNames.filter((t) => !lucideLocal.has(t) && appUsed.has(t));
if (typeImports.length) importLines.push(`import type { ${typeImports.join(', ')} } from '@/types';`);
if (/(^|[^.\w])supabase\b/.test(appChunk)) importLines.push(`import { supabase } from '@/lib/supabase';`);
const outApp = `${importLines.join('\n')}\n\n${appChunk}\n\nexport default App;\n`;
writeFileSync('src/App.tsx', outApp);
console.log(`src/App.tsx shell: ${outApp.split('\n').length} lines`);
