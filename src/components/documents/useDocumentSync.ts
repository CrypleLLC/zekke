"use client";

import { useEffect, useMemo, useState } from "react";
import type * as Y from "yjs";
import {
  DocumentSync,
  apiTransport,
  isUntouched,
  writeDocumentFont,
  writePageMargins,
  DOCUMENT_SYNC_OPTIONS,
  type DocumentSyncOptions,
  type SyncState,
} from "@/lib/documents";
import { DEFAULT_DOCUMENT_FONT } from "@/lib/document-styles";
import { DEFAULT_PAGE_MARGINS } from "@/lib/document-page";
import { useAuthedContext, useZekke } from "@/components/session/ZekkeProvider";

export interface DocumentSyncHandle {
  sync?: DocumentSync;
  state: SyncState;
  error?: string;
}

const INITIAL_STATE: SyncState = {
  status: "loading",
  cursor: 0,
  snapshotSeq: 0,
  revision: 0,
  pending: 0,
  gapDetected: false,
  uploading: false,
  snapshotBytes: 0,
  logBytes: 0,
  capacity: "ok",
};

export interface DocumentSyncSetup {
  syncOptions?: DocumentSyncOptions;
  seedUntouched?: (doc: Y.Doc) => void;
}

const DOCUMENT_SETUP: DocumentSyncSetup = {
  syncOptions: DOCUMENT_SYNC_OPTIONS,
  seedUntouched: (doc) =>
    doc.transact(() => {
      writeDocumentFont(doc, DEFAULT_DOCUMENT_FONT);
      writePageMargins(doc, DEFAULT_PAGE_MARGINS);
    }),
};

export function useDocumentSync(id: string, setup: DocumentSyncSetup = DOCUMENT_SETUP): DocumentSyncHandle {
  const context = useAuthedContext();
  const { reportError } = useZekke();
  const transport = useMemo(() => apiTransport(context), [context]);

  const [sync, setSync] = useState<DocumentSync>();
  const [state, setState] = useState<SyncState>(INITIAL_STATE);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const engine = new DocumentSync(id, transport, setup.syncOptions);

    const unsubscribe = engine.subscribe((next) => {
      if (!cancelled) {
        setState(next);
      }
    });

    engine
      .open()
      .then(() => {
        if (cancelled) {
          return;
        }
        if (isUntouched(engine.doc)) {
          setup.seedUntouched?.(engine.doc);
        }
        if (document.visibilityState === "visible") {
          engine.startPolling();
        }
        setSync(engine);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(reportError(cause));
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
      setSync(undefined);
      setState(INITIAL_STATE);
      void engine.close().catch(() => undefined);
    };
  }, [id, transport, reportError, setup]);

  useEffect(() => {
    if (sync === undefined) {
      return;
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void sync.poll().catch(() => undefined);
        sync.startPolling();
      } else {
        sync.stopPolling();
        void sync.flush().catch(() => undefined);
      }
    };
    const onOnline = () => void sync.flush().catch(() => undefined);

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
    };
  }, [sync]);

  return { sync, state, error };
}
