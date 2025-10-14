import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from './supabase.js';

interface AuthState {
  accessToken: string;
  refreshToken: string;
  userId: string;
  expiresAt: number;
}

export class AuthManager {
  private authFilePath: string;
  private authState: AuthState | null = null;
  private deviceId: string;

  constructor() {
    // Store auth state in user's home directory
    const configDir = path.join(os.homedir(), '.agent-orchestrator');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    this.authFilePath = path.join(configDir, 'auth.json');
    this.deviceId = this.getOrCreateDeviceId(configDir);
    this.loadAuthState();
  }

  private getOrCreateDeviceId(configDir: string): string {
    const deviceIdPath = path.join(configDir, 'device-id');

    if (fs.existsSync(deviceIdPath)) {
      return fs.readFileSync(deviceIdPath, 'utf-8').trim();
    }

    const newDeviceId = uuidv4();
    fs.writeFileSync(deviceIdPath, newDeviceId);
    return newDeviceId;
  }

  private loadAuthState(): void {
    try {
      if (fs.existsSync(this.authFilePath)) {
        const data = fs.readFileSync(this.authFilePath, 'utf-8');
        this.authState = JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading auth state:', error);
      this.authState = null;
    }
  }

  private saveAuthState(): void {
    try {
      if (this.authState) {
        fs.writeFileSync(
          this.authFilePath,
          JSON.stringify(this.authState, null, 2)
        );
      } else {
        if (fs.existsSync(this.authFilePath)) {
          fs.unlinkSync(this.authFilePath);
        }
      }
    } catch (error) {
      console.error('Error saving auth state:', error);
    }
  }

  async isAuthenticated(): Promise<boolean> {
    if (!this.authState) {
      return false;
    }

    // Check if token is expired (with 5 minute buffer)
    const now = Date.now();
    const expiresAt = this.authState.expiresAt;

    if (now >= expiresAt - 5 * 60 * 1000) {
      // Try to refresh the token
      return await this.refreshAuthToken();
    }

    return true;
  }

  private async refreshAuthToken(): Promise<boolean> {
    if (!this.authState?.refreshToken) {
      return false;
    }

    try {
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: this.authState.refreshToken,
      });

      if (error || !data.session) {
        console.error('Error refreshing token:', error);
        this.authState = null;
        this.saveAuthState();
        return false;
      }

      this.authState = {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        userId: data.session.user.id,
        expiresAt: data.session.expires_at! * 1000,
      };

      this.saveAuthState();
      return true;
    } catch (error) {
      console.error('Error refreshing auth token:', error);
      this.authState = null;
      this.saveAuthState();
      return false;
    }
  }

  getUserId(): string | null {
    return this.authState?.userId || null;
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  getAuthUrl(): string {
    const webUrl = process.env.WEB_URL || 'http://localhost:3000';
    return `${webUrl}/daemon-auth?device_id=${this.deviceId}`;
  }

  private openBrowser(url: string): void {
    const platform = process.platform;
    let command: string;

    if (platform === 'darwin') {
      command = `open "${url}"`;
    } else if (platform === 'win32') {
      command = `start "" "${url}"`;
    } else {
      // Linux/Unix
      command = `xdg-open "${url}"`;
    }

    exec(command, (error) => {
      if (error) {
        console.log('⚠️  Could not automatically open browser. Please open the URL manually.');
      }
    });
  }

  async waitForAuth(timeoutMs: number = 300000): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 2000; // Poll every 2 seconds
    const authUrl = this.getAuthUrl();

    console.log('\n🔐 Authentication Required');
    console.log('─'.repeat(50));
    console.log('Opening browser for authentication...');
    console.log(`\nURL: ${authUrl}\n`);
    console.log('If browser does not open, please copy the URL above.');
    console.log('Waiting for authentication...');
    console.log('─'.repeat(50));

    // Automatically open the browser
    this.openBrowser(authUrl);

    while (Date.now() - startTime < timeoutMs) {
      // Check if auth has been completed
      const authCompleted = await this.checkAuthCompletion();

      if (authCompleted) {
        console.log('✓ Authentication successful!');
        return true;
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    console.log('✗ Authentication timeout');
    return false;
  }

  private async checkAuthCompletion(): Promise<boolean> {
    try {
      // Check if a session was created for this device
      const { data, error } = await supabase
        .from('daemon_auth_sessions')
        .select('*')
        .eq('device_id', this.deviceId)
        .eq('consumed', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        // Only log if it's not a "no rows" error
        if (error.code !== 'PGRST116') {
          console.log('[Auth Check] Error:', error.message);
        }
        return false;
      }

      if (!data) {
        return false;
      }

      console.log('[Auth Check] Found auth session!');

      // Mark session as consumed
      await supabase
        .from('daemon_auth_sessions')
        .update({ consumed: true })
        .eq('id', data.id);

      // Store the auth state
      this.authState = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        userId: data.user_id,
        expiresAt: new Date(data.expires_at).getTime(),
      };

      this.saveAuthState();
      return true;
    } catch (error) {
      console.error('Error checking auth completion:', error);
      return false;
    }
  }

  async ensureAuthenticated(): Promise<boolean> {
    const authenticated = await this.isAuthenticated();

    if (authenticated) {
      return true;
    }

    // Prompt user to authenticate
    return await this.waitForAuth();
  }

  logout(): void {
    this.authState = null;
    this.saveAuthState();
    console.log('Logged out successfully');
  }
}
