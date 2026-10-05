export const ATTACHMENTS_MAP = 'attachments';
export const IMAGE_NODE = 'image';
export const IMAGE_ATTACHMENT_ATTRIBUTE = 'attachment';

export const MAX_SOURCE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PREPARED_IMAGE_BYTES = 8 * 1024 * 1024;
export const CONTINUOUS_TEXT_WIDTH_PX = 998;
export const PREPARED_MAX_WIDTH_PX = CONTINUOUS_TEXT_WIDTH_PX * 2;
export const THUMBNAIL_MAX_WIDTH_PX = 480;
export const MAX_COPY_BATCH = 200;
export const MAX_REFERENCED_ATTACHMENTS = 10_000;

export type AttachmentState = 'pending' | 'ok' | 'missing';

export interface AttachmentRecord {
  id: string;
  document_id: string;
  size_bytes: number;
  ciphertext_sha256?: string;
  state: AttachmentState;
  replica_state: string;
  created_at: string;
  updated_at: string;
}

export interface AttachmentUploadTicket {
  url: string;
  size: number;
  expires_at: string;
}

export interface CreatedAttachmentRecord extends AttachmentRecord {
  upload?: AttachmentUploadTicket;
}

export interface AttachmentDownloadRecord extends AttachmentRecord {
  url: string;
  expires_at: string;
}

export interface SharedAttachmentRecord extends AttachmentDownloadRecord {
  share_id: string;
}

export interface AttachmentReferencesResult {
  referenced: number;
  unreferenced: number;
}

export interface AttachmentUsage {
  used_bytes: number;
  file_bytes: number;
  attachment_bytes: number;
  quota_bytes: number;
}

export interface CopyAttachmentPair {
  source_id: string;
  id: string;
}
