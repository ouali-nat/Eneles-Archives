/**
 * Raised when a client writes a file with an `expectedVersion` that no longer
 * matches the stored row, i.e. somebody else saved in between.
 *
 * Carries the current server content so the caller can surface a real diff
 * rather than just telling the user their work bounced.
 */
export class FileVersionConflictError extends Error {
  constructor(
    readonly expectedVersion: number,
    readonly actualVersion: number,
    readonly currentContent: string,
  ) {
    super(
      `File version conflict: expected ${expectedVersion}, found ${actualVersion}`,
    );
    this.name = 'FileVersionConflictError';
  }
}
