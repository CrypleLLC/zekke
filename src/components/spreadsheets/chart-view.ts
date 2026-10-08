import {
  CommandType,
  ICommandService,
  IUniverInstanceService,
  UniverInstanceType,
  type IDisposable,
  type Univer,
  type Workbook,
  type Worksheet,
} from '@univerjs/core';
import { IRenderManagerService, type IRender, type Viewport } from '@univerjs/engine-render';
import { SheetsSelectionsService } from '@univerjs/sheets';
import { SheetSkeletonManagerService } from '@univerjs/sheets-ui';
import { lineStart, type ChartValue, type ContentRect, type GridRange, type LineLayout } from '@/lib/spreadsheets';

const MAIN_VIEWPORT = 'viewMain';
export const CHART_MAX_ROWS = 10_000;

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SheetView {
  sheetId: string;
  rows: LineLayout;
  columns: LineLayout;
  scaleX: number;
  scaleY: number;
  clip: ScreenRect;
  toScreen(rect: ContentRect): ScreenRect;
}

export function chartValues(worksheet: Worksheet, range: GridRange): ChartValue[][] {
  const endRow = Math.min(range.endRow, range.startRow + CHART_MAX_ROWS - 1);
  const grid: ChartValue[][] = [];
  for (let row = range.startRow; row <= endRow; row += 1) {
    const line: ChartValue[] = [];
    for (let column = range.startColumn; column <= range.endColumn; column += 1) {
      const value = worksheet.getCellRaw(row, column)?.v;
      line.push(typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' ? value : null);
    }
    grid.push(line);
  }
  return grid;
}

function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export class ChartViewSource {
  private readonly instances: IUniverInstanceService;
  private readonly renders: IRenderManagerService;
  private readonly commands: ICommandService;
  private readonly selections: SheetsSelectionsService;

  constructor(
    univer: Univer,
    private readonly unitId: string,
  ) {
    const injector = univer.__getInjector();
    this.instances = injector.get(IUniverInstanceService);
    this.renders = injector.get(IRenderManagerService);
    this.commands = injector.get(ICommandService);
    this.selections = injector.get(SheetsSelectionsService);
  }

  private workbook(): Workbook | undefined {
    return this.instances.getUnit<Workbook>(this.unitId, UniverInstanceType.UNIVER_SHEET) ?? undefined;
  }

  private render(): IRender | undefined {
    return this.renders.getRenderUnitById(this.unitId) ?? undefined;
  }

  private viewport(): Viewport | undefined {
    return this.render()?.scene.getViewport(MAIN_VIEWPORT);
  }

  activeSheetId(): string | undefined {
    return this.workbook()?.getActiveSheet()?.getSheetId();
  }

  selection(): GridRange | undefined {
    const range = this.selections.getCurrentLastSelection()?.range;
    if (range === undefined) {
      return undefined;
    }
    return { startRow: range.startRow, endRow: range.endRow, startColumn: range.startColumn, endColumn: range.endColumn };
  }

  values(sheetId: string, range: GridRange): ChartValue[][] {
    const worksheet = this.workbook()?.getSheetBySheetId(sheetId);
    return worksheet === undefined || worksheet === null ? [] : chartValues(worksheet, range);
  }

  read(layer: HTMLElement): SheetView | undefined {
    const render = this.render();
    const viewport = this.viewport();
    const worksheet = this.workbook()?.getActiveSheet();
    if (render === undefined || viewport === undefined || worksheet === undefined || worksheet === null) {
      return undefined;
    }
    const skeleton = render.with(SheetSkeletonManagerService).getCurrentSkeleton();
    const canvas = render.engine.getCanvasElement();
    if (skeleton === undefined || skeleton === null || canvas === null || canvas === undefined) {
      return undefined;
    }

    const origin = skeleton.getNoMergeCellWithCoordByIndex(0, 0);
    const rows: LineLayout = { origin: origin.startY, ends: skeleton.rowHeightAccumulation };
    const columns: LineLayout = { origin: origin.startX, ends: skeleton.columnWidthAccumulation };
    const { scaleX, scaleY } = render.scene.getAncestorScale();
    const freeze = worksheet.getFreeze();
    const freezeWidth = lineStart(columns, freeze.startColumn) - lineStart(columns, freeze.startColumn - freeze.xSplit);
    const freezeHeight = lineStart(rows, freeze.startRow) - lineStart(rows, freeze.startRow - freeze.ySplit);

    const canvasRect = canvas.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    const styleWidth = pixels(canvas.style.width);
    const adjust = styleWidth > 0 ? canvasRect.width / styleWidth : 1;
    const offsetLeft = canvasRect.left - layerRect.left;
    const offsetTop = canvasRect.top - layerRect.top;
    const { left, top, viewportScrollX, viewportScrollY } = viewport;

    const screenX = (x: number) =>
      offsetLeft +
      adjust * (x > left ? (x - viewportScrollX) * scaleX : (freezeWidth + columns.origin - (left - x)) * scaleX);
    const screenY = (y: number) =>
      offsetTop + adjust * (y > top ? (y - viewportScrollY) * scaleY : (freezeHeight + rows.origin - (top - y)) * scaleY);

    const clipLeft = offsetLeft + adjust * (columns.origin + freezeWidth) * scaleX;
    const clipTop = offsetTop + adjust * (rows.origin + freezeHeight) * scaleY;

    return {
      sheetId: worksheet.getSheetId(),
      rows,
      columns,
      scaleX: scaleX * adjust,
      scaleY: scaleY * adjust,
      clip: {
        left: clipLeft,
        top: clipTop,
        width: Math.max(0, offsetLeft + canvasRect.width - clipLeft),
        height: Math.max(0, offsetTop + canvasRect.height - clipTop),
      },
      toScreen(rect) {
        const x = screenX(rect.left);
        const y = screenY(rect.top);
        return { left: x, top: y, width: rect.width * scaleX * adjust, height: rect.height * scaleY * adjust };
      },
    };
  }

  forwardWheel(event: WheelEvent): void {
    const canvas = this.render()?.engine.getCanvasElement();
    canvas?.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  subscribe(onView: () => void, onData: () => void): () => void {
    const disposables: IDisposable[] = [];
    let viewport: Viewport | undefined;
    let scroll: { unsubscribe(): void } | undefined;
    let engineRect: { unsubscribe(): void } | undefined;
    let engine: unknown;

    const watchRender = () => {
      const render = this.render();
      const current = render?.scene.getViewport(MAIN_VIEWPORT);
      if (current !== viewport) {
        scroll?.unsubscribe();
        viewport = current;
        scroll = current?.onScrollAfter$.subscribeEvent(() => onView());
      }
      if (render !== undefined && render.engine !== engine) {
        engineRect?.unsubscribe();
        engine = render.engine;
        engineRect = render.engine.clientRect$.subscribe({
          next: () => onView(),
          error: () => {
            engine = undefined;
          },
        });
      }
    };

    const created = this.renders.created$.subscribe(() => {
      watchRender();
      onView();
    });
    disposables.push(
      this.commands.onCommandExecuted((info) => {
        watchRender();
        if (info.type === CommandType.MUTATION) {
          onData();
        } else {
          onView();
        }
      }),
    );
    const onResize = () => onView();
    window.addEventListener('resize', onResize);
    watchRender();

    return () => {
      created.unsubscribe();
      scroll?.unsubscribe();
      engineRect?.unsubscribe();
      window.removeEventListener('resize', onResize);
      for (const disposable of disposables) {
        disposable.dispose();
      }
    };
  }
}
