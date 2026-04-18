/** Maximum number of files listed during repository tree walk. */
export const MAX_LISTED_FILES = 400;

/** Maximum directory nesting depth for repository tree walk. */
export const MAX_TREE_DEPTH = 6;

/** Maximum number of chunks extracted per file. */
export const MAX_CHUNKS_PER_FILE = 4;

/** Maximum number of artifacts included in a chat context prompt. */
export const MAX_CONTEXT_ARTIFACTS = 6;

/** Maximum number of recent messages loaded for a chat reply. */
export const MAX_CONTEXT_MESSAGES = 20;

/** Maximum number of relevant code chunks selected for a chat reply. */
export const MAX_RELEVANT_CHUNKS = 6;

/** Number of documents to delete per batch in cascade operations. */
export const CASCADE_BATCH_SIZE = 200;

/** Minimum character delta before flushing a streaming assistant reply. */
export const STREAM_FLUSH_THRESHOLD = 240;

/** Default minutes before a sandbox auto-stops (Daytona). */
export const DEFAULT_AUTO_STOP_MINUTES = 10;

/** Default minutes before a sandbox is auto-archived (Daytona). */
export const DEFAULT_AUTO_ARCHIVE_MINUTES = 60 * 24;

/** Default minutes before a sandbox is auto-deleted (Daytona). */
export const DEFAULT_AUTO_DELETE_MINUTES = 60 * 24;
