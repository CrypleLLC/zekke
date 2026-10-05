'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Doc as YDoc } from 'yjs';
import { META_MAP, readTitle, writeTitle } from '@/lib/documents';
import { PRIVATE_TEXT_PROPS } from '@/lib/app';

const TITLE_ORIGIN = Symbol('Zekke/documents/title-input');

export function TitleInput({
  doc,
  label,
  placeholder,
  compact = false,
  fit = false,
}: {
  doc: YDoc;
  label: string;
  placeholder: string;
  compact?: boolean;
  fit?: boolean;
}) {
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

  const box = `rounded-lg border border-transparent ${
    compact ? 'px-1.5 py-1 text-title' : 'px-2 py-1 text-headline'
  }`;
  const input = (
    <input
      aria-label={label}
      {...PRIVATE_TEXT_PROPS}
      value={title}
      placeholder={placeholder}
      size={fit ? 1 : undefined}
      onChange={(event) => onChange(event.target.value)}
      className={`w-full truncate bg-transparent text-ink transition-colors placeholder:text-ink-faint hover:border-line-strong focus-visible:border-brand-500 focus-visible:outline-none ${box} ${
        compact || fit ? '' : 'max-w-md'
      } ${fit ? 'col-start-1 row-start-1 min-w-0' : ''}`}
    />
  );

  if (!fit) {
    return input;
  }

  return (
    <span className="inline-grid max-w-md grid-cols-[minmax(0,auto)] align-top">
      <span
        aria-hidden="true"
        translate="no"
        className={`invisible col-start-1 row-start-1 overflow-hidden whitespace-pre pr-4 ${box}`}
      >
        {title.length > 0 ? title : placeholder}
      </span>
      {input}
    </span>
  );
}

export function SaveStatus({ label, gapDetected, gapMessage }: { label: string; gapDetected: boolean; gapMessage: string }) {
  return (
    <p
      aria-live="polite"
      className={`px-2.25 text-caption normal-case tracking-normal ${
        gapDetected ? 'text-warning' : 'text-ink-muted'
      }`}
    >
      {gapDetected ? gapMessage : label}
    </p>
  );
}
