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
  createdAt?: string;
  workspace?: string;
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
      let emptyBubbles = 0;
      let bubblesWithNoContent = 0;
      let conversationsWithNoMessages = 0;
      let totalBubblesSkipped = 0;
      let sampleEmptyBubbleLogged = false;

      for (const [composerId, composerData] of composers) {
        const bubbles = bubblesByComposer.get(composerId) || [];

        if (bubbles.length === 0) {
          emptyBubbles++;
          continue;
        }

        // Sort bubbles by creation time
        bubbles.sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        const messages: CursorMessage[] = [];
        let skippedInThisConversation = 0;

        for (const bubble of bubbles) {
          // Determine role based on bubble type
          // type 1 = user message, type 2 = assistant message
          const role = bubble.type === 1 ? 'user' : 'assistant';

          // Extract text content
          let content = bubble.text || '';
          if (!content && bubble.richText) {
            content = parseRichText(bubble.richText);
          }

          if (!content) {
            // Log first empty bubble as a sample
            if (!sampleEmptyBubbleLogged) {
              console.log(`[Cursor] Sample empty bubble:`, {
                bubbleId: bubble.bubbleId,
                type: bubble.type,
                hasText: !!bubble.text,
                hasRichText: !!bubble.richText,
                keys: Object.keys(bubble).slice(0, 10)
              });
              sampleEmptyBubbleLogged = true;
            }
            skippedInThisConversation++;
            totalBubblesSkipped++;
            continue;
          }

          messages.push({
            id: bubble.bubbleId,
            role,
            content,
            timestamp: bubble.createdAt,
            composerId,
            bubbleId: bubble.bubbleId,
            modelName: bubble.modelInfo?.modelName
          });
        }

        if (skippedInThisConversation > 0) {
          bubblesWithNoContent++;
        }

        if (messages.length === 0) {
          conversationsWithNoMessages++;
          continue;
        }

        conversations.push({
          id: composerId,
          timestamp: bubbles[0]?.createdAt || new Date().toISOString(),
          messages,
          metadata: composerData.workspace ? {
            workspace: composerData.workspace
          } : undefined
        });
      }

      console.log(`[Cursor] Parsed ${conversations.length} conversations with messages`);
      console.log(`[Cursor] Debug stats:`);
      console.log(`  - Composers without bubbles: ${emptyBubbles}`);
      console.log(`  - Conversations with skipped bubbles: ${bubblesWithNoContent}`);
      console.log(`  - Total bubbles skipped (no content): ${totalBubblesSkipped}`);
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
