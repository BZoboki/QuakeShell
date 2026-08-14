import { useEffect, useState } from 'preact/hooks';
import type { DisplayInfo } from '@shared/ipc-types';
import type { WindowConfig, TerminalConfig } from '@shared/config-types';
import { hotkey as hotkeySignal } from '../../state/config-store';
import { openSettings } from '../../state/settings-store';
import SettingsRow from './SettingsRow';
import Toggle from './Toggle';
import styles from './GeneralSettings.module.css';

const BUILTIN_SHELLS = new Set(['powershell', 'pwsh', 'cmd', 'bash', 'wsl']);

type ShellSelection = 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'wsl' | 'custom';

function getShellSelection(value: string): ShellSelection {
  return BUILTIN_SHELLS.has(value) ? value as ShellSelection : 'custom';
}

function monitorValueToOption(value: WindowConfig['monitor']): string {
  return typeof value === 'number' ? String(value) : value;
}

function optionToMonitorValue(value: string): WindowConfig['monitor'] {
  if (value === 'active' || value === 'primary') {
    return value;
  }

  return Number.parseInt(value, 10);
}

export default function GeneralSettings() {
  const [shellSelection, setShellSelection] = useState<ShellSelection>('powershell');
  const [customShellPath, setCustomShellPath] = useState('');
  const [startLocation, setStartLocation] = useState<TerminalConfig['startLocation']>('home');
  const [customStartDir, setCustomStartDir] = useState('');
  const [focusFadeEnabled, setFocusFadeEnabled] = useState(false);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [heightPercent, setHeightPercent] = useState(40);
  const [widthPercent, setWidthPercent] = useState(100);
  const [monitorTarget, setMonitorTarget] = useState<string>('active');
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [isAcrylicSupported, setIsAcrylicSupported] = useState(false);
  const [acrylicBlurEnabled, setAcrylicBlurEnabled] = useState(false);
  const [acrylicError, setAcrylicError] = useState('');

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      window.quakeshell.config.get('defaultShell'),
      window.quakeshell.config.get('window'),
      window.quakeshell.config.get('dropHeight'),
      window.quakeshell.config.get('focusFade'),
      window.quakeshell.config.get('autostart'),
      window.quakeshell.config.get('acrylicBlur'),
      window.quakeshell.config.get('terminal'),
      window.quakeshell.display.getAll(),
      window.quakeshell.platform.isAcrylicSupported(),
    ]).then(([
      defaultShell,
      windowConfig,
      dropHeight,
      focusFade,
      autostart,
      acrylicBlur,
      terminalConfigValue,
      nextDisplays,
      acrylicSupported,
    ]) => {
      if (cancelled) {
        return;
      }

      const shellValue = typeof defaultShell === 'string' ? defaultShell : 'powershell';
      const nextWindow = (windowConfig as WindowConfig | undefined) ?? {
        heightPercent: 40,
        widthPercent: 100,
        monitor: 'active',
      };
      const legacyHeight = typeof dropHeight === 'number' ? dropHeight : 40;
      const effectiveHeight = nextWindow.heightPercent === 30 && legacyHeight !== 30
        ? legacyHeight
        : nextWindow.heightPercent;

      setShellSelection(getShellSelection(shellValue));
      setCustomShellPath(BUILTIN_SHELLS.has(shellValue) ? '' : shellValue);
      const terminalConfig = (terminalConfigValue as TerminalConfig | undefined) ?? {
        startLocation: 'home',
        customStartDirectory: '',
      };
      setStartLocation(terminalConfig.startLocation);
      setCustomStartDir(terminalConfig.customStartDirectory);
      setFocusFadeEnabled(Boolean(focusFade));
      setAutostartEnabled(Boolean(autostart));
      setHeightPercent(effectiveHeight);
      setWidthPercent(nextWindow.widthPercent);
      setMonitorTarget(monitorValueToOption(nextWindow.monitor));
      setAcrylicBlurEnabled(Boolean(acrylicBlur));
      setDisplays(nextDisplays);
      setIsAcrylicSupported(acrylicSupported);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const updateWindowConfig = async (nextWindowConfig: Partial<WindowConfig>) => {
    const currentWindow = await window.quakeshell.config.get('window') as WindowConfig;

    await window.quakeshell.config.set('window', {
      ...currentWindow,
      ...nextWindowConfig,
    });
  };

  const handleShellChange = async (value: string) => {
    const nextSelection = value as ShellSelection;
    setShellSelection(nextSelection);

    if (nextSelection === 'custom') {
      return;
    }

    await window.quakeshell.config.set('defaultShell', nextSelection);
  };

  const commitCustomShell = async () => {
    const trimmedPath = customShellPath.trim();
    if (!trimmedPath) {
      return;
    }

    await window.quakeshell.config.set('defaultShell', trimmedPath);
  };

  const updateTerminalConfig = async (nextTerminalConfig: Partial<TerminalConfig>) => {
    const currentTerminal = await window.quakeshell.config.get('terminal') as TerminalConfig | undefined;

    await window.quakeshell.config.set('terminal', {
      startLocation: 'home',
      customStartDirectory: '',
      ...(currentTerminal ?? {}),
      ...nextTerminalConfig,
    });
  };

  const handleStartLocationChange = async (value: string) => {
    const nextLocation = value as TerminalConfig['startLocation'];
    setStartLocation(nextLocation);
    await updateTerminalConfig({ startLocation: nextLocation });
  };

  const commitCustomStartDir = async () => {
    await updateTerminalConfig({ customStartDirectory: customStartDir.trim() });
  };

  const handleHeightCommit = async (value: number) => {
    const clamped = Math.max(10, Math.min(90, value));
    setHeightPercent(clamped);
    await window.quakeshell.config.set('window.heightPercent', clamped);
  };

  const handleWidthCommit = async (value: number) => {
    const clamped = Math.max(20, Math.min(100, value));
    setWidthPercent(clamped);
    await window.quakeshell.config.set('window.widthPercent', clamped);
  };

  const handleMonitorChange = async (value: string) => {
    setMonitorTarget(value);
    await updateWindowConfig({ monitor: optionToMonitorValue(value) });
  };

  const handleAcrylicToggle = async (value: boolean) => {
    const previousValue = acrylicBlurEnabled;
    setAcrylicError('');
    setAcrylicBlurEnabled(value);
    await window.quakeshell.config.set('acrylicBlur', value);

    const result = await window.quakeshell.window.setAcrylicBlur(value);
    if (result.success) {
      return;
    }

    setAcrylicBlurEnabled(previousValue);
    setAcrylicError(result.error ?? 'Failed to apply acrylic blur');
    await window.quakeshell.config.set('acrylicBlur', previousValue);
  };

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Core</div>
        <SettingsRow label="Default Shell" description="Used for new tabs. Existing tabs keep their current shell.">
          <div>
            <select
              className={styles.select}
              value={shellSelection}
              onChange={(event) => { void handleShellChange((event.target as HTMLSelectElement).value); }}
            >
              <option value="powershell">PowerShell</option>
              <option value="pwsh">PowerShell (Core)</option>
              <option value="wsl">WSL</option>
              <option value="cmd">Command Prompt</option>
              <option value="bash">Git Bash</option>
              <option value="custom">Custom path</option>
            </select>
            {shellSelection === 'custom' ? (
              <input
                type="text"
                className={styles.customInput}
                value={customShellPath}
                placeholder="C:\\Path\\To\\Shell.exe"
                onInput={(event) => setCustomShellPath((event.target as HTMLInputElement).value)}
                onBlur={() => { void commitCustomShell(); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void commitCustomShell();
                  }
                }}
              />
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow label="Start Location" description="Directory new tabs start in. 'Last used' follows shells that report their directory (OSC 7/9;9) and 'Open QuakeShell here' launches.">
          <div>
            <select
              className={styles.select}
              value={startLocation}
              onChange={(event) => { void handleStartLocationChange((event.target as HTMLSelectElement).value); }}
            >
              <option value="home">User home folder</option>
              <option value="lastUsed">Last used directory</option>
              <option value="custom">Custom directory</option>
            </select>
            {startLocation === 'custom' ? (
              <input
                type="text"
                className={styles.customInput}
                value={customStartDir}
                placeholder="C:\Projects"
                onInput={(event) => setCustomStartDir((event.target as HTMLInputElement).value)}
                onBlur={() => { void commitCustomStartDir(); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void commitCustomStartDir();
                  }
                }}
              />
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow label="Global Hotkey" description="Use the keyboard tab to remap the toggle shortcut.">
          <div className={styles.hotkeyRow}>
            <span className={styles.hotkeyValue}>{hotkeySignal.value}</span>
            <button type="button" className={styles.hotkeyLink} onClick={() => openSettings('keyboard')}>
              Change in Keyboard tab
            </button>
          </div>
        </SettingsRow>

        <SettingsRow label="Focus Fade" description="Hide QuakeShell after focus leaves the window.">
          <Toggle
            checked={focusFadeEnabled}
            onChange={(value) => {
              setFocusFadeEnabled(value);
              void window.quakeshell.config.set('focusFade', value);
            }}
          />
        </SettingsRow>

        <SettingsRow label="Autostart" description="Launch QuakeShell automatically when Windows starts.">
          <Toggle
            checked={autostartEnabled}
            onChange={(value) => {
              setAutostartEnabled(value);
              void window.quakeshell.config.set('autostart', value);
            }}
          />
        </SettingsRow>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Window</div>
        <SettingsRow label="Terminal Height" description="Controls the visible height of the drop-down window.">
          <div className={styles.sliderWrap}>
            <input
              type="range"
              min="10"
              max="90"
              value={heightPercent}
              className={styles.slider}
              onInput={(event) => setHeightPercent(Number.parseInt((event.target as HTMLInputElement).value, 10))}
              onPointerUp={(event) => { void handleHeightCommit(Number.parseInt((event.target as HTMLInputElement).value, 10)); }}
              onChange={(event) => { void handleHeightCommit(Number.parseInt((event.target as HTMLInputElement).value, 10)); }}
            />
            <span className={styles.sliderReadout}>{heightPercent}%</span>
          </div>
        </SettingsRow>

        <SettingsRow label="Terminal Width" description="Shrinks the terminal inward from the monitor edges.">
          <div className={styles.sliderWrap}>
            <input
              type="range"
              min="20"
              max="100"
              value={widthPercent}
              className={styles.slider}
              onInput={(event) => setWidthPercent(Number.parseInt((event.target as HTMLInputElement).value, 10))}
              onPointerUp={(event) => { void handleWidthCommit(Number.parseInt((event.target as HTMLInputElement).value, 10)); }}
              onChange={(event) => { void handleWidthCommit(Number.parseInt((event.target as HTMLInputElement).value, 10)); }}
            />
            <span className={styles.sliderReadout}>{widthPercent}%</span>
          </div>
        </SettingsRow>

        <SettingsRow label="Monitor" description="Choose which display QuakeShell should use when shown.">
          <select
            className={styles.select}
            value={monitorTarget}
            onChange={(event) => { void handleMonitorChange((event.target as HTMLSelectElement).value); }}
          >
            <option value="active">Active Monitor</option>
            <option value="primary">Primary Monitor</option>
            {displays.map((display, index) => (
              <option key={display.id} value={String(display.id)}>
                {display.label || `Monitor ${index + 1}`}
              </option>
            ))}
          </select>
        </SettingsRow>

        {isAcrylicSupported ? (
          <SettingsRow label="Acrylic Blur" description="Use Windows 11 acrylic material behind the terminal window.">
            <div>
              <Toggle checked={acrylicBlurEnabled} onChange={(value) => { void handleAcrylicToggle(value); }} />
              {acrylicError ? <div className={styles.error}>{acrylicError}</div> : null}
            </div>
          </SettingsRow>
        ) : null}
      </div>
    </div>
  );
}