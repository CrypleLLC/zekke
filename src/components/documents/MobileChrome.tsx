'use client';

import type { ReactNode, Ref } from 'react';
import type { SaveIndicator } from '@/lib/app';

const SAVE_DOT_COLOURS: Record<SaveIndicator, string> = {
  opening: 'bg-ink-faint',
  unsaved: 'bg-red-500',
  saving: 'bg-yellow-400',
  saved: 'bg-emerald-500',
};

export function SaveDot({ indicator, label }: { indicator: SaveIndicator; label: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      data-indicator={indicator}
      className="inline-flex h-9 w-6 shrink-0 items-center justify-center"
    >
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 rounded-full transition-colors duration-200 ${SAVE_DOT_COLOURS[indicator]}`}
      />
    </span>
  );
}

export function OutlineButton({
  onClick,
  expanded,
}: {
  onClick: () => void;
  expanded?: boolean;
}) {
  const label =
    expanded === undefined ? 'Outline' : expanded ? 'Collapse outline' : 'Expand outline';

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-haspopup={expanded === undefined ? 'dialog' : undefined}
      aria-expanded={expanded}
      onClick={onClick}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border shadow-raised transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
        expanded ? 'border-brand-500/40 bg-brand-50 text-brand-700' : 'border-line bg-surface text-ink-muted'
      }`}
    >
      <svg
        viewBox="0 0 20 20"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M8 5.5h9M10.5 10h6.5M10.5 14.5h6.5" />
        <circle cx="4.5" cy="5.5" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="7" cy="10" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="7" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    </button>
  );
}

export function FormatDock({
  shown,
  children,
  ref,
}: {
  shown: boolean;
  children: ReactNode;
  ref: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} data-shown={shown ? '' : undefined} className="zekke-no-print zekke-format-dock">
      {children}
    </div>
  );
}
