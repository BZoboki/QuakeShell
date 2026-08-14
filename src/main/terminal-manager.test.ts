import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node-pty
const mockWrite = vi.fn();
const mockResize = vi.fn();
const mockKill = vi.fn();
const mockOnData = vi.fn();
const mockOnExit = vi.fn();
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
let mockPid = 1234;

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    pid: mockPid,
    write: mockWrite,
    resize: mockResize,
    kill: mockKill,
    onData: mockOnData,
    onExit: mockOnExit,
  })),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('electron-log/main', () => {
  return {
    default: {
      scope: vi.fn(() => mockLogger),
    },
  };
});

import * as nodePty from 'node-pty';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnPty, write, resize, onData, onExit, onBell, destroy, getEnvironmentRefreshCommand, normalizeWindowsSpawnEnv, resolveShellPath, setDefaultShell, getDefaultShell, _normalizeWindowsPathSegmentForComparison, _reset } from './terminal-manager';

const originalSystemRoot = process.env.SystemRoot;
const originalProcessorArchitew6432 = process.env.PROCESSOR_ARCHITEW6432;

function getSystemShellPath(...segments: string[]): string {
  return path.win32.join('C:\\Windows', 'System32', ...segments);
}

describe('main/terminal-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPid = 1234;
    process.env.SystemRoot = 'C:\\Windows';
    delete process.env.PROCESSOR_ARCHITEW6432;
    _reset();
  });

  afterEach(() => {
    // Clean up PTY state between tests
    try {
      destroy();
    } catch {
      // ignore
    }

    if (originalSystemRoot === undefined) {
      delete process.env.SystemRoot;
    } else {
      process.env.SystemRoot = originalSystemRoot;
    }

    if (originalProcessorArchitew6432 === undefined) {
      delete process.env.PROCESSOR_ARCHITEW6432;
    } else {
      process.env.PROCESSOR_ARCHITEW6432 = originalProcessorArchitew6432;
    }
  });

  describe('spawn', () => {
    it('spawns a powershell PTY with default 80x24 dimensions', () => {
      spawn('powershell');

      expect(nodePty.spawn).toHaveBeenCalledWith(
        getSystemShellPath('WindowsPowerShell', 'v1.0', 'powershell.exe'),
        [],
        expect.objectContaining({
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          useConpty: true,
        }),
      );
    });

    it('spawns with custom cols and rows when provided', () => {
      spawn('powershell', 200, 50);

      expect(nodePty.spawn).toHaveBeenCalledWith(
        getSystemShellPath('WindowsPowerShell', 'v1.0', 'powershell.exe'),
        [],
        expect.objectContaining({
          cols: 200,
          rows: 50,
        }),
      );
    });

    it('spawns absolute system shells for cmd and WSL', () => {
      const expected: Record<string, string> = {
        cmd: getSystemShellPath('cmd.exe'),
        wsl: getSystemShellPath('wsl.exe'),
      };

      for (const shell of ['cmd', 'wsl']) {
        vi.clearAllMocks();
        spawn(shell);
        expect(nodePty.spawn).toHaveBeenCalledWith(
          expected[shell],
          [],
          expect.any(Object),
        );
        destroy();
      }
    });

    it('launches pwsh and Git Bash by their exact supported aliases', () => {
      for (const [shell, executable] of [['pwsh', 'pwsh.exe'], ['bash', 'bash.exe']] as const) {
        spawn(shell);
        expect(nodePty.spawn).toHaveBeenLastCalledWith(executable, [], expect.any(Object));
        destroy();
      }
    });

    it('accepts custom absolute paths as shell', () => {
      spawn('/usr/bin/zsh');
      expect(nodePty.spawn).toHaveBeenCalledWith(
        '/usr/bin/zsh',
        [],
        expect.any(Object),
      );
    });

    it('rejects empty shell name', () => {
      expect(() => spawn('')).toThrow('Shell path must not be empty');
    });

    it('registers an onExit listener', () => {
      spawn('powershell');
      expect(mockOnExit).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('write', () => {
    it('writes data to the PTY process', () => {
      spawn('powershell');
      write('ls\r');
      expect(mockWrite).toHaveBeenCalledWith('ls\r');
    });

    it('does nothing when no PTY is running', () => {
      write('test');
      expect(mockWrite).not.toHaveBeenCalled();
    });
  });

  describe('resize', () => {
    it('resizes the PTY to given dimensions', () => {
      spawn('powershell');
      resize(120, 40);
      expect(mockResize).toHaveBeenCalledWith(120, 40);
    });

    it('does nothing when no PTY is running', () => {
      resize(80, 24);
      expect(mockResize).not.toHaveBeenCalled();
    });
  });

  describe('onData', () => {
    it('uses the active PTY data handler after registering a callback post-spawn', () => {
      spawn('powershell');
      const registeredHandler = mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0];

      const cb = vi.fn();
      onData(cb);

      registeredHandler('test data');

      expect(mockOnData).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith('default', 'test data');
    });

    it('stores callback without error when no PTY is running', () => {
      const cb = vi.fn();
      onData(cb);
      expect(mockOnData).not.toHaveBeenCalled();
    });

    it('auto-wires stored data callback on subsequent spawn', () => {
      const cb = vi.fn();
      onData(cb); // stored, no PTY yet
      expect(mockOnData).not.toHaveBeenCalled();

      spawn('powershell'); // should auto-wire stored callback
      expect(mockOnData).toHaveBeenCalledWith(expect.any(Function));

      // Verify data flows through to the stored callback with tabId
      const registeredHandler = mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0];
      registeredHandler('test data');
      expect(cb).toHaveBeenCalledWith('default', 'test data');
    });
  });

  describe('onExit', () => {
    it('calls exit callback when PTY exits', () => {
      const exitCb = vi.fn();
      onExit(exitCb);
      spawn('powershell');

      // Simulate PTY exit
      const ptyOnExitHandler = mockOnExit.mock.calls[0][0];
      ptyOnExitHandler({ exitCode: 0, signal: 0 });

      expect(exitCb).toHaveBeenCalledWith(0, 0);
    });

    it('logs the exited PTY pid from the original spawn after a respawn', () => {
      const exitCb = vi.fn();
      onExit(exitCb);

      mockPid = 1111;
      spawn('powershell');
      const firstExitHandler = mockOnExit.mock.calls[0][0];

      mockPid = 2222;
      spawn('powershell');

      firstExitHandler({ exitCode: 5, signal: 9 });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'PTY exited (PID: 1111, exitCode: 5, signal: 9)',
      );
      expect(exitCb).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('kills the PTY process', () => {
      spawn('powershell');
      destroy();
      expect(mockKill).toHaveBeenCalled();
    });

    it('does nothing when no PTY is running', () => {
      destroy();
      expect(mockKill).not.toHaveBeenCalled();
    });

    it('clears state so subsequent writes are no-ops', () => {
      spawn('powershell');
      destroy();
      write('test');
      expect(mockWrite).not.toHaveBeenCalled();
    });
  });

  describe('resolveShellPath', () => {
    it('maps "powershell" to the absolute system PowerShell path', () => {
      expect(resolveShellPath('powershell')).toBe(
        getSystemShellPath('WindowsPowerShell', 'v1.0', 'powershell.exe'),
      );
    });

    it('maps "wsl" to the absolute system WSL path', () => {
      expect(resolveShellPath('wsl')).toBe(getSystemShellPath('wsl.exe'));
    });

    it('maps "pwsh" to "pwsh.exe"', () => {
      expect(resolveShellPath('pwsh')).toBe('pwsh.exe');
    });

    it('maps "cmd" to the absolute system cmd path', () => {
      expect(resolveShellPath('cmd')).toBe(getSystemShellPath('cmd.exe'));
    });

    it('maps "bash" to "bash.exe"', () => {
      expect(resolveShellPath('bash')).toBe('bash.exe');
    });

    it('passes through custom absolute paths unchanged', () => {
      expect(resolveShellPath('C:\\Git\\bin\\bash.exe')).toBe('C:\\Git\\bin\\bash.exe');
    });

    it('passes through unix-style absolute paths unchanged', () => {
      expect(resolveShellPath('/usr/bin/zsh')).toBe('/usr/bin/zsh');
    });
  });

  describe('spawn with custom shell paths', () => {
    it('spawns with a custom absolute path', () => {
      spawn('C:\\Windows\\System32\\cmd.exe');
      expect(nodePty.spawn).toHaveBeenCalledWith(
        'C:\\Windows\\System32\\cmd.exe',
        [],
        expect.objectContaining({
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
        }),
      );
    });

    it('spawns allowlisted shells by alias', () => {
      spawn('wsl');
      expect(nodePty.spawn).toHaveBeenCalledWith(
        getSystemShellPath('wsl.exe'),
        [],
        expect.any(Object),
      );
    });
  });

  describe('spawnPty', () => {
    it('uses the provided cwd when spawning tab-specific PTYs', () => {
      const onDataCb = vi.fn();
      const onExitCb = vi.fn();

      spawnPty('powershell', 120, 40, onDataCb, onExitCb, 'C:\\Projects\\QuakeShell');

      expect(nodePty.spawn).toHaveBeenCalledWith(
        getSystemShellPath('WindowsPowerShell', 'v1.0', 'powershell.exe'),
        [],
        expect.objectContaining({
          cols: 120,
          rows: 40,
          cwd: 'C:\\Projects\\QuakeShell',
        }),
      );
    });

    it('uses the supported pwsh and Git Bash aliases for tab-specific PTYs', () => {
      const onDataCb = vi.fn();
      const onExitCb = vi.fn();

      spawnPty('pwsh', 80, 24, onDataCb, onExitCb);
      expect(nodePty.spawn).toHaveBeenCalledWith(
        'pwsh.exe',
        [],
        expect.any(Object),
      );

      vi.clearAllMocks();

      spawnPty('bash', 80, 24, onDataCb, onExitCb);
      expect(nodePty.spawn).toHaveBeenCalledWith(
        'bash.exe',
        [],
        expect.any(Object),
      );
    });

    it('retains WSL variables and a validated custom path for tab-specific PTYs', () => {
      const onDataCb = vi.fn();
      const onExitCb = vi.fn();

      spawnPty('wsl', 80, 24, onDataCb, onExitCb);
      expect(nodePty.spawn).toHaveBeenCalledWith(
        getSystemShellPath('wsl.exe'),
        [],
        expect.objectContaining({
          env: expect.objectContaining({
            COLORTERM: 'truecolor',
            TERM: 'xterm-256color',
          }),
        }),
      );

      vi.clearAllMocks();

      spawnPty('C:\\Custom\\shell.exe', 80, 24, onDataCb, onExitCb);
      expect(nodePty.spawn).toHaveBeenCalledWith(
        'C:\\Custom\\shell.exe',
        [],
        expect.any(Object),
      );
    });
  });

  describe('setDefaultShell / getDefaultShell', () => {
    it('stores new shell preference without killing existing PTY', () => {
      spawn('powershell');
      setDefaultShell('wsl');

      // PTY should NOT have been killed
      expect(mockKill).not.toHaveBeenCalled();
      expect(getDefaultShell()).toBe('wsl');
    });

    it('next spawn uses the updated shell after setDefaultShell', () => {
      spawn('powershell');
      setDefaultShell('wsl');
      vi.clearAllMocks();

      // Simulate PTY exit and respawn
      destroy();
      spawn(getDefaultShell());

      expect(nodePty.spawn).toHaveBeenCalledWith(
        getSystemShellPath('wsl.exe'),
        [],
        expect.any(Object),
      );
    });

    it('setDefaultShell with custom path works', () => {
      setDefaultShell('C:\\Git\\bin\\bash.exe');
      expect(getDefaultShell()).toBe('C:\\Git\\bin\\bash.exe');

      spawn(getDefaultShell());
      expect(nodePty.spawn).toHaveBeenCalledWith(
        'C:\\Git\\bin\\bash.exe',
        [],
        expect.any(Object),
      );
    });
  });

  describe('getEnvironmentRefreshCommand', () => {
    it('returns scoped PowerShell templates for PowerShell aliases', () => {
      const powershellCommand = getEnvironmentRefreshCommand('powershell');

      expect(powershellCommand).toContain('& {');
      expect(powershellCommand).toContain("GetEnvironmentVariable('Path', 'Machine')");
      expect(powershellCommand).toContain("GetEnvironmentVariable('Path', 'User')");
      expect(powershellCommand).toContain('ExpandEnvironmentVariables');
      expect(powershellCommand).toContain('$env:Path');
      expect(getEnvironmentRefreshCommand('pwsh')).toBe(powershellCommand);
    });

    it('returns a static cmd template that updates only the current cmd Path', () => {
      const command = getEnvironmentRefreshCommand('cmd');

      expect(command).toContain('for /f');
      expect(command).toContain('call "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"');
      expect(command).toContain('@set "Path=%P"');
    });

    it('returns a static Git Bash template that safely preserves POSIX entries', () => {
      const command = getEnvironmentRefreshCommand('bash');

      expect(command).toContain('local windows_path posix_path refreshed_path');
      expect(command).toContain('"$SYSTEMROOT/System32/WindowsPowerShell/v1.0/powershell.exe"');
      expect(command).toContain('/usr/bin/cygpath -p');
      expect(command).toContain('/usr/bin/awk -F:');
      expect(command).toContain('export PATH');
    });

    it('does not create commands for WSL, custom shells, or aliases with different casing', () => {
      expect(getEnvironmentRefreshCommand('wsl')).toBeNull();
      expect(getEnvironmentRefreshCommand('C:\\Tools\\shell.exe')).toBeNull();
      expect(getEnvironmentRefreshCommand('PowerShell')).toBeNull();
    });
  });

  describe('WSL-specific environment variables', () => {
    it('passes COLORTERM and TERM env vars when spawning WSL', () => {
      spawn('wsl');
      expect(nodePty.spawn).toHaveBeenCalledWith(
        getSystemShellPath('wsl.exe'),
        [],
        expect.objectContaining({
          env: expect.objectContaining({
            COLORTERM: 'truecolor',
            TERM: 'xterm-256color',
          }),
        }),
      );
    });

    it('does NOT add WSL-specific env var overrides for non-WSL shells', () => {
      spawn('powershell');
      const callArgs = (nodePty.spawn as ReturnType<typeof vi.fn>).mock.calls[0][2];
      expect(callArgs.env.COLORTERM).toBe(process.env.COLORTERM);
      expect(callArgs.env.TERM).toBe(process.env.TERM);
    });
  });

  describe('normalizeWindowsSpawnEnv', () => {
    it('preserves drive and UNC roots when normalizing path segments for comparison', () => {
      expect(_normalizeWindowsPathSegmentForComparison('C:\\')).toBe('c:\\');
      expect(_normalizeWindowsPathSegmentForComparison('C:')).toBe('c:.');
      expect(_normalizeWindowsPathSegmentForComparison('\\\\server\\share\\')).toBe('\\\\server\\share\\');
    });

    it('collapses duplicate PATH key variants into a single Path entry with Volta shim first', () => {
      const env = normalizeWindowsSpawnEnv({
        PATH: [
          'C:\\Users\\test\\AppData\\Local\\Volta\\tools\\image\\npm\\11.10.0\\bin',
          'C:\\Windows\\System32',
        ].join(path.win32.delimiter),
        Path: [
          'C:\\Users\\test\\AppData\\Local\\Volta\\bin',
          'C:\\Windows\\System32',
        ].join(path.win32.delimiter),
        SystemRoot: 'C:\\Windows',
      });

      const pathSegments = env.Path.split(path.win32.delimiter);
      expect(Object.keys(env).filter((key) => key.toLowerCase() === 'path')).toEqual(['Path']);
      expect(pathSegments[0]).toBe('C:\\Users\\test\\AppData\\Local\\Volta\\bin');
      expect(pathSegments).toContain('C:\\Users\\test\\AppData\\Local\\Volta\\tools\\image\\npm\\11.10.0\\bin');
      expect(pathSegments).toContain('C:\\Windows\\System32');
    });

    it('prepends the Volta shim directory ahead of tool-image bins', () => {
      const env = normalizeWindowsSpawnEnv({
        Path: [
          'C:\\Users\\test\\AppData\\Local\\Volta\\tools\\image\\npm\\11.10.0\\bin',
          'C:\\Windows\\System32',
        ].join(path.win32.delimiter),
        VOLTA_HOME: 'C:\\Users\\test\\AppData\\Local\\Volta',
        SystemRoot: 'C:\\Windows',
      });

      const pathSegments = env.Path.split(path.win32.delimiter);
      expect(pathSegments[0]).toBe('C:\\Users\\test\\AppData\\Local\\Volta\\bin');
      expect(pathSegments).toContain('C:\\Users\\test\\AppData\\Local\\Volta\\tools\\image\\npm\\11.10.0\\bin');
      expect(pathSegments).toContain('C:\\Windows\\System32');
    });

    it('derives the Volta shim directory from tool image bins when VOLTA_HOME is missing', () => {
      const env = normalizeWindowsSpawnEnv({
        Path: [
          'C:\\Users\\test\\AppData\\Local\\Volta\\tools\\image\\npm\\11.10.0\\bin',
          'C:\\Windows\\System32',
        ].join(path.win32.delimiter),
        SystemRoot: 'C:\\Windows',
      });

      const pathSegments = env.Path.split(path.win32.delimiter);
      expect(pathSegments[0]).toBe('C:\\Users\\test\\AppData\\Local\\Volta\\bin');
      expect(pathSegments).toContain('C:\\Users\\test\\AppData\\Local\\Volta\\tools\\image\\npm\\11.10.0\\bin');
      expect(pathSegments).toContain('C:\\Windows\\System32');
    });

    it('hydrates SystemRoot from windir when PowerShell prerequisites are missing', () => {
      const env = normalizeWindowsSpawnEnv({
        Path: 'C:\\Windows\\System32',
        windir: 'C:\\Windows',
      });

      expect(env.SystemRoot).toBe('C:\\Windows');
    });

    it('strips npm lifecycle and config vars leaked from the parent process', () => {
      const env = normalizeWindowsSpawnEnv({
        Path: 'C:\\Windows\\System32',
        SystemRoot: 'C:\\Windows',
        npm_lifecycle_event: 'postinstall',
        npm_lifecycle_script: 'node scripts/npm/postinstall.js',
        npm_package_name: 'quakeshell',
        npm_package_version: '1.0.8',
        npm_config_prefix: 'C:\\Users\\test\\AppData\\Roaming\\npm',
        npm_execpath: 'C:\\Users\\test\\AppData\\Local\\Volta\\tools\\image\\npm\\11.10.0\\bin\\npm-cli.js',
        npm_node_execpath: 'C:\\Users\\test\\AppData\\Local\\Volta\\tools\\image\\node\\22.0.0\\node.exe',
        _VOLTA_TOOL_RECURSION: '1',
        NODE_PATH: 'C:\\Users\\test\\AppData\\Local\\Volta\\tools\\shared;',
        USERPROFILE: 'C:\\Users\\test',
      });

      expect(env).not.toHaveProperty('npm_lifecycle_event');
      expect(env).not.toHaveProperty('npm_lifecycle_script');
      expect(env).not.toHaveProperty('npm_package_name');
      expect(env).not.toHaveProperty('npm_package_version');
      expect(env).not.toHaveProperty('npm_config_prefix');
      expect(env).not.toHaveProperty('npm_execpath');
      expect(env).not.toHaveProperty('npm_node_execpath');
      expect(env).not.toHaveProperty('_VOLTA_TOOL_RECURSION');
      expect(env).not.toHaveProperty('NODE_PATH');
      expect(env.USERPROFILE).toBe('C:\\Users\\test');
    });

    it('keeps Volta tool-image paths but ensures shim directory comes first', () => {
      const env = normalizeWindowsSpawnEnv({
        Path: [
          'C:\\Users\\test\\AppData\\Local\\Volta\\tools\\image\\node\\22.0.0',
          'C:\\Users\\test\\AppData\\Local\\Volta\\tools\\image\\npm\\11.10.0\\bin',
          'C:\\Users\\test\\AppData\\Local\\Volta\\bin',
          'C:\\Windows\\System32',
          'C:\\Program Files\\Git\\cmd',
        ].join(path.win32.delimiter),
        VOLTA_HOME: 'C:\\Users\\test\\AppData\\Local\\Volta',
        SystemRoot: 'C:\\Windows',
      });

      const pathSegments = env.Path.split(path.win32.delimiter);
      expect(pathSegments[0]).toBe('C:\\Users\\test\\AppData\\Local\\Volta\\bin');
      expect(pathSegments).toContain('C:\\Users\\test\\AppData\\Local\\Volta\\tools\\image\\node\\22.0.0');
      expect(pathSegments).toContain('C:\\Users\\test\\AppData\\Local\\Volta\\tools\\image\\npm\\11.10.0\\bin');
      expect(pathSegments).toContain('C:\\Windows\\System32');
      expect(pathSegments).toContain('C:\\Program Files\\Git\\cmd');
    });

  });

  describe('spawn error handling', () => {
    it('displays dimmed WSL error message when wsl.exe spawn fails', () => {
      const dataCb = vi.fn();
      onData(dataCb);

      (nodePty.spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('spawn ENOENT');
      });

      spawn('wsl');

      expect(dataCb).toHaveBeenCalledWith(
        'default',
        expect.stringContaining('[Failed to start shell: WSL is not installed or not available]'),
      );
      // Should contain dimmed ANSI escape
      expect(dataCb).toHaveBeenCalledWith(
        'default',
        expect.stringContaining('\x1b[38;2;86;95;137m'),
      );
    });

    it('displays generic error message for non-WSL spawn failures', () => {
      const dataCb = vi.fn();
      onData(dataCb);

      (nodePty.spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('spawn EACCES');
      });

      spawn('powershell');

      expect(dataCb).toHaveBeenCalledWith(
        'default',
        expect.stringContaining('[Failed to start shell: spawn EACCES]'),
      );
    });

    it('does not throw when spawn fails — handles gracefully', () => {
      (nodePty.spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('spawn ENOENT');
      });

      expect(() => spawn('wsl')).not.toThrow();
    });
  });

  describe('custom shell path validation', () => {
    it('displays error when custom shell path does not exist', () => {
      const dataCb = vi.fn();
      onData(dataCb);

      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

      spawn('C:\\nonexistent\\shell.exe');

      expect(dataCb).toHaveBeenCalledWith(
        'default',
        expect.stringContaining('[Failed to start shell: Shell executable not found at C:\\nonexistent\\shell.exe]'),
      );
      // Should NOT attempt to call pty.spawn
      expect(nodePty.spawn).not.toHaveBeenCalled();
    });

    it('spawns normally when custom shell path exists', () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

      spawn('C:\\Git\\bin\\bash.exe');

      expect(nodePty.spawn).toHaveBeenCalledWith(
        'C:\\Git\\bin\\bash.exe',
        [],
        expect.any(Object),
      );
    });

    it('does NOT validate path for allowlisted shell aliases', () => {
      spawn('powershell');

      // fs.existsSync should not be called for known shells
      expect(fs.existsSync).not.toHaveBeenCalled();
      expect(nodePty.spawn).toHaveBeenCalled();
    });
  });

  describe('ANSI data pass-through', () => {
    it('forwards data from node-pty unmodified to the data callback with tabId', () => {
      const dataCb = vi.fn();
      onData(dataCb);
      spawn('powershell');

      // The data callback is registered via ptyProcess.onData
      // which is our mockOnData. Simulate data from PTY.
      const registeredCb = mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0];
      const ansiData = '\x1b[31mred text\x1b[0m normal text';
      registeredCb(ansiData);

      expect(dataCb).toHaveBeenCalledWith('default', ansiData);
    });
  });

  describe('onBell', () => {
    it('fires bell callback when \\x07 is detected in PTY data', () => {
      const bellCb = vi.fn();
      onBell(bellCb);
      spawn('powershell');

      const registeredCb = mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0];
      registeredCb('hello\x07world');

      expect(bellCb).toHaveBeenCalledTimes(1);
    });

    it('does not fire bell callback when no \\x07 in data', () => {
      const bellCb = vi.fn();
      onBell(bellCb);
      spawn('powershell');

      const registeredCb = mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0];
      registeredCb('hello world');

      expect(bellCb).not.toHaveBeenCalled();
    });

    it('still forwards data to data callback alongside bell', () => {
      const dataCb = vi.fn();
      const bellCb = vi.fn();
      onData(dataCb);
      onBell(bellCb);
      spawn('powershell');

      const registeredCb = mockOnData.mock.calls[mockOnData.mock.calls.length - 1][0];
      registeredCb('alert\x07');

      expect(bellCb).toHaveBeenCalledTimes(1);
      expect(dataCb).toHaveBeenCalledWith('default', 'alert\x07');
    });
  });

  describe('stale PTY exit guard', () => {
    it('does NOT fire exit callback when a killed PTY exits after a new spawn', () => {
      const exitCb = vi.fn();
      onExit(exitCb);

      // Spawn first PTY
      spawn('powershell');
      const firstExitHandler = mockOnExit.mock.calls[0][0];

      // Spawn second PTY (kills the first)
      spawn('powershell');

      // First PTY's exit fires asynchronously after being killed
      firstExitHandler({ exitCode: 1, signal: 15 });

      // Exit callback should NOT have been called — it was a stale exit
      expect(exitCb).not.toHaveBeenCalled();
    });

    it('fires exit callback for the current PTY', () => {
      const exitCb = vi.fn();
      onExit(exitCb);

      spawn('powershell');
      const exitHandler = mockOnExit.mock.calls[mockOnExit.mock.calls.length - 1][0];

      // Current PTY exits normally
      exitHandler({ exitCode: 0, signal: 0 });

      expect(exitCb).toHaveBeenCalledWith(0, 0);
    });
  });

  describe('stale PTY data guard', () => {
    it('does NOT forward data or bell events when a killed PTY emits after a new spawn', () => {
      const dataCb = vi.fn();
      const bellCb = vi.fn();
      onData(dataCb);
      onBell(bellCb);

      spawn('powershell');
      const firstDataHandler = mockOnData.mock.calls[0][0];

      spawn('powershell');

      firstDataHandler('stale\x07data');

      expect(dataCb).not.toHaveBeenCalled();
      expect(bellCb).not.toHaveBeenCalled();
    });
  });
});
