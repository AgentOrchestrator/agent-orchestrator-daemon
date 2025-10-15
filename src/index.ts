import { readChatHistories } from './claude-code-reader.js';
import { readCursorHistories, convertCursorToStandardFormat, extractProjectsFromConversations } from './cursor-reader.js';
import { uploadAllHistories, syncProjects } from './uploader.js';
import { runPeriodicSummaryUpdate, runPeriodicKeywordUpdate } from './summarizer.js';
import { AuthManager } from './auth-manager.js';
import * as fs from 'fs';
import * as path from 'path';

let authManager: AuthManager;

async function processHistories() {
  console.log('Processing chat histories...');

  // Ensure authenticated
  const isAuthenticated = await authManager.ensureAuthenticated();

  if (!isAuthenticated) {
    console.log('⚠️  Authentication failed. Skipping upload.');
    console.log('💡 Tip: Run the daemon again and authenticate in your browser.');
    return;
  }

  const accountId = authManager.getUserId();
  console.log(`✓ Authenticated as user: ${accountId}`);

  // Read Claude Code histories
  const claudeHistories = readChatHistories();
  console.log(`Found ${claudeHistories.length} Claude Code chat histories.`);

  // Read Cursor histories
  const cursorConversations = readCursorHistories();
  const cursorHistories = convertCursorToStandardFormat(cursorConversations);
  console.log(`Found ${cursorHistories.length} Cursor chat histories.`);

  // Extract and sync projects from Cursor conversations
  const projects = extractProjectsFromConversations(cursorConversations);
  if (projects.length > 0) {
    await syncProjects(projects, accountId);
  }

  // Combine all histories
  const allHistories = [...claudeHistories, ...cursorHistories];

  if (allHistories.length === 0) {
    console.log('No chat histories found.');
    return;
  }

  console.log(`Total: ${allHistories.length} chat histories.`);
  await uploadAllHistories(allHistories, accountId);
  console.log('Upload complete.');
}

async function main() {
  console.log('Agent Orchestrator Daemon Starting...');
  console.log('Running in background watch mode...');

  // Initialize auth manager
  authManager = new AuthManager();

  // Get the path to CLAUDE.md (assuming it's in the parent directory)
  const claudeFilePath = path.join(process.cwd(), '..', 'CLAUDE.md');

  if (!fs.existsSync(claudeFilePath)) {
    console.error(`CLAUDE.md not found at: ${claudeFilePath}`);
    console.log('Creating CLAUDE.md file...');
    fs.writeFileSync(claudeFilePath, '# Claude Code Chat History\n\n');
  }

  console.log(`Watching file: ${claudeFilePath}`);

  // Process immediately on startup
  await processHistories();

  // Watch for file changes
  fs.watch(claudeFilePath, async (eventType, filename) => {
    if (eventType === 'change') {
      console.log(`\nDetected change in ${filename}`);
      await processHistories();
    }
  });

  // Start periodic AI summary and keyword updaters (every 5 minutes)
  // Note: These will automatically use fallback mode if OPENAI_API_KEY is not set
  console.log('Starting AI summary and keyword updaters (run every 5 minutes)...');

  // Run immediately on startup
  await runPeriodicSummaryUpdate();
  await runPeriodicKeywordUpdate();

  // Then run every 5 minutes
  setInterval(async () => {
    await runPeriodicSummaryUpdate();
    await runPeriodicKeywordUpdate();
  }, 5 * 60 * 1000); // 5 minutes

  console.log('Daemon is running. Press Ctrl+C to stop.');

  // Keep the process alive
  process.on('SIGINT', () => {
    console.log('\nShutting down daemon...');
    process.exit(0);
  });
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
