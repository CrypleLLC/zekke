'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { PRIVATE_TEXT_PROPS, type DocumentView } from '@/lib/app';
import { UndoIcon } from '@/components/ui/icons';
import { TableMenu } from './TableMenu';
import { useToolMenu } from './useToolMenu';
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_LINE_HEIGHT,
  FONT_FAMILIES,
  FONT_GROUPS,
  FONT_SIZE_MAX_PX,
  FONT_SIZE_MIN_PX,
  FONT_SIZES,
  HIGHLIGHT_COLORS,
  LINE_HEIGHTS,
  TEXT_COLORS,
  TEXT_COLOR_COLUMNS,
  fontSizeFromInput,
  fontSizePixels,
  pickerColor,
  safeFontFamily,
  stepFontSize,
} from '@/lib/document-styles';

const BLOCK_STYLES = [
  { label: 'Body text', level: 0 },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
] as const;

const MARKS = ['bold', 'italic', 'underline', 'strike', 'code'] as const;
const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;

type MarkName = (typeof MARKS)[number];

const MARK_BUTTONS: Record<MarkName, { label: string; glyph: ReactNode }> = {
  bold: {
    label: 'Bold',
    glyph: <span className="text-sm font-bold leading-none">B</span>,
  },
  italic: {
    label: 'Italic',
    glyph: <span className="font-serif text-sm italic leading-none">I</span>,
  },
  underline: {
    label: 'Underline',
    glyph: <span className="text-sm leading-none underline">U</span>,
  },
  strike: {
    label: 'Strikethrough',
    glyph: <span className="text-sm leading-none line-through">S</span>,
  },
  code: {
    label: 'Inline code',
    glyph: <span className="font-mono text-xs leading-none">{'{}'}</span>,
  },
};

export default function DocumentToolbar({
  editor,
  baseFont,
  view,
  onViewChange,
  rulersShown,
  onRulersShownChange,
  docked = false,
  inline = false,
  onInsertImage,
  onPrint,
}: {
  editor: Editor | null;
  baseFont: string;
  view: DocumentView;
  onViewChange: (view: DocumentView) => void;
  rulersShown: boolean;
  onRulersShownChange: (shown: boolean) => void;
  docked?: boolean;
  inline?: boolean;
  onInsertImage?: () => void;
  onPrint?: () => void;
}) {
  const state = useEditorState({
    editor,
    selector: () => {
      const active = editor;
      if (active === null) {
        return undefined;
      }

      return {
        canUndo: active.can().undo(),
        canRedo: active.can().redo(),
        headingLevel: headingLevel(active),
        fontFamily: (active.getAttributes('textStyle').fontFamily as string | undefined) ?? null,
        fontSize: (active.getAttributes('textStyle').fontSize as string | undefined) ?? null,
        textColor: (active.getAttributes('textStyle').color as string | undefined) ?? null,
        cellColor:
          (active.getAttributes('tableCell').backgroundColor as string | undefined) ??
          (active.getAttributes('tableHeader').backgroundColor as string | undefined) ??
          null,
        highlightColor: active.isActive('highlight')
          ? ((active.getAttributes('highlight').color as string | undefined) ?? null)
          : null,
        lineHeight:
          (active.getAttributes('paragraph').lineHeight as string | undefined) ??
          (active.getAttributes('heading').lineHeight as string | undefined) ??
          null,
        marks: Object.fromEntries(MARKS.map((mark) => [mark, active.isActive(mark)])) as Record<
          MarkName,
          boolean
        >,
        alignments: Object.fromEntries(
          ALIGNMENTS.map((alignment) => [alignment, active.isActive({ textAlign: alignment })]),
        ) as Record<(typeof ALIGNMENTS)[number], boolean>,
        bulletList: active.isActive('bulletList'),
        orderedList: active.isActive('orderedList'),
        taskList: active.isActive('taskList'),
        blockquote: active.isActive('blockquote'),
        codeBlock: active.isActive('codeBlock'),
        link: active.isActive('link'),
        linkHref: (active.getAttributes('link').href as string | undefined) ?? '',
        canLink: active.isActive('link') || !active.state.selection.empty,
        inTable: active.isActive('table'),
      };
    },
  });

  if (editor === null || state === undefined || state === null) {
    return <div className="h-12" />;
  }

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className={`zekke-no-print flex items-center gap-1 py-1.5 ${inline ? 'min-w-0 flex-1' : 'px-3'} ${
        docked ? 'zekke-toolbar-docked flex-nowrap overflow-x-auto' : 'flex-wrap'
      }`}
    >
      <ToolButton
        label="Undo"
        disabled={!state.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <UndoIcon className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        label="Redo"
        disabled={!state.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <UndoIcon flipped className="h-4 w-4" />
      </ToolButton>

      <Divider />

      <Select
        label="Paragraph style"
        value={String(state.headingLevel)}
        onChange={(value) => applyBlockStyle(editor, Number(value))}
        options={BLOCK_STYLES.map((style) => ({
          label: style.label,
          value: String(style.level),
        }))}
        width="w-32"
      />

      <FontFamilySelect
        value={safeFontFamily(state.fontFamily) ?? baseFont}
        onChange={(value) => editor.chain().focus().setFontFamily(value).run()}
      />

      <FontSizeControl
        size={state.fontSize ?? DEFAULT_FONT_SIZE}
        onApply={(size) => editor.chain().focus().setFontSize(size).run()}
        onCancel={() => editor.commands.focus()}
      />

      <Select
        label="Line spacing"
        value={state.lineHeight ?? DEFAULT_LINE_HEIGHT}
        onChange={(value) => editor.chain().focus().setLineHeight(value).run()}
        options={LINE_HEIGHTS}
        width="w-24"
      />

      <Divider />

      {MARKS.map((mark) => (
        <ToolButton
          key={mark}
          label={MARK_BUTTONS[mark].label}
          pressed={state.marks[mark]}
          onClick={() => editor.chain().focus().toggleMark(mark).run()}
        >
          {MARK_BUTTONS[mark].glyph}
        </ToolButton>
      ))}

      <ColorMenu
        label="Text colour"
        colors={TEXT_COLORS}
        columns={TEXT_COLOR_COLUMNS}
        current={state.textColor}
        clearLabel="Default colour"
        custom
        onPick={(color) => editor.chain().focus().setColor(color).run()}
        onClear={() => editor.chain().focus().unsetColor().run()}
      >
        <span className="text-sm font-semibold leading-none">A</span>
      </ColorMenu>
      <ColorMenu
        label="Highlight"
        colors={HIGHLIGHT_COLORS}
        columns={6}
        current={state.highlightColor}
        clearLabel="No highlight"
        onPick={(color) => editor.chain().focus().setHighlight({ color }).run()}
        onClear={() => editor.chain().focus().unsetHighlight().run()}
      >
        <HighlightGlyph />
      </ColorMenu>
      <ColorMenu
        label="Cell colour"
        colors={TEXT_COLORS}
        columns={TEXT_COLOR_COLUMNS}
        current={state.inTable ? state.cellColor : null}
        clearLabel="No fill"
        custom
        disabled={!state.inTable}
        onPick={(color) => editor.chain().focus().setCellAttribute('backgroundColor', color).run()}
        onClear={() => editor.chain().focus().setCellAttribute('backgroundColor', null).run()}
      >
        <CellFillGlyph />
      </ColorMenu>

      <Divider />

      {ALIGNMENTS.map((alignment) => (
        <ToolButton
          key={alignment}
          label={`Align ${alignment}`}
          pressed={state.alignments[alignment]}
          onClick={() => editor.chain().focus().setTextAlign(alignment).run()}
        >
          <AlignGlyph alignment={alignment} />
        </ToolButton>
      ))}

      <Divider />

      <ToolButton
        label="Bulleted list"
        pressed={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <ListGlyph ordered={false} />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        pressed={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListGlyph ordered />
      </ToolButton>
      <ToolButton
        label="Checklist"
        pressed={state.taskList}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <CheckGlyph />
      </ToolButton>
      <ToolButton
        label="Quote"
        pressed={state.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <span className="font-serif text-base leading-none">&ldquo;</span>
      </ToolButton>
      <ToolButton
        label="Code block"
        pressed={state.codeBlock}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <span className="font-mono text-xs leading-none">&lt;/&gt;</span>
      </ToolButton>

      <Divider />

      <LinkControl
        editor={editor}
        active={state.link}
        href={state.linkHref}
        enabled={state.canLink}
      />

      <TableMenu editor={editor} />

      {onInsertImage !== undefined && (
        <ToolButton label="Insert image" onClick={onInsertImage}>
          <ImageGlyph />
        </ToolButton>
      )}

      <ToolButton label="Page break" onClick={() => editor.chain().focus().setPageBreak().run()}>
        <PageBreakGlyph />
      </ToolButton>
      <ToolButton
        label="Horizontal rule"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <span className="text-sm leading-none">—</span>
      </ToolButton>
      <ToolButton
        label="Clear formatting"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <ClearGlyph />
      </ToolButton>

      {!docked && (
        <>
          <Divider />
          <ViewControls
            view={view}
            onViewChange={onViewChange}
            rulersShown={rulersShown}
            onRulersShownChange={onRulersShownChange}
            onPrint={onPrint}
            divided
          />
        </>
      )}
    </div>
  );
}

export function ViewControls({
  view,
  onViewChange,
  rulersShown,
  onRulersShownChange,
  divided = false,
  onPrint = () => window.print(),
}: {
  view: DocumentView;
  onViewChange: (view: DocumentView) => void;
  rulersShown: boolean;
  onRulersShownChange: (shown: boolean) => void;
  divided?: boolean;
  onPrint?: () => void;
}) {
  return (
    <>
      <ToolButton
        label="Page view"
        pressed={view === 'pages'}
        onClick={() => onViewChange('pages')}
      >
        <PagesGlyph />
      </ToolButton>
      <ToolButton
        label="Continuous view"
        pressed={view === 'continuous'}
        onClick={() => onViewChange('continuous')}
      >
        <ContinuousGlyph />
      </ToolButton>
      <ToolButton
        label={rulersShown ? 'Hide rulers' : 'Show rulers'}
        pressed={view === 'pages' && rulersShown}
        disabled={view !== 'pages'}
        onClick={() => onRulersShownChange(!rulersShown)}
      >
        <RulerGlyph />
      </ToolButton>

      {divided && <Divider />}

      <ToolButton label="Print or save as PDF" onClick={onPrint}>
        <PrintGlyph />
      </ToolButton>
    </>
  );
}

function headingLevel(editor: Editor): number {
  for (const style of BLOCK_STYLES) {
    if (style.level > 0 && editor.isActive('heading', { level: style.level })) {
      return style.level;
    }
  }
  return 0;
}

function applyBlockStyle(editor: Editor, level: number): void {
  if (level === 0) {
    editor.chain().focus().setParagraph().run();
    return;
  }
  editor
    .chain()
    .focus()
    .setHeading({ level: level as 1 | 2 | 3 })
    .run();
}

function LinkControl({
  editor,
  active,
  href,
  enabled,
}: {
  editor: Editor;
  active: boolean;
  href: string;
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(href);
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(href);
    input.current?.focus();
    input.current?.select();

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        close();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, href, close]);

  const apply = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
    close();
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    close();
  };

  return (
    <div className="relative" ref={container}>
      <ToolButton
        label={active ? 'Edit link' : 'Add link'}
        pressed={active}
        disabled={!enabled}
        onClick={() => setOpen((previous) => !previous)}
      >
        <LinkGlyph />
      </ToolButton>

      {open && (
        <div
          data-popover
          className="absolute left-0 top-full z-30 mt-1 flex items-center gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-lift"
        >
          <input
            ref={input}
            aria-label="Link address"
            {...PRIVATE_TEXT_PROPS}
            type="url"
            inputMode="url"
            placeholder="https://example.com"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                apply();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
                editor.commands.focus();
              }
            }}
            className="h-8 w-56 rounded-md border border-line bg-transparent px-2 text-sm text-ink placeholder:text-ink-faint focus-visible:border-brand-500 focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={apply}
            className="h-8 rounded-md bg-brand-600 px-2.5 text-sm text-white transition-colors hover:bg-brand-700"
          >
            Apply
          </button>
          {active && (
            <button
              type="button"
              onClick={remove}
              className="h-8 rounded-md px-2.5 text-sm text-ink-soft transition-colors hover:bg-raised"
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />;
}

function ToolButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 disabled:cursor-not-allowed disabled:opacity-40 ${
        pressed ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-raised hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
  width,
}: {
  label: string;
  value: string;
  options: readonly { label: string; value: string }[];
  onChange: (value: string) => void;
  width: string;
}) {
  return (
    <select
      aria-label={label}
      title={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`${width} h-8 rounded-md border border-transparent bg-transparent px-1 text-sm text-ink-soft transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function FontFamilySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label="Font"
      title="Font"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={{ fontFamily: value }}
      className="h-8 w-36 rounded-md border border-transparent bg-transparent px-1 text-sm text-ink-soft transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      {FONT_GROUPS.map((group) => (
        <optgroup key={group} label={group} style={{ fontFamily: 'var(--font-sans)' }}>
          {FONT_FAMILIES.filter((font) => font.group === group).map((font) => (
            <option key={font.value} value={font.value} style={{ fontFamily: font.value }}>
              {font.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function FontSizeControl({
  size,
  onApply,
  onCancel,
}: {
  size: string;
  onApply: (size: string) => void;
  onCancel: () => void;
}) {
  const shown = String(fontSizePixels(size));
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const apply = (next: string) => {
    setDraft(null);
    setOpen(false);
    onApply(next);
  };

  const commitDraft = () => {
    const next = draft === null ? undefined : fontSizeFromInput(draft);
    if (next === undefined) {
      setDraft(null);
      return;
    }
    apply(next);
  };

  return (
    <div className="relative flex items-center" ref={container}>
      <input
        aria-label="Font size"
        title={`Font size (${FONT_SIZE_MIN_PX}–${FONT_SIZE_MAX_PX})`}
        {...PRIVATE_TEXT_PROPS}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={draft ?? shown}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitDraft();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(null);
            setOpen(false);
            onCancel();
          }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const from = (draft === null ? undefined : fontSizeFromInput(draft)) ?? size;
            apply(stepFontSize(from, event.key === 'ArrowUp' ? 1 : -1));
          }
        }}
        className="h-8 w-10 rounded-l-md border border-transparent bg-transparent px-1 text-center text-sm text-ink-soft transition-colors hover:bg-raised focus-visible:border-brand-500 focus-visible:text-ink focus-visible:outline-none"
      />
      <button
        type="button"
        aria-label="Font sizes"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Font sizes"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((previous) => !previous)}
        className="flex h-8 w-5 items-center justify-center rounded-r-md text-ink-soft transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
      >
        <ChevronGlyph />
      </button>

      {open && (
        <div
          ref={list}
          role="listbox"
          aria-label="Font sizes"
          data-popover
          className="absolute left-0 top-full z-30 mt-1 max-h-64 w-16 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lift"
        >
          {FONT_SIZES.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === size}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => apply(option)}
              className={`block w-full rounded-md px-2 py-1 text-left text-sm transition-colors ${
                option === size
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-ink-soft hover:bg-raised hover:text-ink'
              }`}
            >
              {fontSizePixels(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChevronGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5.5 8 4.5 4.5L14.5 8" />
    </svg>
  );
}

function ColorMenu({
  label,
  colors,
  columns,
  current,
  clearLabel,
  custom,
  disabled = false,
  onPick,
  onClear,
  children,
}: {
  label: string;
  colors: readonly string[];
  columns: number;
  current: string | null;
  clearLabel: string;
  custom?: boolean;
  disabled?: boolean;
  onPick: (color: string) => void;
  onClear: () => void;
  children: ReactNode;
}) {
  const { open, close, toggle, containerProps } = useToolMenu();

  const choose = (action: () => void) => {
    action();
    close();
  };

  const selected = current?.toLowerCase() ?? null;

  return (
    <div {...containerProps} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
        className={`flex h-8 min-w-8 flex-col items-center justify-center gap-0.5 rounded-md px-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 disabled:cursor-not-allowed disabled:opacity-40 ${
          open ? 'bg-raised text-ink' : 'text-ink-soft hover:bg-raised hover:text-ink'
        }`}
      >
        {children}
        <span
          aria-hidden="true"
          className="h-1 w-4 rounded-sm border border-line-strong"
          style={{ backgroundColor: current ?? 'transparent' }}
        />
      </button>

      {open && !disabled && (
        <div
          data-popover
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-30 mt-1 rounded-xl border border-line bg-surface p-2 shadow-lift"
        >
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(onClear)}
            className="mb-2 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-ink-soft transition-colors hover:bg-raised hover:text-ink"
          >
            <span aria-hidden="true" className="relative h-4 w-4 rounded border border-line-strong bg-surface">
              <span className="absolute left-1/2 top-[-2px] h-[calc(100%+4px)] w-px -translate-x-1/2 rotate-45 bg-danger" />
            </span>
            {clearLabel}
          </button>
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${columns}, 1.25rem)` }}
          >
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`${label} ${color}`}
                aria-pressed={selected === color}
                title={color}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(() => onPick(color))}
                style={{ backgroundColor: color }}
                className={`h-5 w-5 rounded border transition-transform hover:scale-110 ${
                  selected === color
                    ? 'border-brand-600 ring-2 ring-brand-500/60'
                    : 'border-line-strong'
                }`}
              />
            ))}
          </div>
          {custom && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-ink-soft transition-colors hover:bg-raised hover:text-ink">
              <input
                type="color"
                aria-label={`${label}: custom`}
                value={pickerColor(current)}
                onChange={(event) => choose(() => onPick(event.target.value))}
                className="h-5 w-5 cursor-pointer rounded border border-line-strong bg-transparent p-0"
              />
              Custom colour…
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function AlignGlyph({ alignment }: { alignment: 'left' | 'center' | 'right' | 'justify' }) {
  const insets: Record<typeof alignment, [number, number]> = {
    left: [3, 12],
    center: [5, 10],
    right: [8, 12],
    justify: [3, 14],
  };
  const [start, length] = insets[alignment];

  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 6h14" />
      <path d={`M${start} 10h${length}`} />
      <path d="M3 14h14" />
    </svg>
  );
}

function ListGlyph({ ordered }: { ordered: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
      aria-hidden="true"
    >
      <path d="M8 6h9M8 10h9M8 14h9" />
      {ordered ? (
        <text x="2" y="8" fontSize="6" fill="currentColor" stroke="none">
          1
        </text>
      ) : (
        <>
          <circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="4" cy="10" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="4" cy="14" r="1.2" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      aria-hidden="true"
    >
      <rect x="2.5" y="4" width="5" height="5" rx="1" />
      <path d="M3.5 14.5 5 16l2.5-3" />
      <path d="M10 6.5h7M10 14.5h7" />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
      aria-hidden="true"
    >
      <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2-2a3 3 0 1 0-4.2-4.2l-.8.8" />
      <path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 1 0 4.2 4.2l.8-.8" />
    </svg>
  );
}

function CellFillGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="14" height="14" rx="1.5" />
      <path d="M3 10h14M10 3v14" />
      <path d="M3 3h7v7H3z" fill="currentColor" fillOpacity="0.35" />
    </svg>
  );
}

function HighlightGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path
        d="M5 14 12.5 6.5l3 3L8 17H5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClearGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
      aria-hidden="true"
    >
      <path d="M7 5h9M10.5 5 8 15" />
      <path d="M3.5 9.5 8 14M8 9.5 3.5 14" />
    </svg>
  );
}

function ImageGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
      <circle cx="7.5" cy="8" r="1.5" />
      <path d="M3 15l4.5-4.5 3 3 2.5-2.5 4.5 4.5" strokeLinejoin="round" />
    </svg>
  );
}

function PageBreakGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 7.5V3.5h8V7.5" />
      <path d="M6 12.5v4h8v-4" />
      <path d="M3 10h3M8.5 10h3M14 10h3" strokeDasharray="0.1 3.4" strokeWidth="1.6" />
    </svg>
  );
}

function PagesGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      fill="none"
      aria-hidden="true"
    >
      <rect x="5" y="2.5" width="10" height="6.5" rx="1" />
      <rect x="5" y="11" width="10" height="6.5" rx="1" />
    </svg>
  );
}

function ContinuousGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
      aria-hidden="true"
    >
      <path d="M4 4.5h12M4 8.2h12M4 11.8h12M4 15.5h8" />
    </svg>
  );
}

function RulerGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      aria-hidden="true"
    >
      <rect x="2.5" y="6.5" width="15" height="7" rx="1" />
      <path d="M5.5 6.5v2.5M8.5 6.5v1.5M11.5 6.5v2.5M14.5 6.5v1.5" />
    </svg>
  );
}

function PrintGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 8V3.5h8V8" />
      <rect x="3" y="8" width="14" height="6" rx="1.5" />
      <rect x="6" y="12" width="8" height="4.5" rx="1" />
    </svg>
  );
}
