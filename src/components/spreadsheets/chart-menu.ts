import { CommandType, ICommandService, UniverInstanceType, type Univer } from '@univerjs/core';
import {
  IconManager,
  IMenuManagerService,
  MenuItemType,
  RibbonInsertGroup,
  getMenuHiddenObservable,
  type IMenuItem,
} from '@univerjs/ui';
import type { ComponentType } from 'react';

export const INSERT_CHART_OPERATION_ID = 'zekke.operation.insert-chart';
export const CHART_MENU_ICON = 'ZekkeChartIcon';
const CHART_MENU_ORDER = 1;

export function registerChartMenu(
  univer: Univer,
  { title, icon, onInsert }: { title: string; icon: ComponentType<{ className?: string }>; onInsert: () => void },
): () => void {
  const injector = univer.__getInjector();
  const command = injector.get(ICommandService).registerCommand({
    id: INSERT_CHART_OPERATION_ID,
    type: CommandType.OPERATION,
    handler: () => {
      onInsert();
      return true;
    },
  });
  const iconRegistration = injector.get(IconManager).register(CHART_MENU_ICON, icon);
  injector.get(IMenuManagerService).mergeMenu({
    [RibbonInsertGroup.MEDIA]: {
      [INSERT_CHART_OPERATION_ID]: {
        order: CHART_MENU_ORDER,
        menuItemFactory: (accessor): IMenuItem => ({
          id: INSERT_CHART_OPERATION_ID,
          type: MenuItemType.BUTTON,
          icon: CHART_MENU_ICON,
          title,
          tooltip: title,
          hidden$: getMenuHiddenObservable(accessor, UniverInstanceType.UNIVER_SHEET),
        }),
      },
    },
  });
  return () => {
    command.dispose();
    iconRegistration.dispose();
  };
}
