'use client';

import { useEffect, useId, useMemo, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { outlineTree, type OutlineEntry, type OutlineNode } from '@/lib/documents';
import { UNTITLED_HEADING } from '@/lib/app';
import { CloseIcon } from '@/components/ui/icons';
import { trapDialogKeys, useDialogLifecycle } from '@/components/modal';
import { OutlineButton } from './MobileChrome';
import { goToHeading } from './useOutline';

interface OutlineProps {
  editor: Editor | null;
  entries: readonly OutlineEntry[];
  active: number | undefined;
}

export function OutlinePanel({
  editor,
  entries,
  active,
  expanded,
  onToggle,
}: OutlineProps & { expanded: boolean; onToggle: () => void }) {
  return (
    <div className="zekke-no-print sticky top-[calc(var(--staging-banner-h)+var(--doc-chrome-h,8rem)+1.5rem)] z-[6] w-0 shrink-0 overflow-visible">
      <div className={expanded ? 'zekke-outline bg-ground' : 'w-max'}>
        <OutlineButton expanded={expanded} onClick={onToggle} />
        {expanded && (
          <OutlineList
            entries={entries}
            active={active}
            onSelect={(pos) => editor !== null && goToHeading(editor, pos)}
            className="mt-2 max-h-[calc(100vh-var(--staging-banner-h)-var(--doc-chrome-h,8rem)-5.75rem)]"
          />
        )}
      </div>
    </div>
  );
}

export function OutlineDrawer({ editor, entries, active, onClose }: OutlineProps & { onClose: () => void }) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);

  useDialogLifecycle(dialog);

  return (
    <div
      className="zekke-no-print fixed inset-x-0 top-[var(--staging-banner-h)] bottom-0 z-50 flex bg-ink/40"
      onClick={onClose}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => trapDialogKeys(event, dialog.current, onClose)}
        className="flex h-full w-[min(20rem,85vw)] animate-slide-in-left flex-col motion-reduce:animate-none border-r border-line bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-lift outline-none"
      >
        <header className="flex shrink-0 items-center justify-between px-4 pt-3 pb-1">
          <h2 id={titleId} className="text-title text-ink">
            Outline
          </h2>
          <button
            type="button"
            aria-label="Close outline"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>
        <OutlineList
          entries={entries}
          active={active}
          onSelect={(pos) => {
            if (editor !== null) {
              goToHeading(editor, pos, { focus: false });
            }
            onClose();
          }}
          className="min-h-0 flex-1 px-2 pb-3"
        />
      </div>
    </div>
  );
}

function OutlineList({
  entries,
  active,
  onSelect,
  className,
}: {
  entries: readonly OutlineEntry[];
  active: number | undefined;
  onSelect: (pos: number) => void;
  className: string;
}) {
  const nav = useRef<HTMLElement>(null);
  const tree = useMemo(() => outlineTree(entries), [entries]);

  useEffect(() => {
    const panel = nav.current;
    const row = panel?.querySelector<HTMLElement>('[aria-current="location"]');
    if (panel === null || panel === undefined || row === null || row === undefined) {
      return;
    }
    const top = row.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
    if (top < panel.scrollTop) {
      panel.scrollTop = top;
    } else if (top + row.offsetHeight > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = top + row.offsetHeight - panel.clientHeight;
    }
  }, [active]);

  return (
    <nav ref={nav} aria-label="Document outline" className={`overflow-y-auto p-2 ${className}`}>
      {entries.length === 0 ? (
        <p className="px-2 py-3 text-caption normal-case tracking-normal text-ink-muted">
          Headings you add appear here.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {tree.map((node) => (
            <OutlineRow key={node.pos} node={node} depth={0} active={active} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </nav>
  );
}

function OutlineRow({
  node,
  depth,
  active,
  onSelect,
}: {
  node: OutlineNode;
  depth: number;
  active: number | undefined;
  onSelect: (pos: number) => void;
}) {
  const current = node.pos === active;
  const named = node.text.trim().length > 0;

  return (
    <li>
      <button
        type="button"
        aria-current={current ? 'location' : undefined}
        onClick={() => onSelect(node.pos)}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
        className={`flex w-full items-baseline gap-2 rounded-md py-1 pr-2 text-left text-sm transition-colors ${
          current ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-line hover:text-ink'
        } ${named ? '' : 'italic text-ink-faint'}`}
      >
        <span aria-hidden="true" className="shrink-0 not-italic">
          •
        </span>
        <span className="min-w-0 whitespace-normal break-words">
          {named ? node.text : UNTITLED_HEADING}
        </span>
      </button>
      {node.children.length > 0 && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <OutlineRow key={child.pos} node={child} depth={depth + 1} active={active} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}
