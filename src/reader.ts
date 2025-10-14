import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';

export interface ChatHistory {
  id: string;
  timestamp: string;
  messages: any[];
  metadata?: any;
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

export function readChatHistories(): ChatHistory[] {
  const histories: ChatHistory[] = [];

  try {
    // Check if .claude.json exists in home directory
    const homeDir = os.homedir();
    const claudeJsonPath = path.join(homeDir, '.claude.json');

    if (fs.existsSync(claudeJsonPath)) {
      const content = fs.readFileSync(claudeJsonPath, 'utf-8');
      const data = JSON.parse(content);

      // Parse Claude Code's .claude.json structure with projects
      if (data.projects && typeof data.projects === 'object') {
        for (const [projectPath, projectData] of Object.entries(data.projects)) {
          const project = projectData as any;

          if (project.history && Array.isArray(project.history)) {
            histories.push({
              id: uuidv4(),
              timestamp: new Date().toISOString(),
              messages: project.history,
              metadata: {
                projectPath,
                allowedTools: project.allowedTools || []
              }
            });
          }
        }
      }
    }

    // If CLAUDE_CODE_HOME is set, look for chat files in that directory
    if (process.env.CLAUDE_CODE_HOME) {
      const chatsDir = path.join(process.env.CLAUDE_CODE_HOME, 'chats');

      if (fs.existsSync(chatsDir) && fs.statSync(chatsDir).isDirectory()) {
        const files = fs.readdirSync(chatsDir);

        for (const file of files) {
          if (file.endsWith('.json')) {
            const filePath = path.join(chatsDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            const chatData = JSON.parse(content);

            histories.push({
              id: uuidv4(),
              timestamp: chatData.timestamp || new Date().toISOString(),
              messages: chatData.messages || [],
              metadata: chatData.metadata || {}
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Error reading chat histories:', error);
  }

  return histories;
}
