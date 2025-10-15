import Database from 'better-sqlite3';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';

export interface CursorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  composerId?: string;
  bubbleId?: string;
  sessionId?: string;
  modelName?: string | undefined;
}

export interface CursorConversation {
  id: string; // composerId or sessionId
  timestamp: string;
  messages: CursorMessage[];
  conversationType: 'composer' | 'copilot';
  metadata?: {
    workspace?: string | undefined;
    workspaceId?: string | undefined;
    projectName?: string | undefined;
    projectPath?: string | undefined;
    conversationName?: string | undefined;
    source: 'cursor-composer' | 'cursor-copilot';
    [key: string]: any;
  } | undefined;
}

export interface ProjectInfo {
  name: string;
  path: string;
  workspaceIds: string[];
  composerCount: number;
  copilotSessionCount: number;
  lastActivity: string;
}

interface BubbleData {
  _v?: number;
  type?: number;
  bubbleId: string;
  text?: string;
  richText?: string;
  createdAt: string;
  modelInfo?: {
    modelName: string;
  };
  [key: string]: any;
}

interface ComposerData {
  _v?: number;
  composerId: string;
  bubbles?: string[];
  conversation?: BubbleData[];
  fullConversationHeadersOnly?: Array<{
    bubbleId: string;
    type: number;
    serverBubbleId?: string;
  }>;
  createdAt?: string | number;
  lastUpdatedAt?: string | number;
  workspace?: string;
  name?: string;
  context?: {
    fileSelections?: Array<{
      uri?: {
        fsPath?: string;
      };
    }>;
    folderSelections?: Array<{
      uri?: {
        fsPath?: string;
      };
    }>;
    [key: string]: any;
  };
  [key: string]: any;
}

/**
 * Generate a deterministic UUID v4-compatible ID from a string
 * This ensures consistent IDs across runs for the same workspace/session
 */
function generateDeterministicUUID(input: string): string {
  const hash = createHash('md5').update(input).digest('hex');
  // Format as UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
}

/**
 * Get the path to Cursor's state database
 */
function getCursorStatePath(): string {
  const homeDir = os.homedir();
  return path.join(
    homeDir,
    'Library',
    'Application Support',
    'Cursor',
    'User',
    'globalStorage',
    'state.vscdb'
  );
}

/**
 * Parse rich text format to extract plain text
 */
function parseRichText(richText: string): string {
  try {
    const data = JSON.parse(richText);
    if (data.root?.children) {
      const textParts: string[] = [];

      function extractText(node: any) {
        if (node.text) {
          textParts.push(node.text);
        }
        if (node.children) {
          node.children.forEach(extractText);
        }
      }

      data.root.children.forEach(extractText);
      return textParts.join(' ');
    }
  } catch (e) {
    // If parsing fails, return as-is
  }
  return richText;
}

/**
 * Normalize timestamp to ISO 8601 format
 * Handles Unix timestamps (milliseconds), Unix timestamps (seconds), and ISO strings
 */
function normalizeTimestamp(timestamp: string | number | undefined): string {
  if (!timestamp) {
    return new Date().toISOString();
  }

  // If it's already a string, check if it's ISO format or a numeric string
  if (typeof timestamp === 'string') {
    // Check if it's a numeric string (Unix timestamp)
    const numericTimestamp = parseInt(timestamp, 10);
    if (!isNaN(numericTimestamp) && numericTimestamp > 0) {
      timestamp = numericTimestamp;
    } else {
      // Try parsing as ISO string
      const date = new Date(timestamp);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
      return new Date().toISOString();
    }
  }

  // Handle numeric timestamps
  if (typeof timestamp === 'number') {
    // If timestamp is in milliseconds (> year 2000 in seconds)
    if (timestamp > 946684800000) {
      return new Date(timestamp).toISOString();
    }
    // If timestamp is in seconds
    if (timestamp > 946684800) {
      return new Date(timestamp * 1000).toISOString();
    }
  }

  return new Date().toISOString();
}

/**
 * Extract project information from composer data
 */
function extractProjectInfo(composerData: ComposerData): {
  projectName?: string | undefined;
  projectPath?: string | undefined;
  conversationName?: string | undefined;
} {
  const result: {
    projectName?: string | undefined;
    projectPath?: string | undefined;
    conversationName?: string | undefined;
  } = {};

  // Get conversation name if available
  if (composerData.name) {
    result.conversationName = composerData.name;
  }

  // Try to extract project from file selections in context
  const context = composerData.context;
  if (context?.fileSelections && Array.isArray(context.fileSelections)) {
    for (const selection of context.fileSelections) {
      if (selection.uri?.fsPath) {
        const path = selection.uri.fsPath;
        const parts = path.split('/');
        const devIndex = parts.indexOf('Developer');

        if (devIndex >= 0 && devIndex + 1 < parts.length) {
          result.projectName = parts[devIndex + 1];
          result.projectPath = parts.slice(0, devIndex + 2).join('/');
          break; // Use first valid project path found
        }
      }
    }
  }

  // Also check folder selections if no project found yet
  if (!result.projectName && context?.folderSelections && Array.isArray(context.folderSelections)) {
    for (const selection of context.folderSelections) {
      if (selection.uri?.fsPath) {
        const path = selection.uri.fsPath;
        const parts = path.split('/');
        const devIndex = parts.indexOf('Developer');

        if (devIndex >= 0 && devIndex + 1 < parts.length) {
          result.projectName = parts[devIndex + 1];
          result.projectPath = parts.slice(0, devIndex + 2).join('/');
          break;
        }
      }
    }
  }

  return result;
}

/**
 * Get the path to Cursor's workspace storage
 */
function getCursorWorkspaceStoragePath(): string {
  const homeDir = os.homedir();
  return path.join(
    homeDir,
    'Library',
    'Application Support',
    'Cursor',
    'User',
    'workspaceStorage'
  );
}

/**
 * Parse workspace.json to get workspace information
 */
interface WorkspaceInfo {
  workspaceId: string;
  folder?: string | undefined;
  workspace?: any;
}

function getWorkspaceInfo(workspaceDir: string): WorkspaceInfo | null {
  const workspaceJsonPath = path.join(workspaceDir, 'workspace.json');

  if (!fs.existsSync(workspaceJsonPath)) {
    return null;
  }

  try {
    const workspaceJson = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf-8'));
    const workspaceId = path.basename(workspaceDir);

    // Extract folder path from workspace.json
    let folder: string | undefined;
    if (workspaceJson.folder) {
      // Handle file:// URIs
      const uri = workspaceJson.folder;
      if (typeof uri === 'string') {
        folder = uri.replace('file://', '');
      } else if (uri.path) {
        folder = uri.path;
      }
    }

    return {
      workspaceId,
      folder,
      workspace: workspaceJson
    };
  } catch (e) {
    return null;
  }
}

/**
 * Read Copilot sessions from workspace databases
 */
function readCopilotSessions(): CursorConversation[] {
  const conversations: CursorConversation[] = [];
  const workspaceStoragePath = getCursorWorkspaceStoragePath();

  if (!fs.existsSync(workspaceStoragePath)) {
    console.log('[Cursor] Workspace storage not found');
    return conversations;
  }

  const workspaceDirs = fs.readdirSync(workspaceStoragePath)
    .map(name => path.join(workspaceStoragePath, name))
    .filter(p => fs.statSync(p).isDirectory());

  console.log(`[Cursor] Scanning ${workspaceDirs.length} workspace directories for Copilot sessions...`);

  let totalSessions = 0;

  for (const workspaceDir of workspaceDirs) {
    const dbPath = path.join(workspaceDir, 'state.vscdb');

    if (!fs.existsSync(dbPath)) {
      continue;
    }

    const workspaceInfo = getWorkspaceInfo(workspaceDir);
    if (!workspaceInfo) {
      continue;
    }

    try {
      const db = new Database(dbPath, { readonly: true });

      try {
        // Check if ItemTable exists
        const tables = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='ItemTable'"
        ).all();

        if (tables.length === 0) {
          db.close();
          continue;
        }

        // Get interactive sessions - stored as an array in 'interactive.sessions' key
        const sessionRow = db.prepare(
          "SELECT value FROM ItemTable WHERE key = 'interactive.sessions'"
        ).get() as { value: string } | undefined;

        if (sessionRow) {
          try {
            const sessionsArray = JSON.parse(sessionRow.value);

            if (!Array.isArray(sessionsArray)) {
              db.close();
              continue;
            }

            for (let sessionIndex = 0; sessionIndex < sessionsArray.length; sessionIndex++) {
              const sessionData = sessionsArray[sessionIndex];
              // Generate a deterministic UUID based on workspace ID and session index
              const sessionId = generateDeterministicUUID(`${workspaceInfo.workspaceId}-session-${sessionIndex}`);

              if (!sessionData.requests || !Array.isArray(sessionData.requests)) {
                continue;
              }

              const messages: CursorMessage[] = [];

              for (const request of sessionData.requests) {
                // User message
                if (request.message?.text) {
                  messages.push({
                    id: `${sessionId}-user-${messages.length}`,
                    role: 'user',
                    content: request.message.text,
                    timestamp: normalizeTimestamp(request.timestamp || Date.now()),
                    sessionId
                  });
                }

                // Assistant message
                if (request.response && Array.isArray(request.response)) {
                  // Response is an array of response parts
                  const responseText = request.response
                    .map((part: any) => part.value || '')
                    .filter((text: string) => text.trim() !== '')
                    .join('\n');

                  if (responseText) {
                    messages.push({
                      id: `${sessionId}-assistant-${messages.length}`,
                      role: 'assistant',
                      content: responseText,
                      timestamp: normalizeTimestamp(request.timestamp || Date.now()),
                      sessionId
                    });
                  }
                }
              }

              if (messages.length === 0) {
                continue;
              }

              totalSessions++;

              // Extract project info from workspace folder
              let projectName: string | undefined;
              let projectPath: string | undefined;

              if (workspaceInfo.folder) {
                const parts = workspaceInfo.folder.split('/');
                const devIndex = parts.indexOf('Developer');

                if (devIndex >= 0 && devIndex + 1 < parts.length) {
                  projectName = parts[devIndex + 1];
                  projectPath = parts.slice(0, devIndex + 2).join('/');
                }
              }

              const lastMessage = messages[messages.length - 1];
              if (!lastMessage) {
                continue;
              }

              conversations.push({
                id: sessionId,
                timestamp: lastMessage.timestamp,
                messages,
                conversationType: 'copilot',
                metadata: {
                  workspaceId: workspaceInfo.workspaceId,
                  workspace: workspaceInfo.folder,
                  projectName,
                  projectPath,
                  source: 'cursor-copilot'
                }
              });
            }

          } catch (e) {
            // Skip malformed session data
          }
        }

      } finally {
        db.close();
      }

    } catch (error) {
      // Skip databases we can't read
      continue;
    }
  }

  console.log(`[Cursor] Found ${totalSessions} Copilot sessions`);

  return conversations;
}

/**
 * Extract project information from all conversations
 */
export function extractProjectsFromConversations(
  conversations: CursorConversation[]
): ProjectInfo[] {
  const projectsMap = new Map<string, {
    name: string;
    path: string;
    workspaceIds: Set<string>;
    composerCount: number;
    copilotSessionCount: number;
    lastActivity: Date;
  }>();

  for (const conv of conversations) {
    const projectPath = conv.metadata?.projectPath;
    const projectName = conv.metadata?.projectName;

    if (!projectPath || !projectName) {
      continue;
    }

    if (!projectsMap.has(projectPath)) {
      projectsMap.set(projectPath, {
        name: projectName,
        path: projectPath,
        workspaceIds: new Set(),
        composerCount: 0,
        copilotSessionCount: 0,
        lastActivity: new Date(conv.timestamp)
      });
    }

    const project = projectsMap.get(projectPath)!;

    // Add workspace ID if available
    if (conv.metadata?.workspaceId) {
      project.workspaceIds.add(conv.metadata.workspaceId);
    }

    // Update counts
    if (conv.conversationType === 'composer') {
      project.composerCount++;
    } else if (conv.conversationType === 'copilot') {
      project.copilotSessionCount++;
    }

    // Update last activity
    const convDate = new Date(conv.timestamp);
    if (convDate > project.lastActivity) {
      project.lastActivity = convDate;
    }
  }

  return Array.from(projectsMap.values()).map(project => ({
    name: project.name,
    path: project.path,
    workspaceIds: Array.from(project.workspaceIds),
    composerCount: project.composerCount,
    copilotSessionCount: project.copilotSessionCount,
    lastActivity: project.lastActivity.toISOString()
  }));
}

/**
 * Detect which storage format is being used in the database
 */
function detectStorageFormat(db: Database.Database): 'cursorDiskKV' | 'ItemTable' {
  try {
    // Check if cursorDiskKV has data
    const cursorDiskKVCount = db.prepare(
      "SELECT COUNT(*) as count FROM cursorDiskKV WHERE key LIKE 'composerData:%'"
    ).get() as { count: number };

    if (cursorDiskKVCount.count > 0) {
      console.log('[Cursor] Detected cursorDiskKV format (legacy)');
      return 'cursorDiskKV';
    }

    // Check if ItemTable has composer data
    const itemTableCount = db.prepare(
      "SELECT COUNT(*) as count FROM ItemTable WHERE key = 'composer.composerData'"
    ).get() as { count: number };

    if (itemTableCount.count > 0) {
      console.log('[Cursor] Detected ItemTable format (new)');
      return 'ItemTable';
    }

    // Default to cursorDiskKV for backwards compatibility
    console.log('[Cursor] No data found, defaulting to cursorDiskKV format');
    return 'cursorDiskKV';
  } catch (error) {
    console.log('[Cursor] Error detecting format, defaulting to cursorDiskKV:', error);
    return 'cursorDiskKV';
  }
}

/**
 * Read composers from new ItemTable format
 */
function readComposersFromItemTable(db: Database.Database): Map<string, ComposerData> {
  const composers = new Map<string, ComposerData>();

  try {
    const row = db.prepare(
      "SELECT value FROM ItemTable WHERE key = 'composer.composerData'"
    ).get() as { value: string } | undefined;

    if (!row) {
      console.log('[Cursor] No composer data found in ItemTable');
      return composers;
    }

    const composerData = JSON.parse(row.value) as { allComposers: any[] };

    if (!composerData.allComposers || !Array.isArray(composerData.allComposers)) {
      console.log('[Cursor] Invalid composer data structure in ItemTable');
      return composers;
    }

    // In the new format, we only have metadata, not the full conversation
    // We'll need to mark these as having no messages for now
    for (const composer of composerData.allComposers) {
      if (composer.composerId) {
        composers.set(composer.composerId, {
          composerId: composer.composerId,
          name: composer.name,
          createdAt: composer.createdAt,
          lastUpdatedAt: composer.lastUpdatedAt,
          workspace: composer.workspace,
          // Note: The new format doesn't store full conversation data here
          // Messages would need to be reconstructed from other sources
          conversation: []
        } as ComposerData);
      }
    }

    console.log(`[Cursor] Found ${composers.size} composers in ItemTable format`);
  } catch (error) {
    console.error('[Cursor] Error reading composers from ItemTable:', error);
  }

  return composers;
}

/**
 * Read composers from legacy cursorDiskKV format
 */
function readComposersFromCursorDiskKV(db: Database.Database): Map<string, ComposerData> {
  const composers = new Map<string, ComposerData>();

  const composerRows = db.prepare(
    'SELECT key, value FROM cursorDiskKV WHERE key LIKE ?'
  ).all('composerData:%') as Array<{ key: string; value: string }>;

  for (const row of composerRows) {
    try {
      const composerData = JSON.parse(row.value) as ComposerData;
      const composerId = row.key.replace('composerData:', '');
      composerData.composerId = composerId;
      composers.set(composerId, composerData);
    } catch (e) {
      // Skip malformed composer data
      continue;
    }
  }

  console.log(`[Cursor] Found ${composers.size} composers in cursorDiskKV format`);
  return composers;
}

/**
 * Read all Cursor chat histories from the SQLite database
 */
export function readCursorHistories(): CursorConversation[] {
  const conversations: CursorConversation[] = [];

  try {
    const dbPath = getCursorStatePath();

    if (!fs.existsSync(dbPath)) {
      console.log(`Cursor state database not found at: ${dbPath}`);
      return conversations;
    }

    console.log('[Cursor] Reading Cursor chat histories...');

    // Open database in read-only mode
    const db = new Database(dbPath, { readonly: true });

    try {
      // Detect which storage format is being used
      const format = detectStorageFormat(db);

      // Read composers based on the detected format
      let composers: Map<string, ComposerData>;
      if (format === 'ItemTable') {
        composers = readComposersFromItemTable(db);
      } else {
        composers = readComposersFromCursorDiskKV(db);
      }

      console.log(`[Cursor] Found ${composers.size} conversations`);

      // Get all bubble messages (only for legacy format)
      const bubblesByComposer = new Map<string, BubbleData[]>();

      if (format === 'cursorDiskKV') {
        const bubbleRows = db.prepare(
          'SELECT key, value FROM cursorDiskKV WHERE key LIKE ?'
        ).all('bubbleId:%') as Array<{ key: string; value: string }>;

        for (const row of bubbleRows) {
          try {
            const bubbleData = JSON.parse(row.value) as BubbleData;
            const keyParts = row.key.split(':');

            if (keyParts.length >= 3) {
              const composerId = keyParts[1];
              const bubbleId = keyParts[2];

              if (!composerId || !bubbleId) continue;

              bubbleData.bubbleId = bubbleId;

              if (!bubblesByComposer.has(composerId)) {
                bubblesByComposer.set(composerId, []);
              }
              bubblesByComposer.get(composerId)!.push(bubbleData);
            }
          } catch (e) {
            // Skip malformed bubble data
            continue;
          }
        }
      }
      // For ItemTable format, bubble data would need to be read from a different location
      // Currently, the new format appears to not store full conversation history in the same way

      // Build conversations
      let conversationsWithNoMessages = 0;
      let conversationsFromConversationArray = 0;
      let conversationsFromBubbleEntries = 0;
      let totalMessagesExtracted = 0;

      for (const [composerId, composerData] of composers) {
        let bubbles: BubbleData[] = [];

        // First, check if messages are stored in the 'conversation' array
        if (composerData.conversation && Array.isArray(composerData.conversation)) {
          bubbles = composerData.conversation;
          if (bubbles.length > 0) {
            conversationsFromConversationArray++;
          }
        }

        // If no conversation array, try to get bubbles from separate entries
        if (bubbles.length === 0) {
          const separateBubbles = bubblesByComposer.get(composerId) || [];
          if (separateBubbles.length > 0) {
            bubbles = separateBubbles;
            conversationsFromBubbleEntries++;
          }
        }

        if (bubbles.length === 0) {
          conversationsWithNoMessages++;
          continue;
        }

        const messages: CursorMessage[] = [];

        // Use composer-level timestamp since bubble timestamps are often incorrect
        // The createdAt is when the conversation started
        const conversationStartTime = normalizeTimestamp(composerData.createdAt);

        for (const bubble of bubbles) {
          // Determine role based on bubble type
          // type 1 = user message, type 2 = assistant message
          const role = bubble.type === 1 ? 'user' : 'assistant';

          // Extract text content
          let content = bubble.text || '';
          if (!content && bubble.richText) {
            content = parseRichText(bubble.richText);
          }

          // Skip empty messages
          if (!content || content.trim() === '') {
            continue;
          }

          // Use composer's createdAt as the base timestamp for all messages
          // since bubble-level timestamps are often incorrect/placeholder values
          const timestamp = conversationStartTime;

          messages.push({
            id: bubble.bubbleId,
            role,
            content,
            timestamp,
            composerId,
            bubbleId: bubble.bubbleId,
            modelName: bubble.modelInfo?.modelName
          });
        }

        if (messages.length === 0) {
          conversationsWithNoMessages++;
          continue;
        }

        totalMessagesExtracted += messages.length;

        // Extract project information
        const projectInfo = extractProjectInfo(composerData);

        // Use lastUpdatedAt for the conversation timestamp (when the last message was added)
        // Fall back to createdAt if lastUpdatedAt is not available
        const conversationTimestamp = normalizeTimestamp(
          composerData.lastUpdatedAt || composerData.createdAt
        );

        conversations.push({
          id: composerId,
          timestamp: conversationTimestamp,
          messages,
          conversationType: 'composer',
          metadata: {
            workspace: composerData.workspace,
            projectName: projectInfo.projectName,
            projectPath: projectInfo.projectPath,
            conversationName: projectInfo.conversationName,
            source: 'cursor-composer'
          }
        });
      }

      console.log(`[Cursor] Parsed ${conversations.length} conversations with messages`);
      console.log(`[Cursor] Total messages extracted: ${totalMessagesExtracted}`);
      console.log(`[Cursor] Debug stats:`);
      console.log(`  - Storage format: ${format}`);
      console.log(`  - Conversations from 'conversation' array: ${conversationsFromConversationArray}`);
      console.log(`  - Conversations from separate bubble entries: ${conversationsFromBubbleEntries}`);
      console.log(`  - Conversations with no valid messages: ${conversationsWithNoMessages}`);

      if (format === 'ItemTable' && conversationsWithNoMessages > 0) {
        console.log(`[Cursor] WARNING: New ItemTable format detected with ${conversationsWithNoMessages} conversations without messages`);
        console.log(`[Cursor] The new format stores conversation metadata separately from messages`);
        console.log(`[Cursor] Full conversation history may not be available in this format yet`);
      }

    } finally {
      db.close();
    }

  } catch (error) {
    console.error('[Cursor] Error reading Cursor histories:', error);
  }

  // Read Copilot sessions from workspace databases
  try {
    const copilotConversations = readCopilotSessions();
    conversations.push(...copilotConversations);
  } catch (error) {
    console.error('[Cursor] Error reading Copilot sessions:', error);
  }

  console.log(`[Cursor] Total conversations: ${conversations.length}`);
  console.log(`  - Composer: ${conversations.filter(c => c.conversationType === 'composer').length}`);
  console.log(`  - Copilot: ${conversations.filter(c => c.conversationType === 'copilot').length}`);

  return conversations;
}

/**
 * Convert Cursor conversations to the standard ChatHistory format
 */
export function convertCursorToStandardFormat(
  conversations: CursorConversation[]
): Array<{
  id: string;
  timestamp: string;
  messages: Array<{
    display: string;
    pastedContents: Record<string, any>;
    role?: 'user' | 'assistant';
    timestamp?: string;
  }>;
  agent_type: 'cursor';
  metadata?: Record<string, any>;
}> {
  return conversations.map(conv => ({
    id: conv.id, // Use the original UUID without prefix
    timestamp: conv.timestamp,
    agent_type: 'cursor' as const,
    messages: conv.messages.map(msg => ({
      display: msg.content,
      pastedContents: {},
      role: msg.role,
      timestamp: msg.timestamp
    })),
    metadata: {
      ...conv.metadata,
      source: 'cursor'
    }
  }));
}
