// Types
export interface User {
  id: number;
  email: string;
  name?: string;
  bio?: string;
  affiliation?: string;
  location?: string;
  avatarUrl?: string;
  isEmailVerified: boolean;
  subscriptionType?: "free" | "pro" | "team" | "enterprise";
  twoFactorEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse extends User {
  token: string;
}

export interface Snip {
  id: string;
  userId: string;
  imagePath: string;
  latexContent?: string;
  originalText?: string;
  status: "pending" | "processing" | "completed" | "error";
  createdAt: string;
  updatedAt: string;
  title?: string;
  tags?: string[];
  fileSize?: number; // File size in bytes

  // Keep these fields for backward compatibility with our UI
  imageUrl?: string;
  latexCode?: string;
  description?: string;
  processingStatus?: "pending" | "processing" | "completed" | "failed";
}

export interface PDF {
  id: string;
  userId: string;
  filePath: string;
  pdfPath?: string; // Legacy field
  title?: string;
  fileSize?: number; // File size in bytes
  pageCount?: number;
  latexContent?: string;
  status: "pending" | "processing" | "completed" | "error";
  createdAt: string;
  updatedAt: string;
  tags?: string[];

  // Keep these fields for backward compatibility with our UI
  pdfUrl?: string;
  latexCode?: string;
  processingStatus?: "pending" | "processing" | "completed" | "failed";
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

// Project / Editor types
export interface ProjectCollaboratorUser {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface ProjectCollaborator {
  id: number;
  projectId: number;
  userId: number;
  role: "viewer" | "editor";
  addedAt: string;
  user: ProjectCollaboratorUser;
}

export interface ProjectInvitation {
  id: number;
  email: string;
  role: "viewer" | "editor";
  status: "pending" | "accepted" | "declined";
  createdAt: string;
}

export interface PendingAiDiff {
  edits: AiChatEdit[];
  message?: string;
}

export interface Project {
  id: number;
  uid: string;
  userId: number;
  title: string;
  status: "pending" | "processing" | "completed" | "error";
  tags: string[];
  color: string | null;
  access: "private" | "view" | "edit";
  archived: boolean;
  files?: ProjectFile[];
  pendingAiDiff?: PendingAiDiff | null;
  _count?: { files: number };
  createdAt: string;
  updatedAt: string;
  // Sharing fields
  isShared?: boolean;
  myRole?: "owner" | "viewer" | "editor";
  ownerName?: string;
  user?: ProjectCollaboratorUser;
  collaborators?: ProjectCollaborator[];
  invitations?: ProjectInvitation[];
  invitationToken?: string;
  invitationStatus?: string;
  /** Set when this project is a reference paper: the project it is attached to. */
  referenceOf?: { uid: string; title: string } | null;
  arxivId?: string | null;
}

/** A reference paper attached to a project, with its file list (no contents). */
export interface ProjectReference {
  uid: string;
  title: string;
  arxivId: string | null;
  createdAt: string;
  files: { id: number; path: string; isMain: boolean; isBinary: boolean; size: number | null }[];
}

export interface ProjectFile {
  id: number;
  projectId: number;
  path: string;
  content?: string;
  /** Set for images and other binary files, whose bytes are in storage. */
  filePath?: string | null;
  size?: number | null;
  isMain: boolean;
  isFolder?: boolean;
  /** Optimistic-locking counter; pass it back as `expectedVersion` on write. */
  version?: number;
  createdAt: string;
  updatedAt: string;
}

export interface FileHistoryEntry {
  id: number;
  version: number;
  label?: string | null;
  userId?: number | null;
  createdAt: string;
  expiresAt: string;
}

/** Someone named in a project's history: as their account is now, or as they were then if the account is gone. */
export interface HistoryPerson {
  id: number;
  name: string;
  avatarUrl: string | null;
  /** In the project now. */
  member: boolean;
  /** The account has been deleted; the name is the one it had. */
  gone: boolean;
}

export interface HistoryAuthor extends HistoryPerson {
  /** Changes their live session sent to the file since the version before; 0 when the change came another way (a save without a live connection, a restore). */
  edits: number;
}

/** One version of one file, as the project's history timeline lists it. */
export interface HistoryEntry {
  id: number;
  version: number;
  filePath: string;
  label: string | null;
  createdAt: string;
  /** The last write to this version (saves less than a minute apart by the same people fold into one). */
  updatedAt: string;
  linesAdded: number;
  linesRemoved: number;
  restoredFromId: number | null;
  /** Whose save sent it; null when the server wrote it as a live session closed. */
  savedBy: HistoryPerson | null;
  /** Who changed the file since the version before. Empty on versions from before authors were recorded. */
  authors: HistoryAuthor[];
}

export interface HistoryPage {
  entries: HistoryEntry[];
  nextCursor: number | null;
}

export interface HistoryPathFacet {
  path: string;
  versions: number;
  lastChangedAt: string | null;
  status: "current" | "renamed" | "deleted";
  renamedTo: string | null;
}

export interface HistoryFacets {
  authors: (HistoryPerson & { versions: number })[];
  paths: HistoryPathFacet[];
  /** Versions that name no one (from before authors were recorded). */
  unattributed: number;
}

export interface HistoryComparison {
  entry: HistoryEntry;
  against: "previous" | "current";
  before: string;
  /** Null when comparing with the current file and the file no longer exists. */
  after: string | null;
  previous: { id: number; version: number; updatedAt: string } | null;
}

// Editor Settings types
export interface EditorSettings {
  autoComplete: boolean;
  autoCloseBrackets: boolean;
  autoIndent: boolean; // client-side only, not persisted to the backend/DB
  codeCheck: boolean;
  spellcheckLang: string;
  theme: string;
  editorTheme: string;
  pdfTheme: string;
  fontSize: number;
  fontFamily: string;
  lineHeight: string;
}

export interface ProjectSettings {
  mainDocument: string;
  compiler: string;
  texLiveVersion: string;
  compileMode: string;
  stopOnFirstError: boolean;
  autoCompile: boolean;
  tabSize: number;
  macrosEnabled: boolean;
  snippetsEnabled: boolean;
}

export interface UserMacro {
  name: string;
  expansion: string;
  isCustom: boolean;
}

export interface CompileResult {
  success: boolean;
  pdf?: string; // base64
  synctex?: string; // base64 of <main>.synctex.gz, for jumping between the PDF and the source
  /** The text of each file TeX read, as compiled, by project path. SyncTeX's line numbers count these lines. */
  sources?: Record<string, string>;
  url?: string; // Signed URL
  buildKey?: string; // S3 object key, used to construct backend proxy URL
  log?: string;
  errors?: string[];
  /** From BibTeX, Biber, and makeindex, which run as part of the compile. */
  warnings?: string[];
  /** How many times TeX ran. */
  passes?: number;
  duration?: number;
}

export interface AiChatEdit {
  path: string;
  /** The file as it was when the assistant read it: the base the proposal was made against. */
  oldContent: string;
  newContent: string;
  /** The file does not exist yet; accepting it creates it. */
  created?: boolean;
  /** The assistant proposes to delete the file. */
  deleted?: boolean;
}

export interface AiChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AiChatResponse {
  message?: string;
  edits: AiChatEdit[];
  /** The paths of the files the assistant read to answer, including reference papers under references/. */
  read?: string[];
}
