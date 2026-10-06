import {
  CommandType,
  CustomCommandExecutionError,
  RedoCommandId,
  UndoCommandId,
  type ICommandInfo,
  type IExecutionOptions,
  type IWorkbookData,
  type Univer,
} from '@univerjs/core';
import * as Y from 'yjs';
import {
  FORMULA_CODEC,
  META_MAP,
  NAMES,
  SHEETS,
  SHEET_ORDER,
  applyOperations,
  readAxis,
  readSheet,
  type CapacityRefusal,
  type Dimension,
  type FormulaCodec,
  type Operation,
  type SheetMap,
} from '@/lib/spreadsheets';
import { CapacityGauge, mutationGrowth } from './capacity';
import { applyChanges, reconcileNames, type ApplyContext } from './apply';
import { MutationCapture } from './capture';
import { collectChanges, emptyChanges, hasChanges, type Changes } from './changes';
import { WorkbookMirror } from './mirror';
import { UniverSurface } from './surface';

export const CAPTURE_ORIGIN = Symbol('spreadsheet-capture');

export interface SpreadsheetBindingOptions {
  univer: Univer;
  unitId: string;
  doc: Y.Doc;
  codec?: FormulaCodec;
  capacityLimitBytes?: number;
  onCapacityRefused?: (refusal: CapacityRefusal) => void;
}

export class CapacityRefusedError extends CustomCommandExecutionError {
  constructor(readonly refusal: CapacityRefusal) {
    super(`refused: the spreadsheet would pass its capacity (${refusal.reason})`);
    this.name = 'CapacityRefusedError';
  }
}

export class SpreadsheetBinding {
  readonly undoManager: Y.UndoManager;
  readonly capacity: CapacityGauge;
  private readonly surface: UniverSurface;
  private readonly mirror: WorkbookMirror;
  private readonly codec: FormulaCodec;
  private readonly capture: MutationCapture;
  private readonly unboundCounts = new Map<string, number>();
  private readonly disposers: (() => void)[] = [];
  private pending: Operation[] = [];
  private changes: Changes = emptyChanges();
  private commandDepth = 0;
  private applying = false;
  private settleScheduled = false;
  private disposed = false;

  constructor(private readonly options: SpreadsheetBindingOptions) {
    const { univer, unitId, doc } = options;
    this.codec = options.codec ?? FORMULA_CODEC;
    this.surface = new UniverSurface(univer, unitId);
    this.mirror = WorkbookMirror.fromDoc(doc);
    this.capacity = new CapacityGauge(doc, options.capacityLimitBytes);
    this.capture = new MutationCapture({
      surface: this.surface,
      mirror: this.mirror,
      codec: this.codec,
      knownIds: (sheetId, dimension) => this.knownIds(sheetId, dimension),
    });
    this.undoManager = new Y.UndoManager(
      [doc.getArray(SHEET_ORDER), doc.getMap(SHEETS), doc.getMap(NAMES), doc.getMap(META_MAP)],
      { trackedOrigins: new Set([CAPTURE_ORIGIN]) },
    );

    const commands = this.surface.commands;
    const before = commands.beforeCommandExecuted((info, executionOptions) => this.beforeCommand(info, executionOptions));
    const after = commands.onCommandExecuted((info, executionOptions) => this.afterCommand(info, executionOptions));
    const onTransaction = (transaction: Y.Transaction) => this.onTransaction(transaction);
    doc.on('afterTransaction', onTransaction);
    this.disposers.push(
      () => before.dispose(),
      () => after.dispose(),
      () => doc.off('afterTransaction', onTransaction),
      () => this.undoManager.destroy(),
      () => this.capacity.dispose(),
    );

    this.withApplying(() => reconcileNames(this.applyContext()));
    this.surface.clearUniverHistory();
  }

  get unbound(): ReadonlyMap<string, number> {
    return this.unboundCounts;
  }

  undo(): void {
    this.flush();
    this.undoManager.undo();
  }

  redo(): void {
    this.flush();
    this.undoManager.redo();
  }

  editSheet(sheetId: string, addedBytes: number, change: (sheet: SheetMap) => void): boolean {
    if (this.disposed) {
      return false;
    }
    const sheet = readSheet(this.options.doc, sheetId);
    if (sheet === undefined) {
      return false;
    }
    this.flush();
    const refusal = this.capacity.refusal(addedBytes, 0);
    if (refusal !== undefined) {
      this.options.onCapacityRefused?.(refusal);
      return false;
    }
    this.undoManager.stopCapturing();
    this.options.doc.transact(() => change(sheet), CAPTURE_ORIGIN);
    this.undoManager.stopCapturing();
    return true;
  }

  workbookSnapshot(): IWorkbookData {
    this.flush();
    return this.surface.snapshot();
  }

  activeSheetId(): string {
    return this.surface.activeSheetId();
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  settle(): void {
    this.settleScheduled = false;
    if (this.disposed) {
      return;
    }
    this.flush();
    if (!hasChanges(this.changes)) {
      return;
    }
    const changes = this.changes;
    this.changes = emptyChanges();
    this.withApplying(() => applyChanges(this.applyContext(), changes));
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.flush();
    this.disposed = true;
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
  }

  private applyContext(): ApplyContext {
    return { doc: this.options.doc, surface: this.surface, mirror: this.mirror, codec: this.codec };
  }

  private withApplying(work: () => void): void {
    this.applying = true;
    try {
      work();
    } finally {
      this.applying = false;
    }
  }

  private knownIds(sheetId: string, dimension: Dimension): ReadonlySet<string> {
    const sheet = readSheet(this.options.doc, sheetId);
    return sheet === undefined ? new Set() : readAxis(sheet, dimension).allIds();
  }

  private beforeCommand(info: ICommandInfo, executionOptions?: IExecutionOptions): void {
    if (this.applying) {
      return;
    }
    if (info.type === CommandType.MUTATION) {
      if (!executionOptions?.onlyLocal && !executionOptions?.fromCollab) {
        this.guardCapacity(info);
      }
      return;
    }
    if (info.type !== CommandType.COMMAND) {
      return;
    }
    this.commandDepth += 1;
    if (info.id === UndoCommandId) {
      this.undo();
    } else if (info.id === RedoCommandId) {
      this.redo();
    }
  }

  private guardCapacity(info: ICommandInfo): void {
    const growth = mutationGrowth(this.surface, info.id, (info.params ?? {}) as Record<string, unknown>);
    const refusal = this.capacity.refusal(growth.addedBytes, growth.largestCellBytes);
    if (refusal !== undefined) {
      this.options.onCapacityRefused?.(refusal);
      throw new CapacityRefusedError(refusal);
    }
  }

  private afterCommand(info: ICommandInfo, executionOptions?: IExecutionOptions): void {
    if (this.applying) {
      return;
    }
    if (info.type === CommandType.COMMAND) {
      this.commandDepth = Math.max(0, this.commandDepth - 1);
      if (this.commandDepth === 0) {
        this.flush();
        this.undoManager.stopCapturing();
        this.surface.clearUniverHistory();
      }
      return;
    }
    if (info.type !== CommandType.MUTATION || executionOptions?.onlyLocal || executionOptions?.fromCollab) {
      return;
    }
    const result = this.capture.capture(info.id, (info.params ?? {}) as Record<string, unknown>);
    if ('unbound' in result) {
      this.unboundCounts.set(info.id, (this.unboundCounts.get(info.id) ?? 0) + 1);
      return;
    }
    if ('operations' in result) {
      this.pending.push(...result.operations);
    }
    if (this.commandDepth === 0) {
      this.flush();
    } else {
      this.scheduleSettle();
    }
  }

  private flush(): void {
    if (this.pending.length === 0) {
      return;
    }
    const operations = this.pending;
    this.pending = [];
    applyOperations(this.options.doc, operations, CAPTURE_ORIGIN);
  }

  private onTransaction(transaction: Y.Transaction): void {
    if (transaction.origin === CAPTURE_ORIGIN || this.disposed) {
      return;
    }
    collectChanges(this.options.doc, transaction, this.changes);
    if (hasChanges(this.changes)) {
      this.scheduleSettle();
    }
  }

  private scheduleSettle(): void {
    if (this.settleScheduled) {
      return;
    }
    this.settleScheduled = true;
    queueMicrotask(() => this.settle());
  }
}
