import type * as Y from 'yjs';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import { Color, FontFamily, FontSize, LineHeight, TextStyle } from '@tiptap/extension-text-style';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { CharacterCount, Placeholder, Selection } from '@tiptap/extensions';
import { BODY_FRAGMENT } from '@/lib/documents';
import {
  highlightColorAttribute,
  safeColor,
  safeFontFamily,
  safeFontSize,
  safeLineHeight,
  styleAttribute,
} from '@/lib/document-styles';
import { PageBreak } from './pageBreak';
import { ColouredTableCell, ColouredTableHeader, RowResizing, SizedTableRow } from './tableRows';
import { TableHandle } from './tableHandle';
import { ColumnResizing, FittedTableView } from './tableColumns';
import { Pagination } from './pagination';
import { DocumentImage } from './imageNode';
import type { DocumentImageHost } from './imageHost';

export const BODY_PLACEHOLDER = 'Start writing…';

const GuardedColor = Color.extend({
  addGlobalAttributes() {
    return [
      { types: this.options.types, attributes: { color: styleAttribute('color', 'color', safeColor) } },
    ];
  },
});

const GuardedFontFamily = FontFamily.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: { fontFamily: styleAttribute('fontFamily', 'font-family', safeFontFamily) },
      },
    ];
  },
});

const GuardedFontSize = FontSize.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: { fontSize: styleAttribute('fontSize', 'font-size', safeFontSize) },
      },
    ];
  },
});

const GuardedLineHeight = LineHeight.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: { lineHeight: styleAttribute('lineHeight', 'line-height', safeLineHeight) },
      },
    ];
  },
});

const GuardedHighlight = Highlight.extend({
  addAttributes() {
    return { color: highlightColorAttribute() };
  },
});

export function documentExtensions(
  doc: Y.Doc,
  options: { paginated?: boolean; images?: DocumentImageHost } = {},
) {
  return [
    StarterKit.configure({
      undoRedo: false,
      link: { openOnClick: false, autolink: true },
    }),
    Collaboration.configure({ document: doc, field: BODY_FRAGMENT }),
    TextStyle,
    GuardedColor,
    GuardedFontFamily,
    GuardedFontSize,
    GuardedLineHeight.configure({ types: ['heading', 'paragraph'] }),
    GuardedHighlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({
      table: { resizable: false, View: FittedTableView, allowTableNodeSelection: true },
      tableRow: false,
      tableCell: false,
      tableHeader: false,
    }),
    SizedTableRow,
    ColouredTableCell,
    ColouredTableHeader,
    RowResizing,
    ColumnResizing,
    TableHandle,
    PageBreak,
    DocumentImage.configure({ host: options.images }),
    Pagination.configure({ paginated: options.paginated ?? true }),
    CharacterCount,
    Selection,
    Placeholder.configure({ placeholder: BODY_PLACEHOLDER }),
  ];
}
