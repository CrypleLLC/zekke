'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  REBUILD_LABELS,
  documentHref,
  rebuildConsequences,
  rebuildErrorMessage,
  rebuildOutcomeMessage,
  rebuildSavingLabel,
} from '@/lib/app';
import type { DocumentSync } from '@/lib/documents';
import {
  apiRebuildSteps,
  rebuildEstimate,
  rebuildSpreadsheetItem,
  type RebuildEstimate,
} from '@/lib/spreadsheets';
import { Modal, ModalActions } from '@/components/modal';
import { Button, Notice, Spinner } from '@/components/ui';
import { useAuthedContext, useZekke } from '@/components/session/ZekkeProvider';

export default function RebuildDialog({ sync, onClose }: { sync: DocumentSync; onClose: () => void }) {
  const context = useAuthedContext();
  const { account, reportError } = useZekke();
  const router = useRouter();
  const [estimate, setEstimate] = useState<RebuildEstimate>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [outcome, setOutcome] = useState<{ id: string; message: string }>();

  useEffect(() => {
    const timer = setTimeout(() => setEstimate(rebuildEstimate(sync.doc)));
    return () => clearTimeout(timer);
  }, [sync]);

  async function rebuild() {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await rebuildSpreadsheetItem(sync, apiRebuildSteps(context));
      const problem = rebuildOutcomeMessage(result);
      if (problem === undefined) {
        router.replace(documentHref(result.id, 'spreadsheet'));
        return;
      }
      setOutcome({ id: result.id, message: problem });
    } catch (error) {
      setMessage(rebuildErrorMessage(error) ?? reportError(error));
    } finally {
      setBusy(false);
    }
  }

  const consequences = rebuildConsequences(account?.retention_days ?? 0);

  return (
    <Modal
      title={REBUILD_LABELS.title}
      onClose={busy ? () => undefined : onClose}
      footer={
        outcome !== undefined ? (
          <div className="flex justify-end">
            <Button onClick={() => router.replace(documentHref(outcome.id, 'spreadsheet'))}>{REBUILD_LABELS.openNew}</Button>
          </div>
        ) : (
          <ModalActions busy={busy} cancelLabel={REBUILD_LABELS.cancel} onCancel={onClose}>
            <Button variant="danger" disabled={busy || estimate === undefined} onClick={() => void rebuild()}>
              {busy ? REBUILD_LABELS.working : REBUILD_LABELS.confirm}
            </Button>
          </ModalActions>
        )
      }
    >
      <div className="flex flex-col gap-3 text-sm text-ink-soft">
        {estimate === undefined ? (
          <p className="flex items-center gap-2">
            <Spinner />
            {REBUILD_LABELS.measuring}
          </p>
        ) : (
          <p className="font-semibold text-ink">{rebuildSavingLabel(estimate)}</p>
        )}
        <ul className="list-disc space-y-1.5 pl-5">
          {consequences.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {message !== undefined ? <Notice tone="danger">{message}</Notice> : null}
        {outcome !== undefined ? <Notice tone="warning">{outcome.message}</Notice> : null}
      </div>
    </Modal>
  );
}
