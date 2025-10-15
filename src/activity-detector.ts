import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type EditorType = 'cursor' | 'windsurf' | 'claude_code' | 'vscode' | 'other';

export interface EditorActivity {
  editorType: EditorType;
  lastActivityAt: Date;
  isActive: boolean; // true if activity within past hour
  workspacePath: string | null | undefined; // Normalized path (e.g., "Developer/agent-orchestrator")
  recentFiles: Array<{
    path: string; // Normalized path
    lastAccessed: string; // ISO timestamp
  }>;
  metadata: Record<string, any>;
}

/**
 * Normalize file paths by removing $HOME prefix
 * Returns path from Developer/ or Documents/ onwards
 */
export function normalizePath(fullPath: string): string | null | undefined {
  if (!fullPath) return null;

  // Remove leading slash
  let normalized = fullPath.replace(/^\//, '');

  // Try to extract from "Developer" onwards
  const developerMatch = normalized.match(/.*?\/(Developer\/.*)$/);
  if (developerMatch) {
    return developerMatch[1];
  }

  // Try to extract from "Documents" onwards
  const documentsMatch = normalized.match(/.*?\/(Documents\/.*)$/);
  if (documentsMatch) {
    return documentsMatch[1];
  }

  // Extract last 2 path segments as fallback
  const segments = normalized.split('/').filter(s => s);
  if (segments.length >= 2) {
    return segments.slice(-2).join('/');
  }

  return normalized;
}

/**
 * Get file modification time
 */
function getFileModTime(filePath: string): Date | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stats = fs.statSync(filePath);
    return stats.mtime;
  } catch (error) {
    return null;
  }
}

/**
 * Check if a timestamp is within the past hour
 */
function isWithinPastHour(date: Date): boolean {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  return date > oneHourAgo;
}

/**
 * Get recently modified files in a workspace directory
 * Returns files modified within the past hour, excluding common ignore patterns
 */
function getRecentlyModifiedFiles(workspacePath: string, maxFiles: number = 10): Array<{
  path: string;
  lastAccessed: string;
}> {
  const recentFiles: Array<{ path: string; lastAccessed: string; mtime: Date }> = [];
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  // Common patterns to ignore
  const ignorePatterns = [
    /node_modules/,
    /\.git\//,
    /\.next/,
    /dist\//,
    /build\//,
    /\.vscode/,
    /\.idea/,
    /\.DS_Store/,
    /package-lock\.json/,
    /yarn\.lock/,
    /pnpm-lock\.yaml/,
  ];

  /**
   * Recursively scan directory for recently modified files
   */
  function scanDirectory(dirPath: string, depth: number = 0) {
    // Limit recursion depth to avoid infinite loops
    if (depth > 5) return;

    try {
      if (!fs.existsSync(dirPath)) return;

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = fullPath.replace(workspacePath + '/', '');

        // Skip if matches ignore pattern
        if (ignorePatterns.some(pattern => pattern.test(relativePath))) {
          continue;
        }

        if (entry.isDirectory()) {
          scanDirectory(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const stats = fs.statSync(fullPath);

          // Only include files modified in the past hour
          if (stats.mtime.getTime() > oneHourAgo) {
            recentFiles.push({
              path: relativePath,
              lastAccessed: stats.mtime.toISOString(),
              mtime: stats.mtime
            });
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
      return;
    }
  }

  try {
    scanDirectory(workspacePath);

    // Sort by most recent first and take top N
    recentFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    return recentFiles.slice(0, maxFiles).map(({ path, lastAccessed }) => ({
      path: normalizePath(path) || path,
      lastAccessed
    }));
  } catch (error) {
    return [];
  }
}

/**
 * Detect Cursor activity
 */
function detectCursorActivity(): EditorActivity | null {
  const homeDir = os.homedir();
  const cursorStatePath = path.join(
    homeDir,
    'Library',
    'Application Support',
    'Cursor',
    'User',
    'globalStorage',
    'state.vscdb'
  );

  const modTime = getFileModTime(cursorStatePath);
  if (!modTime) return null;

  // Try to get workspace storage for more details
  const workspaceStoragePath = path.join(
    homeDir,
    'Library',
    'Application Support',
    'Cursor',
    'User',
    'workspaceStorage'
  );

  let mostRecentWorkspace: string | null = null;
  let mostRecentTime: Date = modTime;

  try {
    if (fs.existsSync(workspaceStoragePath)) {
      const workspaceDirs = fs.readdirSync(workspaceStoragePath);

      for (const dir of workspaceDirs) {
        const workspaceDbPath = path.join(workspaceStoragePath, dir, 'state.vscdb');
        const workspaceJsonPath = path.join(workspaceStoragePath, dir, 'workspace.json');

        const dbModTime = getFileModTime(workspaceDbPath);
        if (dbModTime && dbModTime > mostRecentTime) {
          mostRecentTime = dbModTime;

          // Try to read workspace.json to get folder path
          if (fs.existsSync(workspaceJsonPath)) {
            try {
              const workspaceJson = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf-8'));
              if (workspaceJson.folder) {
                const folderUri = typeof workspaceJson.folder === 'string'
                  ? workspaceJson.folder
                  : workspaceJson.folder.path;
                mostRecentWorkspace = folderUri.replace('file://', '');
              }
            } catch (e) {
              // Skip malformed workspace.json
            }
          }
        }
      }
    }
  } catch (error) {
    // Silently fail if can't read workspace storage
  }

  // Get recently modified files in the workspace
  const recentFiles = mostRecentWorkspace
    ? getRecentlyModifiedFiles(mostRecentWorkspace, 10)
    : [];

  const normalizedWorkspacePath = mostRecentWorkspace ? normalizePath(mostRecentWorkspace) : undefined;

  return {
    editorType: 'cursor',
    lastActivityAt: mostRecentTime,
    isActive: isWithinPastHour(mostRecentTime),
    workspacePath: normalizedWorkspacePath,
    recentFiles,
    metadata: {
      workspacePath: mostRecentWorkspace,
      fileCount: recentFiles.length
    }
  };
}

/**
 * Detect Windsurf activity
 */
function detectWindsurfActivity(): EditorActivity | null {
  const homeDir = os.homedir();
  const windsurfStatePath = path.join(
    homeDir,
    'Library',
    'Application Support',
    'Windsurf',
    'User',
    'globalStorage',
    'state.vscdb'
  );

  const modTime = getFileModTime(windsurfStatePath);
  if (!modTime) return null;

  // Try to get workspace storage (same structure as Cursor)
  const workspaceStoragePath = path.join(
    homeDir,
    'Library',
    'Application Support',
    'Windsurf',
    'User',
    'workspaceStorage'
  );

  let mostRecentWorkspace: string | null = null;
  let mostRecentTime: Date = modTime;

  try {
    if (fs.existsSync(workspaceStoragePath)) {
      const workspaceDirs = fs.readdirSync(workspaceStoragePath);

      for (const dir of workspaceDirs) {
        const workspaceDbPath = path.join(workspaceStoragePath, dir, 'state.vscdb');
        const workspaceJsonPath = path.join(workspaceStoragePath, dir, 'workspace.json');

        const dbModTime = getFileModTime(workspaceDbPath);
        if (dbModTime && dbModTime > mostRecentTime) {
          mostRecentTime = dbModTime;

          // Try to read workspace.json to get folder path
          if (fs.existsSync(workspaceJsonPath)) {
            try {
              const workspaceJson = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf-8'));
              if (workspaceJson.folder) {
                const folderUri = typeof workspaceJson.folder === 'string'
                  ? workspaceJson.folder
                  : workspaceJson.folder.path;
                mostRecentWorkspace = folderUri.replace('file://', '');
              }
            } catch (e) {
              // Skip malformed workspace.json
            }
          }
        }
      }
    }
  } catch (error) {
    // Silently fail if can't read workspace storage
  }

  // Get recently modified files in the workspace
  const recentFiles = mostRecentWorkspace
    ? getRecentlyModifiedFiles(mostRecentWorkspace, 10)
    : [];

  const normalizedWorkspacePath = mostRecentWorkspace ? normalizePath(mostRecentWorkspace) : undefined;

  return {
    editorType: 'windsurf',
    lastActivityAt: mostRecentTime,
    isActive: isWithinPastHour(mostRecentTime),
    workspacePath: normalizedWorkspacePath,
    recentFiles,
    metadata: {
      workspacePath: mostRecentWorkspace,
      fileCount: recentFiles.length
    }
  };
}

/**
 * Detect Claude Code activity
 */
function detectClaudeCodeActivity(): EditorActivity | null {
  const homeDir = os.homedir();
  const claudeDir = path.join(homeDir, '.claude');
  const projectsDir = path.join(claudeDir, 'projects');

  if (!fs.existsSync(projectsDir)) return null;

  let mostRecentTime: Date | null = null;
  let mostRecentProject: string | null = null;

  try {
    const projectDirs = fs.readdirSync(projectsDir);

    for (const projectDir of projectDirs) {
      const projectDirPath = path.join(projectsDir, projectDir);
      if (!fs.statSync(projectDirPath).isDirectory()) continue;

      // Check all .jsonl files in this project
      const sessionFiles = fs.readdirSync(projectDirPath).filter(f => f.endsWith('.jsonl'));

      for (const sessionFile of sessionFiles) {
        const sessionFilePath = path.join(projectDirPath, sessionFile);
        const modTime = getFileModTime(sessionFilePath);

        if (modTime && (!mostRecentTime || modTime > mostRecentTime)) {
          mostRecentTime = modTime;
          // Convert directory name back to project path
          // e.g., "-Users-duonghaidang-Developer-agent-orchestrator" -> "/Users/duonghaidang/Developer/agent-orchestrator"
          mostRecentProject = projectDir.replace(/^-/, '/').replace(/-/g, '/');
        }
      }
    }
  } catch (error) {
    return null;
  }

  if (!mostRecentTime) return null;

  // Get recently modified files in the workspace
  const recentFiles = mostRecentProject
    ? getRecentlyModifiedFiles(mostRecentProject, 10)
    : [];

  const normalizedWorkspacePath = mostRecentProject ? normalizePath(mostRecentProject) : undefined;

  return {
    editorType: 'claude_code',
    lastActivityAt: mostRecentTime,
    isActive: isWithinPastHour(mostRecentTime),
    workspacePath: normalizedWorkspacePath,
    recentFiles,
    metadata: {
      workspacePath: mostRecentProject,
      fileCount: recentFiles.length
    }
  };
}

/**
 * Detect VS Code activity
 */
function detectVSCodeActivity(): EditorActivity | null {
  const homeDir = os.homedir();
  const vscodeStatePath = path.join(
    homeDir,
    'Library',
    'Application Support',
    'Code',
    'User',
    'globalStorage',
    'state.vscdb'
  );

  const modTime = getFileModTime(vscodeStatePath);
  if (!modTime) return null;

  return {
    editorType: 'vscode',
    lastActivityAt: modTime,
    isActive: isWithinPastHour(modTime),
    workspacePath: undefined,
    recentFiles: [],
    metadata: {
      dbPath: vscodeStatePath,
      dbModified: modTime.toISOString()
    }
  };
}

/**
 * Detect all editor activities
 * Returns array of active editors (sorted by most recent first)
 */
export function detectAllEditorActivity(): EditorActivity[] {
  const activities: EditorActivity[] = [];

  const cursor = detectCursorActivity();
  if (cursor) activities.push(cursor);

  const windsurf = detectWindsurfActivity();
  if (windsurf) activities.push(windsurf);

  const claudeCode = detectClaudeCodeActivity();
  if (claudeCode) activities.push(claudeCode);

  const vscode = detectVSCodeActivity();
  if (vscode) activities.push(vscode);

  // Sort by most recent activity first
  activities.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());

  return activities;
}

/**
 * Get the most recently used editor
 */
export function getMostRecentEditor(): EditorActivity | null | undefined {
  const activities = detectAllEditorActivity();
  return activities.length > 0 ? activities[0] : null;
}

/**
 * Get all currently active editors (activity within past hour)
 */
export function getActiveEditors(): EditorActivity[] {
  return detectAllEditorActivity().filter(a => a.isActive);
}
