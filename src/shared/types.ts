export type SectionName =
  | "dashboard"
  | "skills"
  | "hooks"
  | "memory"
  | "usage"
  | "mcp"
  | "storage"
  | "backup"
  | "history"
  | "diagnostics"
  | "settings";

export type ConnectionStatus = "idle" | "locating" | "connecting" | "connected" | "failed";

export interface ConnectionState {
  status: ConnectionStatus;
  label: string;
  error?: string;
  userAgent?: string;
  platform?: string;
}

export type SkillMode = "implicit" | "explicit" | "hidden";
export type SkillState = "available" | "disabled" | "missingDependency" | "error";

export interface SkillDependency {
  type: string;
  value: string;
  summary?: string;
  availability: "available" | "missing" | "unknown";
}

export interface SkillRecord {
  id: string;
  name: string;
  displayName: string;
  description: string;
  shortDescription?: string;
  path: string;
  scope: "user" | "repo" | "system" | "admin" | "unknown";
  rawScope: string;
  isEnabled: boolean;
  invocationPolicy: "automaticAllowed" | "explicitOnly" | "unknown";
  mode: SkillMode;
  state: SkillState;
  canModify: boolean;
  isPluginProvided: boolean;
  dependencies: SkillDependency[];
  errors: string[];
}

export interface HookRecord {
  id: string;
  key: string;
  displayName: string;
  event: string;
  eventTitle: string;
  handlerType: string;
  handlerTitle: string;
  matcher?: string;
  commandSummary?: string;
  timeoutSeconds: number;
  statusMessage?: string;
  sourcePath: string;
  source: string;
  sourceTitle: string;
  pluginId?: string;
  isEnabled: boolean;
  isManaged: boolean;
  canModify: boolean;
  trustStatus: string;
  trustTitle: string;
  runnableState: "ready" | "disabled" | "needsTrust" | "changedSinceTrust" | "unsupportedHandler";
  triggerSummary: string;
  matchSummary: string;
  actionSummary: string;
  effectTitle: string;
  effectSummary: string;
}

export interface RateLimitWindow {
  usedPercent: number;
  remainingPercent: number;
  windowDurationMinutes?: number;
  resetsAt?: string;
}

export interface RateLimitRecord {
  id: string;
  name: string;
  planType?: string;
  primary?: RateLimitWindow;
  secondary?: RateLimitWindow;
  reachedType?: string;
  creditBalance?: string;
}

export interface TokenUsageSummary {
  lifetimeTokens?: number;
  peakDailyTokens?: number;
  longestRunningTurnSeconds?: number;
  currentStreakDays?: number;
  longestStreakDays?: number;
}

export interface DailyTokenUsage {
  startDate: string;
  tokens: number;
}

export interface MCPToolRecord {
  name: string;
  title?: string;
  description?: string;
}

export interface MCPResourceRecord {
  name: string;
  title?: string;
  description?: string;
  kind: "resource" | "template";
}

export interface MCPRecord {
  id: string;
  name: string;
  displayName: string;
  version?: string;
  description?: string;
  transport: "http" | "stdio" | "unknown";
  endpointSummary: string;
  isConfigured: boolean;
  isEnabled: boolean;
  isRequired: boolean;
  authStatus: string;
  startupStatus: "configured" | "disabled" | "inventoryAvailable";
  inventoryStatus: "available" | "unavailable" | "notReported";
  tools: MCPToolRecord[];
  resources: MCPResourceRecord[];
  startupTimeoutSeconds?: number;
  toolTimeoutSeconds?: number;
  configurationIssue?: string;
  errorMessage?: string;
  checkedAt: string;
  canModify: boolean;
  readOnlyReason?: string;
  effectiveState: "effective" | "disabled" | "configured" | "problem";
}

export interface MemoryRecord {
  id: string;
  title: string;
  relativePath: string;
  absolutePath: string;
  kind: "active" | "durable" | "summary" | "raw" | "other";
  status: "available" | "tooLarge" | "unreadable";
  sizeBytes: number;
  modifiedAt?: string;
  lineCount: number;
  preview?: string;
}

export interface MemorySnapshot {
  records: MemoryRecord[];
  visibleRecords: MemoryRecord[];
  warnings: string[];
  totalBytes: number;
}

export type StorageKind =
  | "sessions"
  | "archivedSessions"
  | "plugins"
  | "skills"
  | "packages"
  | "cache"
  | "temporary"
  | "logs"
  | "database"
  | "other";

export interface StorageRecord {
  id: string;
  kind: StorageKind;
  title: string;
  path: string;
  sizeBytes: number;
  itemCount: number;
  reclaimableSizeBytes: number;
  reclaimableItemCount: number;
  cleanupFingerprint?: string;
  cleanupLevel: "safe" | "cautious" | "protected";
  cleanupImpact: string;
}

export interface ChangeRecord {
  id: string;
  at: string;
  category: "skill" | "hook" | "mcp" | "storage" | "backup" | "settings";
  title: string;
  detail: string;
  reversible: boolean;
}

export interface DiagnosticRecord {
  id: string;
  title: string;
  status: "passed" | "warning" | "failed" | "notChecked" | "checking";
  detail: string;
  impact: string;
  destination?: SectionName;
}

export interface BackupStatus {
  cliAvailable: boolean;
  signedIn: boolean;
  login?: string;
  detail: string;
  lastBackupAt?: string;
}

export interface WorkbenchSettings {
  workspacePath: string;
  preferredCodexPath?: string;
  showTrayIcon: boolean;
  autoRefreshMinutes: number;
  theme: "system" | "light" | "dark";
  backupRepository?: string;
}

export interface WorkbenchSnapshot {
  refreshedAt: string;
  connection: ConnectionState;
  workspacePath: string;
  codexHome: string;
  codexExecutable?: string;
  skills: SkillRecord[];
  skillWarnings: string[];
  hooks: HookRecord[];
  hookWarnings: string[];
  rateLimits: RateLimitRecord[];
  tokenUsage?: TokenUsageSummary;
  dailyTokenUsage: DailyTokenUsage[];
  usageWarning?: string;
  mcpServers: MCPRecord[];
  mcpWarning?: string;
  memory: MemorySnapshot;
  storage: StorageRecord[];
  backup: BackupStatus;
  history: ChangeRecord[];
  diagnostics: DiagnosticRecord[];
  settings: WorkbenchSettings;
}

export interface ActionResult {
  ok: boolean;
  message: string;
  snapshot?: WorkbenchSnapshot;
}

export type UpdateDistribution = "installed" | "portable" | "development";
export type UpdateStatus = "unsupported" | "idle" | "error";

export interface WorkbenchUpdateState {
  status: UpdateStatus;
  distribution: UpdateDistribution;
  currentVersion: string;
  message: string;
  canCheck: boolean;
}

export interface BackupPreview {
  repository: string;
  files: Array<{ path: string; sizeBytes: number; note: string }>;
  warnings: string[];
}

export interface WorkbenchAPI {
  bootstrap(): Promise<WorkbenchSnapshot>;
  refresh(section?: SectionName, forceReload?: boolean): Promise<WorkbenchSnapshot>;
  chooseWorkspace(): Promise<WorkbenchSnapshot | null>;
  chooseCodexExecutable(): Promise<WorkbenchSnapshot | null>;
  setSkillMode(skillId: string, mode: SkillMode): Promise<ActionResult>;
  setHookEnabled(hookId: string, enabled: boolean): Promise<ActionResult>;
  setMCPEnabled(name: string, enabled: boolean): Promise<ActionResult>;
  reloadMCP(): Promise<ActionResult>;
  cleanupStorage(kind: StorageKind, fingerprint: string): Promise<ActionResult>;
  saveSettings(patch: Partial<WorkbenchSettings>): Promise<ActionResult>;
  openPath(target: string): Promise<ActionResult>;
  openExternal(url: string): Promise<ActionResult>;
  copyText(text: string): Promise<ActionResult>;
  previewBackup(repository: string): Promise<BackupPreview>;
  runBackup(repository: string): Promise<ActionResult>;
  getUpdateState(): Promise<WorkbenchUpdateState>;
  checkForUpdates(): Promise<WorkbenchUpdateState>;
  onSnapshot(listener: (snapshot: WorkbenchSnapshot) => void): () => void;
  onUpdateState(listener: (state: WorkbenchUpdateState) => void): () => void;
}
