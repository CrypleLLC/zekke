import {
  ICommandService,
  IUndoRedoService,
  IUniverInstanceService,
  UniverInstanceType,
  type ICellData,
  type IStyleData,
  type IWorkbookData,
  type Univer,
  type Workbook,
  type Worksheet,
} from '@univerjs/core';
import { FormulaDataModel, IDefinedNamesService, type IDefinedNamesServiceParam } from '@univerjs/engine-formula';
import type { StyleData } from '@/lib/spreadsheets';

export class UniverSurface {
  readonly commands: ICommandService;
  private readonly instances: IUniverInstanceService;
  private readonly undoRedo: IUndoRedoService;
  private readonly definedNames: IDefinedNamesService;
  private readonly formulaData: FormulaDataModel | undefined;

  constructor(
    univer: Univer,
    readonly unitId: string,
  ) {
    const injector = univer.__getInjector();
    this.commands = injector.get(ICommandService);
    this.instances = injector.get(IUniverInstanceService);
    this.undoRedo = injector.get(IUndoRedoService);
    this.definedNames = injector.get(IDefinedNamesService);
    this.formulaData = injector.has(FormulaDataModel) ? injector.get(FormulaDataModel) : undefined;
  }

  workbook(): Workbook {
    const workbook = this.instances.getUnit<Workbook>(this.unitId, UniverInstanceType.UNIVER_SHEET);
    if (workbook === null || workbook === undefined) {
      throw new Error('The spreadsheet unit is not loaded.');
    }
    return workbook;
  }

  worksheet(sheetId: string): Worksheet | undefined {
    return this.workbook().getSheetBySheetId(sheetId) ?? undefined;
  }

  snapshot(): IWorkbookData {
    return this.workbook().save();
  }

  activeSheetId(): string {
    return this.workbook().getActiveSheet().getSheetId();
  }

  sheetOrder(): string[] {
    return [...this.workbook().getSheetOrders()];
  }

  apply(id: string, params: object): boolean {
    return this.commands.syncExecuteCommand(id, params, { fromCollab: true });
  }

  rawCell(sheetId: string, row: number, column: number): ICellData {
    return { ...(this.worksheet(sheetId)?.getCellRaw(row, column) ?? {}) };
  }

  cellFormula(sheetId: string, row: number, column: number, cell: ICellData): string | undefined {
    if (typeof cell.f === 'string' && cell.f.length > 0) {
      return cell.f;
    }
    if (typeof cell.si === 'string' && cell.si.length > 0) {
      return this.formulaData?.getFormulaStringByCell(row, column, sheetId, this.unitId) ?? undefined;
    }
    return undefined;
  }

  styleData(style: unknown): StyleData | undefined {
    const resolved =
      typeof style === 'string'
        ? this.workbook().getStyles().get(style)
        : typeof style === 'object' && style !== null
          ? (style as IStyleData)
          : undefined;
    if (resolved === undefined || resolved === null) {
      return undefined;
    }
    const data = JSON.parse(JSON.stringify(resolved)) as StyleData;
    return Object.keys(data).length > 0 ? data : undefined;
  }

  definedName(id: string): IDefinedNamesServiceParam | undefined {
    return this.definedNames.getValueById(this.unitId, id) ?? undefined;
  }

  definedNameIds(): string[] {
    return Object.keys(this.definedNames.getDefinedNameMap(this.unitId) ?? {});
  }

  clearUniverHistory(): void {
    this.undoRedo.clearUndoRedo(this.unitId);
  }
}
