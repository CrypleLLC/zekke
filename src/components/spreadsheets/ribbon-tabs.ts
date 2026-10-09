import { LocaleService, type Univer } from '@univerjs/core';
import { IRibbonService } from '@univerjs/ui';

export interface RibbonTab {
  key: string;
  title: string;
}

export interface RibbonTabsState {
  tabs: RibbonTab[];
  active: string | undefined;
}

export const EMPTY_RIBBON_TABS: RibbonTabsState = { tabs: [], active: undefined };

export class RibbonTabsSource {
  private readonly ribbon: IRibbonService;
  private readonly locale: LocaleService;

  constructor(univer: Univer) {
    const injector = univer.__getInjector();
    this.ribbon = injector.get(IRibbonService);
    this.locale = injector.get(LocaleService);
  }

  subscribe(listener: (state: RibbonTabsState) => void): () => void {
    let state = EMPTY_RIBBON_TABS;
    const tabs = this.ribbon.ribbon$.subscribe((groups) => {
      state = { ...state, tabs: groups.map((group) => ({ key: group.key, title: this.locale.t(group.title ?? group.key) })) };
      listener(state);
    });
    const active = this.ribbon.activatedTab$.subscribe((key) => {
      state = { ...state, active: key };
      listener(state);
    });
    return () => {
      tabs.unsubscribe();
      active.unsubscribe();
    };
  }

  select(key: string): void {
    this.ribbon.setActivatedTab(key);
  }
}
