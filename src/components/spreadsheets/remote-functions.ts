import type { Univer } from '@univerjs/core';
import { IFunctionService } from '@univerjs/engine-formula';

export const REMOTE_FUNCTIONS = ['IMAGE'] as const;

export function withoutRemoteFunctions(univer: Univer): void {
  const functions = univer.__getInjector().get(IFunctionService);
  functions.unregisterExecutors(...REMOTE_FUNCTIONS);
  functions.unregisterDescriptions(...REMOTE_FUNCTIONS);
}
