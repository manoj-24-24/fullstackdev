import { useState, useEffect } from 'react';
import { Check, ClipboardCopy, FileText, Github, X } from 'lucide-react';
import type { ContributionFile } from '@/types';
import { supabase } from '@/lib/supabase';

export function ReviewReferences({ contributionId, githubUrl }: { contributionId: string; githubUrl?: string | null }): JSX.Element | null { const [files, setFiles] = useState<ContributionFile[]>([]); useEffect(() => { (async () => { const f = await supabase.from('contribution_files').select('*').eq('contribution_id', contributionId); setFiles((f.data || []) as ContributionFile[]); })(); }, [contributionId]); if (!files.length && !githubUrl) return null; return <div className="mt-4 border-t border-[#e5efec] pt-4"><p className="text-sm font-bold">References</p>{githubUrl && <a href={githubUrl} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-2 rounded-lg bg-white p-2.5 text-sm font-semibold text-[#087f78] hover:bg-[#e7f7f1]"><Github className="h-4 w-4" />Open GitHub repository</a>}{files.length > 0 && <div className="mt-2 space-y-2">{files.map((file) => <FileLink key={file.id} file={file} />)}</div>}</div>; }

// Full-screen in-app file viewer: opens the file in an overlay instead of
// leaving the app, so Back never kicks the user out. Works on desktop and
// mobile identically, with a big X button to close.
// Code block with a one-click copy-to-clipboard button in the corner.

export function CodeBlock({ code, compact }: { code: string; compact?: boolean }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard API can be denied (e.g. insecure context) — fall back.
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="group relative mt-6">
      <pre className={`overflow-x-auto rounded-xl bg-[#061c2c] text-xs leading-6 text-[#c3e8dc] ${compact ? 'max-h-48 p-4' : 'p-5'}`}><code>{code}</code></pre>
      <button
        onClick={() => void copy()}
        title={copied ? 'Copied!' : 'Copy code'}
        className={`absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${copied ? 'bg-[#087f78] text-white' : 'bg-white/10 text-[#c3e8dc] hover:bg-white/20'}`}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function FileViewer({ url, name, onClose }: { url: string; name: string; onClose: () => void }): JSX.Element {
  const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
  const isPdf = /\.pdf$/i.test(name);
  const [failed, setFailed] = useState(false);
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#061c2c]/95 backdrop-blur-sm" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 bg-[#061c2c] px-4 py-3 text-white sm:px-6">
        <p className="min-w-0 truncate text-sm font-bold">{name}</p>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            title="Open in a new tab"
            className="flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-bold text-white transition hover:bg-white/20"
          >
            <FileText className="h-4 w-4" />Open tab
          </a>
          <button
            onClick={onClose}
            title="Close and return"
            aria-label="Close viewer"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-3 sm:p-6" onClick={(e) => e.stopPropagation()}>
        {failed ? (
          <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
            <FileText className="mx-auto h-10 w-10 text-[#a33b3b]" />
            <p className="mt-4 break-all text-sm font-semibold">{name}</p>
            <p className="mt-2 text-sm text-[#a33b3b]">This file could not be loaded. It may have been uploaded before durable storage was enabled — remove and re-attach it once and it will work everywhere from then on.</p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <a href={url} target="_blank" rel="noreferrer" className="btn-secondary text-xs">Try new tab</a>
              <button onClick={onClose} className="btn-primary text-xs">Back to app</button>
            </div>
          </div>
        ) : isImage ? (
          <img src={url} alt={name} onError={() => setFailed(true)} className="max-h-full max-w-full rounded-xl bg-white object-contain shadow-2xl" />
        ) : isPdf ? (
          <iframe src={url} title={name} onError={() => setFailed(true)} className="h-full w-full max-w-5xl rounded-xl bg-white shadow-2xl" />
        ) : (
          <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
            <FileText className="mx-auto h-10 w-10 text-[#087f78]" />
            <p className="mt-4 break-all text-sm font-semibold">{name}</p>
            <p className="mt-2 text-xs text-[#6c8589]">This file type can't be shown inside the app.</p>
            <a href={url} target="_blank" rel="noreferrer" className="btn-primary mt-5 inline-flex">Open in new tab</a>
          </div>
        )}
      </div>
    </div>
  );
}

export function FileLink({ file }: { file: ContributionFile }): JSX.Element {
  const [url, setUrl] = useState('');
  const [viewing, setViewing] = useState(false);
  useEffect(() => { (async () => { const result = await supabase.storage.from('contribution-files').createSignedUrl(file.file_url, 3600); setUrl(result.data?.signedUrl || ''); })(); }, [file.file_url]);
  return url ? <>
    <button onClick={() => setViewing(true)} className="flex w-full items-center gap-3 rounded-xl bg-[#f5faf8] p-3 text-left text-sm font-semibold text-[#087f78] transition hover:bg-[#e7f7f1]"><FileText className="h-4 w-4 shrink-0" />{file.file_name}</button>
    {viewing && <FileViewer url={url} name={file.file_name} onClose={() => setViewing(false)} />}
  </> : <div className="text-sm text-[#8ca1a3]">Loading file…</div>;
}

export function NoteFileLink({ bucket, path, name }: { bucket: string; path: string; name: string }): JSX.Element { const [url, setUrl] = useState(''); useEffect(() => { (async () => { const result = await supabase.storage.from(bucket).createSignedUrl(path, 3600); setUrl(result.data?.signedUrl || ''); })(); }, [bucket, path]); return url ? <a href={url} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-3 rounded-xl bg-[#f5faf8] p-3 text-sm font-semibold text-[#087f78] hover:bg-[#e7f7f1]"><FileText className="h-4 w-4" />{name}</a> : <p className="mt-4 text-sm text-[#8ca1a3]">Preparing file…</p>; }

