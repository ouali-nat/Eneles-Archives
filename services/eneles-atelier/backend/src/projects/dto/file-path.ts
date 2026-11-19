/**
 * A project file path: relative, '/'-separated, no '..' segments, no empty
 * segments, no backslashes or control characters. Paths travel into the
 * compiler's job directory and into exported ZIPs, where '../' would escape.
 */
export const PROJECT_FILE_PATH =
  // eslint-disable-next-line no-control-regex -- control characters are what it rejects
  /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\/$)[^\\\u0000-\u001f\u007f]+$/;

export const PROJECT_FILE_PATH_MESSAGE =
  'File paths must be relative, without "..", "." or empty segments, and without backslashes.';
