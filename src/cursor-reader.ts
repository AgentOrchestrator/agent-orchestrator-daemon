import Database from 'better-sqlite3';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export interface CursorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  composerId: string;
  bubbleId: string;
  modelName?: string | undefined;
}

export interface CursorConversation {
  id: string; // composerId
  timestamp: string;
  messages: CursorMessage[];
  metadata?: {
    workspace?: string | undefined;
    [key: string]: any;
  } | undefined;
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
  createdAt?: string;
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
      // Get all composer IDs and their data
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

      console.log(`[Cursor] Found ${composers.size} conversations`);

      // Get all bubble messages
      const bubbleRows = db.prepare(
        'SELECT key, value FROM cursorDiskKV WHERE key LIKE ?'
      ).all('bubbleId:%') as Array<{ key: string; value: string }>;

      // Organize bubbles by composer ID
      const bubblesByComposer = new Map<string, BubbleData[]>();

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

          // Use createdAt if available, otherwise use composer's createdAt
          const rawTimestamp = bubble.createdAt || composerData.createdAt;
          const timestamp = normalizeTimestamp(rawTimestamp);

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

        conversations.push({
          id: composerId,
          timestamp: normalizeTimestamp(composerData.createdAt),
          messages,
          metadata: {
            workspace: composerData.workspace,
            projectName: projectInfo.projectName,
            projectPath: projectInfo.projectPath,
            conversationName: projectInfo.conversationName
          }
        });
      }

      console.log(`[Cursor] Parsed ${conversations.length} conversations with messages`);
      console.log(`[Cursor] Total messages extracted: ${totalMessagesExtracted}`);
      console.log(`[Cursor] Debug stats:`);
      console.log(`  - Conversations from 'conversation' array: ${conversationsFromConversationArray}`);
      console.log(`  - Conversations from separate bubble entries: ${conversationsFromBubbleEntries}`);
      console.log(`  - Conversations with no valid messages: ${conversationsWithNoMessages}`);

    } finally {
      db.close();
    }

  } catch (error) {
    console.error('[Cursor] Error reading Cursor histories:', error);
  }

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
