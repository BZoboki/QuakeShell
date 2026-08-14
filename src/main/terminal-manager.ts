import * as nodePty from 'node-pty';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import log from 'electron-log/main';

const logger = log.scope('terminal-manager');

const ALLOWED_SHELLS = ['powershell', 'pwsh', 'cmd', 'bash', 'wsl'] as const;
type AllowedShell = (typeof ALLOWED_SHELLS)[number];

/** Map short shell names to resolvable executable paths on Windows */
const SHELL_EXECUTABLES: Record<AllowedShell, string> = {
  powershell: 'powershell.exe',
  pwsh: 'pwsh.exe',
  cmd: 'cmd.exe',
  bash: 'bash.exe',
  wsl: 'wsl.exe',
};

const WINDOWS_SYSTEM_SHELL_SEGMENTS: Partial<Record<AllowedShell, string[]>> = {
  powershell: ['WindowsPowerShell', 'v1.0', 'powershell.exe'],
  cmd: ['cmd.exe'],
  wsl: ['wsl.exe'],
};

const WINDOWS_PATH_DELIMITER = path.win32.delimiter;

/** Display info for each known shell */
const SHELL_INFO: Record<AllowedShell, { label: string; icon: string }> = {
  powershell: { label: 'Windows PowerShell', icon: '⚡' },
  pwsh: { label: 'PowerShell (Core)', icon: '⚡' },
  cmd: { label: 'Command Prompt', icon: '▪' },
  bash: { label: 'Git Bash', icon: '$' },
  wsl: { label: 'WSL (Linux)', icon: '🐧' },
};

export interface AvailableShell {
  id: string;
  label: string;
  icon: string;
}

let ptyProcess: nodePty.IPty | null = null;
let ptyGeneration = 0; // incremented on each spawn to detect stale exit events

// Persistent callbacks — survive across PTY respawns
let dataCallback: ((tabId: string, data: string) => void) | null = null;
let exitCallback: ((exitCode: number, signal: number) => void) | null = null;
let bellCallback: (() => void) | null = null;

// Last known dimensions — used for respawns
let lastCols = 80;
let lastRows = 24;

// Deferred shell preference — set via hot-reload, used on next spawn
let pendingDefaultShell: string | null = null;

function getDefaultCwd(): string | undefined {
  return process.env.USERPROFILE || process.env.HOME || undefined;
}

function isAllowedShell(shell: string): shell is AllowedShell {
  return ALLOWED_SHELLS.includes(shell as AllowedShell);
}

function getWindowsSystemDirectory(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string | null {
  const systemRoot = env.SystemRoot ?? env.windir ?? env.WINDIR;
  if (typeof systemRoot !== 'string' || systemRoot.trim() === '') {
    return null;
  }

  const systemDirectoryName = process.arch === 'ia32' && typeof env.PROCESSOR_ARCHITEW6432 === 'string'
    ? 'Sysnative'
    : 'System32';

  return path.win32.join(systemRoot.trim(), systemDirectoryName);
}

function resolveAllowlistedShellPath(shell: AllowedShell): string {
  const systemShellSegments = WINDOWS_SYSTEM_SHELL_SEGMENTS[shell];
  if (!systemShellSegments) {
    return SHELL_EXECUTABLES[shell];
  }

  const systemDirectory = getWindowsSystemDirectory();
  if (!systemDirectory) {
    return SHELL_EXECUTABLES[shell];
  }

  // node-pty resolves relative commands against the parent process PATH
  // before the child env override is applied, so inbox shells must be absolute.
  return path.win32.join(systemDirectory, ...systemShellSegments);
}

/** Detect which shells are available on this system */
export function getAvailableShells(): AvailableShell[] {
  const available: AvailableShell[] = [];
  for (const shell of ALLOWED_SHELLS) {
    const exe = resolveAllowlistedShellPath(shell);
    try {
      if (path.win32.isAbsolute(exe)) {
        if (!fs.existsSync(exe)) {
          continue;
        }
      } else {
        execSync(`where ${exe}`, { stdio: 'ignore' });
      }

      available.push({
        id: shell,
        label: SHELL_INFO[shell].label,
        icon: SHELL_INFO[shell].icon,
      });
    } catch {
      // Not found in PATH — skip
    }
  }
  return available;
}

/** ANSI escape for dimmed text (#565f89) */
const DIMMED = '\x1b[38;2;86;95;137m';
const RESET = '\x1b[0m';

/** Resolve a shell alias or custom path to an executable path */
export function resolveShellPath(shellConfig: string): string {
  if (isAllowedShell(shellConfig)) {
    return resolveAllowlistedShellPath(shellConfig);
  }
  // Treat as custom absolute path
  return shellConfig;
}

/** Check if a shell config value refers to WSL */
function isWslShell(shellConfig: string): boolean {
  return shellConfig === 'wsl';
}

function copyStringEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Record<string, string> {
  const copiedEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      copiedEnv[key] = value;
    }
  }

  return copiedEnv;
}

function isNormalizedWindowsRootPath(segment: string): boolean {
  return /^[A-Za-z]:\\$/.test(segment) || /^\\\\[^\\]+\\[^\\]+\\$/.test(segment);
}

function normalizeWindowsPathSegment(segment: string): string {
  const normalizedSegment = path.win32.normalize(segment);
  const comparableSegment = isNormalizedWindowsRootPath(normalizedSegment)
    ? normalizedSegment
    : normalizedSegment.replace(/[\\/]+$/, '');

  return comparableSegment.toLowerCase();
}

function dedupeWindowsPathSegments(segments: string[]): string[] {
  const seen = new Set<string>();
  const dedupedSegments: string[] = [];

  for (const segment of segments) {
    const trimmedSegment = segment.trim();
    if (!trimmedSegment) {
      continue;
    }

    const normalizedSegment = normalizeWindowsPathSegment(trimmedSegment);
    if (seen.has(normalizedSegment)) {
      continue;
    }

    seen.add(normalizedSegment);
    dedupedSegments.push(trimmedSegment);
  }

  return dedupedSegments;
}

const VOLTA_TOOL_IMAGE_MARKER = `${path.win32.sep}tools${path.win32.sep}image${path.win32.sep}`.toLowerCase();

function deriveVoltaHomeFromPathSegments(segments: string[]): string | null {
  for (const segment of segments) {
    const trimmedSegment = segment.trim();
    if (!trimmedSegment) {
      continue;
    }

    const normalizedSegment = path.win32.normalize(trimmedSegment);
    const loweredSegment = normalizedSegment.toLowerCase();
    const markerIndex = loweredSegment.indexOf(VOLTA_TOOL_IMAGE_MARKER);

    if (markerIndex === -1) {
      continue;
    }

    const candidateHome = normalizedSegment.slice(0, markerIndex);
    if (candidateHome) {
      return candidateHome;
    }
  }

  return null;
}

const POWERSHELL_PATH_REFRESH_TEMPLATE = '& { $machinePath = [Environment]::GetEnvironmentVariable(\'Path\', \'Machine\'); $userPath = [Environment]::GetEnvironmentVariable(\'Path\', \'User\'); $pathEntries = @(); if ($machinePath) { $pathEntries += [Environment]::ExpandEnvironmentVariables($machinePath) }; if ($userPath) { $pathEntries += [Environment]::ExpandEnvironmentVariables($userPath) }; $env:Path = [string]::Join(\';\', $pathEntries) }';
const CMD_PATH_REFRESH_TEMPLATE = 'for /f "usebackq delims=" %P in (`call "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command "$machinePath=[Environment]::GetEnvironmentVariable(\'Path\', \'Machine\'); $userPath=[Environment]::GetEnvironmentVariable(\'Path\', \'User\'); $pathEntries=@(); if ($machinePath) { $pathEntries += [Environment]::ExpandEnvironmentVariables($machinePath) }; if ($userPath) { $pathEntries += [Environment]::ExpandEnvironmentVariables($userPath) }; [string]::Join(\';\', $pathEntries)"`) do @set "Path=%P"';
const BASH_PATH_REFRESH_TEMPLATE = `__quakeshell_refresh_environment_path_8d726738() { local windows_path posix_path refreshed_path; windows_path="$("$SYSTEMROOT/System32/WindowsPowerShell/v1.0/powershell.exe" -NoProfile -Command '$machinePath=[Environment]::GetEnvironmentVariable("Path", "Machine"); $userPath=[Environment]::GetEnvironmentVariable("Path", "User"); $pathEntries=@(); if ($machinePath) { $pathEntries += [Environment]::ExpandEnvironmentVariables($machinePath) }; if ($userPath) { $pathEntries += [Environment]::ExpandEnvironmentVariables($userPath) }; [string]::Join(";", $pathEntries)')" || return; [ -n "$windows_path" ] || return; posix_path="$(/usr/bin/cygpath -p "$windows_path")" || return; [ -n "$posix_path" ] || return; refreshed_path="$(printf '%s:%s\\n' "$posix_path" "$PATH" | /usr/bin/awk -F: '{ for (segment = 1; segment <= NF; segment += 1) { if (!seen[$segment]++) { printf "%s%s", separator, $segment; separator = ":" } } print "" }')" || return; [ -n "$refreshed_path" ] || return; PATH="$refreshed_path"; export PATH; }; __quakeshell_refresh_environment_path_8d726738; unset -f __quakeshell_refresh_environment_path_8d726738`;

const ENVIRONMENT_REFRESH_TEMPLATES: Readonly<Record<
  Extract<AllowedShell, 'powershell' | 'pwsh' | 'cmd' | 'bash'>,
  string
>> = {
  powershell: POWERSHELL_PATH_REFRESH_TEMPLATE,
  pwsh: POWERSHELL_PATH_REFRESH_TEMPLATE,
  cmd: CMD_PATH_REFRESH_TEMPLATE,
  bash: BASH_PATH_REFRESH_TEMPLATE,
};

/** Return a trusted in-place Windows PATH refresh command for a supported shell alias. */
export function getEnvironmentRefreshCommand(shellConfig: string): string | null {
  if (shellConfig === 'powershell' || shellConfig === 'pwsh' || shellConfig === 'cmd' || shellConfig === 'bash') {
    return ENVIRONMENT_REFRESH_TEMPLATES[shellConfig];
  }

  return null;
}

// ─── Leaked npm / Volta environment cleanup ───

/** Env-var prefixes that leak from npm lifecycle scripts and must not persist into child terminals. */
const LEAKED_ENV_PREFIXES = ['npm_lifecycle_', 'npm_package_', 'npm_config_'];
/**
 * Exact env-var names that leak from npm/Volta runtime and break child shells:
 * - npm_execpath / npm_node_execpath: npm lifecycle leftovers
 * - _volta_tool_recursion: tells Volta shims to bypass tool resolution, causing
 *   "npm is not recognized" when no standalone npm exists on the system PATH
 * - node_path: points to Volta internal shared tools; confuses Node module resolution
 */
const LEAKED_ENV_EXACT = new Set([
  'npm_execpath', 'npm_node_execpath',
  '_volta_tool_recursion',
  'node_path',
]);

function isLeakedNpmEnvKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return LEAKED_ENV_EXACT.has(lowered)
    || LEAKED_ENV_PREFIXES.some((prefix) => lowered.startsWith(prefix));
}

export function normalizeWindowsSpawnEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Record<string, string> {
  const normalizedEnv = copyStringEnv(env);

  // Strip env vars leaked by npm lifecycle / postinstall
  for (const key of Object.keys(normalizedEnv)) {
    if (isLeakedNpmEnvKey(key)) {
      delete normalizedEnv[key];
    }
  }

  for (const key of Object.keys(normalizedEnv)) {
    if (key.toLowerCase() === 'path') {
      delete normalizedEnv[key];
    }
  }

  const pathSegments = Object.entries(env)
    .filter(([key, value]) => key.toLowerCase() === 'path' && typeof value === 'string')
    .sort(([leftKey], [rightKey]) => {
      if (leftKey === 'Path') return -1;
      if (rightKey === 'Path') return 1;
      if (leftKey === 'PATH') return -1;
      if (rightKey === 'PATH') return 1;
      return leftKey.localeCompare(rightKey);
    })
    .flatMap(([, value]) => (value ? value.split(WINDOWS_PATH_DELIMITER) : []));

  const voltaHome = env.VOLTA_HOME?.trim() || deriveVoltaHomeFromPathSegments(pathSegments);
  if (voltaHome) {
    pathSegments.unshift(path.win32.join(voltaHome, 'bin'));
  }

  const dedupedPathSegments = dedupeWindowsPathSegments(pathSegments);
  if (dedupedPathSegments.length > 0) {
    normalizedEnv.Path = dedupedPathSegments.join(WINDOWS_PATH_DELIMITER);
  }

  const systemRoot = normalizedEnv.SystemRoot ?? env.SystemRoot ?? env.windir ?? env.WINDIR;
  if (typeof systemRoot === 'string' && systemRoot.trim() !== '') {
    normalizedEnv.SystemRoot = systemRoot.trim();
  }

  return normalizedEnv;
}

/** Build environment variables for spawn, adding WSL-specific vars when needed */
function buildSpawnEnv(shellConfig: string): Record<string, string> {
  const env = process.platform === 'win32'
    ? normalizeWindowsSpawnEnv(process.env as Record<string, string | undefined>)
    : copyStringEnv(process.env as Record<string, string | undefined>);

  if (isWslShell(shellConfig)) {
    return { ...env, COLORTERM: 'truecolor', TERM: 'xterm-256color' };
  }

  return env;
}

/** Validate custom shell path exists on disk */
function validateCustomShellPath(shellConfig: string, resolvedPath: string): string | null {
  // Only validate non-allowlisted shells (custom paths)
  if (isAllowedShell(shellConfig)) return null;
  if (!fs.existsSync(resolvedPath)) {
    return `[Failed to start shell: Shell executable not found at ${resolvedPath}]`;
  }
  return null;
}

/** Write a dimmed error message to the terminal data callback */
function emitError(message: string): void {
  if (dataCallback) {
    dataCallback('default', `\r\n${DIMMED}${message}${RESET}\r\n`);
  }
}

export function spawn(shell: string, cols?: number, rows?: number): void {
  if (!shell) {
    const msg = 'Shell path must not be empty';
    logger.error(msg);
    throw new Error(msg);
  }

  const env = buildSpawnEnv(shell);
  const resolvedPath = resolveShellPath(shell);

  // Validate custom shell paths exist before spawning
  const validationError = validateCustomShellPath(shell, resolvedPath);
  if (validationError) {
    logger.error(validationError);
    emitError(validationError);
    return;
  }

  // Kill existing PTY if any (e.g. respawn after exit)
  if (ptyProcess) {
    try {
      ptyProcess.kill();
    } catch {
      // already dead
    }
    ptyProcess = null;
  }

  const spawnCols = cols ?? lastCols;
  const spawnRows = rows ?? lastRows;
  lastCols = spawnCols;
  lastRows = spawnRows;

  try {
    ptyProcess = nodePty.spawn(resolvedPath, [], {
      name: 'xterm-256color',
      cols: spawnCols,
      rows: spawnRows,
      cwd: getDefaultCwd(),
      useConpty: true,
      env,
    });

    const spawnedPty = ptyProcess;
    const spawnedPid = spawnedPty.pid;
    const myGeneration = ++ptyGeneration;

    logger.info(
      `Spawned shell → ${resolvedPath} (PID: ${spawnedPid}, ${spawnCols}x${spawnRows})`,
    );

    // Wire persistent data callback to new instance, with bell detection
    spawnedPty.onData((data: string) => {
      if (myGeneration !== ptyGeneration) {
        return;
      }

      if (bellCallback && data.includes('\x07')) {
        bellCallback();
      }
      dataCallback?.('default', data);
    });

    spawnedPty.onExit(({ exitCode, signal }) => {
      const finalExitCode = exitCode ?? 0;
      const finalSignal = signal ?? 0;
      logger.info(
        `PTY exited (PID: ${spawnedPid}, exitCode: ${finalExitCode}, signal: ${finalSignal})`,
      );
      // Ignore exit from a PTY that was replaced by a newer spawn
      if (myGeneration !== ptyGeneration) return;
      ptyProcess = null;
      exitCallback?.(finalExitCode, finalSignal);
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const isWsl = isWslShell(shell);
    const displayMsg = isWsl
      ? '[Failed to start shell: WSL is not installed or not available]'
      : `[Failed to start shell: ${errMsg}]`;
    logger.error(displayMsg, error);
    emitError(displayMsg);
    ptyProcess = null;
  }
}

export function write(data: string): void {
  if (!ptyProcess) {
    logger.warn('write() called but no PTY process is running');
    return;
  }
  ptyProcess.write(data);
}

export function resize(cols: number, rows: number): void {
  if (!ptyProcess) {
    logger.warn('resize() called but no PTY process is running');
    return;
  }
  lastCols = cols;
  lastRows = rows;
  try {
    ptyProcess.resize(cols, rows);
  } catch (error) {
    logger.error('Failed to resize PTY:', error);
  }
}

/** Register a persistent data callback — automatically wired to new PTY instances */
export function onData(callback: (tabId: string, data: string) => void): void {
  dataCallback = callback;
}

/** Register a persistent exit callback — fires on every PTY exit (including respawns) */
export function onExit(
  callback: (exitCode: number, signal: number) => void,
): void {
  exitCallback = callback;
}

/** Register a bell callback — fires when \x07 is detected in PTY output */
export function onBell(callback: () => void): void {
  bellCallback = callback;
}

// ─── Per-PTY utility functions (used by TabManager) ───

/**
 * Spawn a new PTY instance and return it directly.
 * Caller owns the returned IPty and is responsible for lifecycle management.
 */
export function spawnPty(
  shellConfig: string,
  cols: number,
  rows: number,
  onDataCb: (data: string) => void,
  onExitCb: (exitCode: number, signal: number) => void,
  cwd?: string,
): nodePty.IPty {
  if (!shellConfig) {
    throw new Error('Shell path must not be empty');
  }

  const env = buildSpawnEnv(shellConfig);
  const resolvedPath = resolveShellPath(shellConfig);

  const validationError = validateCustomShellPath(shellConfig, resolvedPath);
  if (validationError) {
    throw new Error(validationError);
  }

  const pty = nodePty.spawn(resolvedPath, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cwd ?? getDefaultCwd(),
    useConpty: true,
    env,
  });

  logger.info(`spawnPty → ${resolvedPath} (PID: ${pty.pid}, ${cols}x${rows})`);

  pty.onData((data: string) => {
    onDataCb(data);
  });

  pty.onExit(({ exitCode, signal }) => {
    const finalExitCode = exitCode ?? 0;
    const finalSignal = signal ?? 0;
    logger.info(`PTY exited (PID: ${pty.pid}, exitCode: ${finalExitCode}, signal: ${finalSignal})`);
    onExitCb(finalExitCode, finalSignal);
  });

  return pty;
}

/** Write data to a specific PTY instance */
export function writeToPty(pty: nodePty.IPty, data: string): void {
  pty.write(data);
}

/** Resize a specific PTY instance (safe for already-dead processes) */
export function resizePty(pty: nodePty.IPty, cols: number, rows: number): void {
  try {
    pty.resize(cols, rows);
  } catch (error) {
    logger.warn('resizePty failed (process may be dead):', error);
  }
}

/** Kill a specific PTY instance (safe for already-dead processes) */
export function killPty(pty: nodePty.IPty): void {
  try {
    pty.kill();
  } catch (error) {
    logger.warn('killPty failed (process may already be dead):', error);
  }
}

// ─── Legacy module-level functions (v1 single-terminal path) ───

export function destroy(): void {
  if (!ptyProcess) {
    return;
  }
  try {
    logger.info(`Destroying PTY (PID: ${ptyProcess.pid})`);
    ptyProcess.kill();
    ptyProcess = null;
  } catch (error) {
    logger.error('Failed to destroy PTY:', error);
    ptyProcess = null;
  }
}

/** Store a new default shell preference — does NOT kill the running PTY */
export function setDefaultShell(shell: string): void {
  pendingDefaultShell = shell;
  logger.info(`Default shell changed to ${shell} — will apply on next session`);
}

/** Get the current default shell preference (pending or initial) */
export function getDefaultShell(): string {
  return pendingDefaultShell ?? 'powershell';
}

/** @internal For test use only */
export function _normalizeWindowsPathSegmentForComparison(segment: string): string {
  return normalizeWindowsPathSegment(segment);
}

/** @internal For test use only */
export function _reset(): void {
  if (ptyProcess) {
    try { ptyProcess.kill(); } catch { /* ignore */ }
  }
  ptyProcess = null;
  ptyGeneration = 0;
  dataCallback = null;
  exitCallback = null;
  bellCallback = null;
  lastCols = 80;
  lastRows = 24;
  pendingDefaultShell = null;
}
