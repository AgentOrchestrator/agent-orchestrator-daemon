import electron from 'electron';
type TrayType = electron.Tray;
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export enum DaemonStatus {
  UNAUTHENTICATED = 'unauthenticated',
  IDLE = 'idle',
  SYNCING = 'syncing',
  ERROR = 'error',
}

interface StatusConfig {
  icon: string;
  tooltip: string;
  menuLabel: string;
}

export class TrayManager {
  private tray: TrayType | null = null;
  private currentStatus: DaemonStatus = DaemonStatus.UNAUTHENTICATED;
  private onAuthenticateCallback?: () => void;
  private onSyncNowCallback?: () => void;
  private onOpenDashboardCallback?: () => void;

  constructor() {
    // Tray will be initialized when Electron app is ready
  }

  initialize() {
    // Create icon - use text-based title for macOS menu bar
    // macOS menu bar can show text instead of just icons
    const config = this.getStatusConfig(this.currentStatus);

    // Create a minimal empty icon
    const icon = electron.nativeImage.createEmpty();
    this.tray = new electron.Tray(icon);

    // Set the title text which appears in the menu bar
    this.tray.setTitle(config.icon);

    this.updateTray();
  }

  private createIcon(status: DaemonStatus): string {
    const iconMap: Record<DaemonStatus, string> = {
      [DaemonStatus.UNAUTHENTICATED]: '🔒',
      [DaemonStatus.IDLE]: '✅',
      [DaemonStatus.SYNCING]: '🔄',
      [DaemonStatus.ERROR]: '⚠️',
    };
    return iconMap[status];
  }

  private getStatusConfig(status: DaemonStatus): StatusConfig {
    const configs: Record<DaemonStatus, StatusConfig> = {
      [DaemonStatus.UNAUTHENTICATED]: {
        icon: '🔒',
        tooltip: 'Agent Orchestrator - Not Authenticated',
        menuLabel: '🔒 Not Authenticated',
      },
      [DaemonStatus.IDLE]: {
        icon: '✅',
        tooltip: 'Agent Orchestrator - Ready',
        menuLabel: '✅ Ready',
      },
      [DaemonStatus.SYNCING]: {
        icon: '🔄',
        tooltip: 'Agent Orchestrator - Syncing...',
        menuLabel: '🔄 Syncing...',
      },
      [DaemonStatus.ERROR]: {
        icon: '⚠️',
        tooltip: 'Agent Orchestrator - Error',
        menuLabel: '⚠️ Error',
      },
    };

    return configs[status];
  }

  private updateTray() {
    if (!this.tray) return;

    const config = this.getStatusConfig(this.currentStatus);
    this.tray.setToolTip(config.tooltip);
    this.tray.setTitle(config.icon); // Update the emoji icon in menu bar

    // Build context menu
    const menuItems: Electron.MenuItemConstructorOptions[] = [
      {
        label: config.menuLabel,
        enabled: false,
      },
      {
        type: 'separator',
      },
    ];

    // Add "Authenticate" option if not authenticated
    if (this.currentStatus === DaemonStatus.UNAUTHENTICATED && this.onAuthenticateCallback) {
      menuItems.push({
        label: 'Authenticate',
        click: () => this.onAuthenticateCallback?.(),
      });
    }

    // Add "Sync Now" option if authenticated
    if (
      this.currentStatus !== DaemonStatus.UNAUTHENTICATED &&
      this.currentStatus !== DaemonStatus.SYNCING &&
      this.onSyncNowCallback
    ) {
      menuItems.push({
        label: 'Sync Now',
        click: () => this.onSyncNowCallback?.(),
      });
    }

    // Add "Open Dashboard" option
    if (this.onOpenDashboardCallback) {
      menuItems.push({
        label: 'Open Dashboard',
        click: () => this.onOpenDashboardCallback?.(),
      });
    }

    menuItems.push(
      {
        type: 'separator',
      },
      {
        label: 'Quit',
        click: () => {
          electron.app.quit();
        },
      }
    );

    const contextMenu = electron.Menu.buildFromTemplate(menuItems);
    this.tray.setContextMenu(contextMenu);
  }

  setStatus(status: DaemonStatus) {
    this.currentStatus = status;
    this.updateTray();
  }

  setAuthenticateCallback(callback: () => void) {
    this.onAuthenticateCallback = callback;
    this.updateTray();
  }

  setSyncNowCallback(callback: () => void) {
    this.onSyncNowCallback = callback;
    this.updateTray();
  }

  setOpenDashboardCallback(callback: () => void) {
    this.onOpenDashboardCallback = callback;
    this.updateTray();
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
