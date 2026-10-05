'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Doc as YDoc } from 'yjs';
import { META_MAP, readTitle, writeTitle } from '@/lib/documents';
import { PRIVATE_TEXT_PROPS } from '@/lib/app';

const TITLE_ORIGIN = Symbol('Zekke/documents/title-input');

export function TitleInput({ doc, label, placeholder }: { doc: YDoc; label: string; placeholder: string }) {
  const [title, setTitle] = useState(() => readTitle(doc));

  useEffect(() => {
    setTitle(readTitle(doc));

    const meta = doc.getMap(META_MAP);
    const observer = (_event: unknown, transaction: { origin: unknown }) => {
      if (transaction.origin !== TITLE_ORIGIN) {
        setTitle(readTitle(doc));
      }
    };

    meta.observe(observer);
    return () => meta.unobserve(observer);
  }, [doc]);

  const onChange = useCallback(
    (next: string) => {
      setTitle(next);
      writeTitle(doc, next, TITLE_ORIGIN);
    },
    [doc],
  );

  return (
    <input
      aria-label={label}
      {...PRIVATE_TEXT_PROPS}
      value={title}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="w-full max-w-md truncate rounded-lg border border-transparent bg-transparent px-2 py-1 text-headline text-ink transition-colors placeholder:text-ink-faint hover:border-line-strong focus-visible:border-brand-500 focus-visible:outline-none"
    />
  );
}

export function SaveStatus({ label, gapDetected, gapMessage }: { label: string; gapDetected: boolean; gapMessage: string }) {
  return (
    <p
      aria-live="polite"
      className={`px-1 text-caption normal-case tracking-normal ${
        gapDetected ? 'text-warning' : 'text-ink-muted'
      }`}
    >
      {gapDetected ? gapMessage : label}
    </p>
  );
}
