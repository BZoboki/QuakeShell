// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('./SettingsPanel.module.css', () => ({
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

vi.mock('./GeneralSettings', () => ({ default: () => <div>General content</div> }));
vi.mock('./AppearanceSettings', () => ({ default: () => <div>Appearance content</div> }));
vi.mock('./ThemesSettings', () => ({ default: () => <div>Themes content</div> }));
vi.mock('./KeyboardSettings', () => ({ default: () => <div>Keyboard content</div> }));
vi.mock('./DistributionSettings', () => ({ default: () => <div>Distribution content</div> }));
vi.mock('./UpdateSettings', () => ({ default: () => <div>Updates content</div> }));

Object.defineProperty(window, 'quakeshell', {
  value: {
    config: {
      openInEditor: vi.fn(),
    },
  },
  writable: true,
});

import SettingsPanel from './SettingsPanel';
import { openSettings, closeSettings, _reset } from '../../state/settings-store';

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('SettingsPanel', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    _reset();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    _reset();
    vi.clearAllMocks();
  });

  it('does not render when closed', async () => {
    await act(async () => {
      render(<SettingsPanel />, container);
    });

    expect(container.textContent).toBe('');
  });

  it('renders when opened', async () => {
    openSettings();

    await act(async () => {
      render(<SettingsPanel />, container);
    });
    await flush();

    expect(container.textContent).toContain('Settings');
    expect(container.textContent).toContain('General content');
  });

  it('clicking the backdrop closes the overlay', async () => {
    openSettings();

    await act(async () => {
      render(<SettingsPanel />, container);
    });

    const backdrop = container.querySelector('[role="dialog"]')?.parentElement as HTMLElement;

    await act(async () => {
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toBe('');
  });

  it('pressing Escape closes the overlay', async () => {
    openSettings();

    await act(async () => {
      render(<SettingsPanel />, container);
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    });

    expect(container.textContent).toBe('');
  });

  it('renders all tabs and switches active content', async () => {
    openSettings();

    await act(async () => {
      render(<SettingsPanel />, container);
    });

    expect(container.textContent).toContain('General');
    expect(container.textContent).toContain('Appearance');
    expect(container.textContent).toContain('Themes');
    expect(container.textContent).toContain('Keyboard');
    expect(container.textContent).toContain('Distribution');
    expect(container.textContent).toContain('Updates');

    const themesButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Themes',
    ) as HTMLButtonElement;

    await act(async () => {
      themesButton.click();
    });

    expect(container.textContent).toContain('Themes content');

    const updatesButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Updates',
    ) as HTMLButtonElement;

    await act(async () => {
      updatesButton.click();
    });

    expect(container.textContent).toContain('Updates content');
  });

  it('clicking the close button closes the overlay', async () => {
    openSettings();

    await act(async () => {
      render(<SettingsPanel />, container);
    });

    const closeButton = container.querySelector('[aria-label="Close settings"]') as HTMLButtonElement;

    await act(async () => {
      closeButton.click();
    });

    expect(container.textContent).toBe('');
    closeSettings();
  });
});