'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Editor } from '@tiptap/react';
import { placeMenuAt, type MenuPlacement } from '@/lib/app';
import { evenColumnWidths, scaleColumnWidths } from '@/lib/document-tables';
import { selectTable } from './tableHandle';
import { cellAt, columnWidths, focusCell, tableAt, withColumnWidths } from './tableWidths';

interface MenuItem {
  id: string;
  label: string;
  destructive?: boolean;
  enabled: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

function resizeTable(editor: Editor, widths: (current: number[], textWidth: number) => number[]) {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const table = tableAt(tr);
      if (table === undefined) {
        return false;
      }
      const current = columnWidths(editor.view, table);
      withColumnWidths(tr, table, widths(current, editor.view.dom.clientWidth));
      return true;
    })
    .run();
}

const inTable = (editor: Editor) => tableAt(editor.state) !== undefined;

const GROUPS: readonly (readonly MenuItem[])[] = [
  [
    {
      id: 'row-above',
      label: 'Insert row above',
      enabled: (editor) => editor.can().addRowBefore(),
      run: (editor) => editor.chain().focus().addRowBefore().run(),
    },
    {
      id: 'row-below',
      label: 'Insert row below',
      enabled: (editor) => editor.can().addRowAfter(),
      run: (editor) => editor.chain().focus().addRowAfter().run(),
    },
    {
      id: 'row-delete',
      label: 'Delete row',
      destructive: true,
      enabled: (editor) => editor.can().deleteRow(),
      run: (editor) => editor.chain().focus().deleteRow().run(),
    },
  ],
  [
    {
      id: 'column-left',
      label: 'Insert column left',
      enabled: (editor) => editor.can().addColumnBefore(),
      run: (editor) => editor.chain().focus().addColumnBefore().run(),
    },
    {
      id: 'column-right',
      label: 'Insert column right',
      enabled: (editor) => editor.can().addColumnAfter(),
      run: (editor) => editor.chain().focus().addColumnAfter().run(),
    },
    {
      id: 'column-delete',
      label: 'Delete column',
      destructive: true,
      enabled: (editor) => editor.can().deleteColumn(),
      run: (editor) => editor.chain().focus().deleteColumn().run(),
    },
  ],
  [
    {
      id: 'fit',
      label: 'Fit to text width',
      enabled: inTable,
      run: (editor) => resizeTable(editor, (current, textWidth) => scaleColumnWidths(current, textWidth)),
    },
    {
      id: 'distribute',
      label: 'Distribute columns evenly',
      enabled: inTable,
      run: (editor) =>
        resizeTable(editor, (current) =>
          evenColumnWidths(
            current.reduce((sum, width) => sum + width, 0),
            current.length,
          ),
        ),
    },
  ],
  [
    {
      id: 'header',
      label: 'Toggle header row',
      enabled: (editor) => editor.can().toggleHeaderRow(),
      run: (editor) => editor.chain().focus().toggleHeaderRow().run(),
    },
    {
      id: 'select',
      label: 'Select table',
      enabled: inTable,
      run: (editor) => editor.chain().focus().command(({ tr }) => selectTable(tr)).run(),
    },
    {
      id: 'delete',
      label: 'Delete table',
      destructive: true,
      enabled: (editor) => editor.can().deleteTable(),
      run: (editor) => editor.chain().focus().deleteTable().run(),
    },
  ],
];

export function TableContextMenu({ editor }: { editor: Editor | null }) {
  const [pointer, setPointer] = useState<{ x: number; y: number }>();
  const [placement, setPlacement] = useState<MenuPlacement>();
  const menu = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setPointer(undefined);
    setPlacement(undefined);
  }, []);

  useEffect(() => {
    if (editor === null) {
      return;
    }
    const dom = editor.view.dom;
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target;
      const cellElement = target instanceof Element ? target.closest('td, th') : null;
      if (cellElement === null || !dom.contains(cellElement) || !editor.isEditable) {
        return;
      }
      const cellPos = cellAt(editor.state.doc, editor.view.posAtDOM(cellElement, 0));
      if (cellPos === undefined) {
        return;
      }
      event.preventDefault();
      const tr = editor.state.tr;
      if (focusCell(tr, cellPos)) {
        editor.view.dispatch(tr);
      }
      setPlacement(undefined);
      setPointer({ x: event.clientX, y: event.clientY });
    };
    dom.addEventListener('contextmenu', onContextMenu);
    return () => dom.removeEventListener('contextmenu', onContextMenu);
  }, [editor]);

  useLayoutEffect(() => {
    const element = menu.current;
    if (pointer === undefined || element === null) {
      return;
    }
    setPlacement(
      placeMenuAt(
        pointer,
        { width: element.offsetWidth, height: element.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    const timer = window.setTimeout(() => {
      element.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pointer]);

  useEffect(() => {
    if (pointer === undefined) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) {
        close();
      }
    };
    const onScroll = () => close();
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [pointer, close]);

  if (editor === null || pointer === undefined) {
    return null;
  }

  const run = (item: MenuItem) => {
    item.run(editor);
    close();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      editor.commands.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault();
    }
  };

  return (
    <div
      ref={menu}
      role="menu"
      aria-label="Table"
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      style={
        placement === undefined
          ? { left: pointer.x, top: pointer.y, visibility: 'hidden' }
          : { left: placement.left, top: placement.top }
      }
      className="zekke-no-print fixed z-40 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-lift"
    >
      {GROUPS.map((group, groupIndex) => (
        <div
          key={group[0].id}
          role="group"
          className={groupIndex > 0 ? 'mt-1 border-t border-line pt-1' : ''}
        >
          {group.map((item) => {
            const destructive = item.destructive === true;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={!item.enabled(editor)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => run(item)}
                className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
                  destructive
                    ? 'text-danger hover:bg-danger-bg focus-visible:bg-danger-bg'
                    : 'text-ink-soft hover:bg-raised hover:text-ink focus-visible:bg-raised focus-visible:text-ink'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
