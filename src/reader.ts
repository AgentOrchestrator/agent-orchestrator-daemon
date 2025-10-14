import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ChatMessage {
  display: string;
  pastedContents: Record<string, any>;
}

export interface ChatHistory {
  id: string;
  timestamp: string;
  messages: ChatMessage[];
  metadata?: {
    projectPath?: string;
    allowedTools?: string[];
    [key: string]: any;
  };
}

export function getClaudeConfigPath(): string {
  const claudeHome = process.env.CLAUDE_CODE_HOME;

  if (claudeHome) {
    return path.join(claudeHome, 'chats');
  }

  const homeDir = os.homedir();
  const claudeJsonPath = path.join(homeDir, '.claude.json');

  if (fs.existsSync(claudeJsonPath)) {
    return path.dirname(claudeJsonPath);
  }

  // Default to ~/.claude.json location
  return homeDir;
}

interface JsonlLine {
  type?: string;
  message?: {
    role: string;
    content: any;
  };
  display?: string;
  pastedContents?: Record<string, any>;
  timestamp?: string | number;
  project?: string;
  sessionId?: string;
  cwd?: string;
  summary?: string;
}

/**
 * Parse a single .jsonl session file
 */
function parseSessionFile(filePath: string, projectPath: string): ChatHistory | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    if (lines.length === 0) return null;

    const messages: ChatMessage[] = [];
    let sessionId = path.basename(filePath, '.jsonl');
    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    let summary: string | null = null;

    for (const line of lines) {
      try {
        const data: JsonlLine = JSON.parse(line);

        // Extract summary from first line if available
        if (data.type === 'summary' && data.summary) {
          summary = data.summary;
        }

        // Extract session ID
        if (data.sessionId) {
          sessionId = data.sessionId;
        }

        // Extract user messages
        if (data.type === 'user' && data.message?.content) {
          const timestamp = data.timestamp?.toString() || '';
          if (!firstTimestamp) firstTimestamp = timestamp;
          lastTimestamp = timestamp;

          // Parse content array
          const contentParts = Array.isArray(data.message.content)
            ? data.message.content
            : [data.message.content];

          for (const part of contentParts) {
            if (typeof part === 'string') {
              messages.push({
                display: part,
                pastedContents: {}
              });
            } else if (part?.type === 'text' && part.text) {
              messages.push({
                display: part.text,
                pastedContents: {}
              });
            }
          }
        }

        // Extract assistant messages
        if (data.type === 'assistant' && data.message?.content) {
          const timestamp = data.timestamp?.toString() || '';
          if (!firstTimestamp) firstTimestamp = timestamp;
          lastTimestamp = timestamp;

          const contentParts = Array.isArray(data.message.content)
            ? data.message.content
            : [data.message.content];

          for (const part of contentParts) {
            if (typeof part === 'string') {
              messages.push({
                display: part,
                pastedContents: {}
              });
            } else if (part?.type === 'text' && part.text) {
              messages.push({
                display: part.text,
                pastedContents: {}
              });
            }
          }
        }
      } catch (lineError) {
        // Skip malformed lines
        continue;
      }
    }

    return {
      id: sessionId,
      timestamp: lastTimestamp || firstTimestamp || new Date().toISOString(),
      messages,
      metadata: {
        projectPath,
        summary: summary || undefined
      }
    };
  } catch (error) {
    console.error(`Error parsing session file ${filePath}:`, error);
    return null;
  }
}

/**
 * Read all chat histories from ~/.claude directory
 */
export function readChatHistories(): ChatHistory[] {
  const histories: ChatHistory[] = [];

  try {
    const homeDir = os.homedir();
    const claudeDir = path.join(homeDir, '.claude');
    const projectsDir = path.join(claudeDir, 'projects');

    if (!fs.existsSync(projectsDir)) {
      console.log('No ~/.claude/projects directory found');
      return histories;
    }

    // Read all project directories
    const projectDirs = fs.readdirSync(projectsDir);

    for (const projectDir of projectDirs) {
      const projectDirPath = path.join(projectsDir, projectDir);

      if (!fs.statSync(projectDirPath).isDirectory()) continue;

      // Convert directory name back to project path
      // e.g., "-Users-duonghaidang-Developer-agent-orchestrator" -> "/Users/duonghaidang/Developer/agent-orchestrator"
      const projectPath = projectDir.replace(/^-/, '/').replace(/-/g, '/');

      // Read all session files in this project
      const sessionFiles = fs.readdirSync(projectDirPath).filter(f => f.endsWith('.jsonl'));

      for (const sessionFile of sessionFiles) {
        const sessionFilePath = path.join(projectDirPath, sessionFile);
        const history = parseSessionFile(sessionFilePath, projectPath);

        if (history && history.messages.length > 0) {
          histories.push(history);
        }
      }
    }

    console.log(`Found ${histories.length} chat histories with messages.`);
  } catch (error) {
    console.error('Error reading chat histories:', error);
  }

  return histories;
}
