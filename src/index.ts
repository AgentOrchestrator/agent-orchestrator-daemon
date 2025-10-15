import { readChatHistories, extractProjectsFromClaudeCodeHistories } from './claude-code-reader.js';
import { readCursorHistories, convertCursorToStandardFormat, extractProjectsFromConversations } from './cursor-reader.js';
import { uploadAllHistories, syncProjects } from './uploader.js';
import { runPeriodicSummaryUpdate, runPeriodicKeywordUpdate } from './summarizer.js';
import { AuthManager } from './auth-manager.js';
import { mergeProjects } from './project-aggregator.js';
import { runPeriodicActivitySync } from './activity-syncer.js';

let authManager: AuthManager;

async function processHistories() {
  console.log('Processing chat histories...');

  // Check if already authenticated (silently checks and refreshes token if needed)
  const alreadyAuthenticated = await authManager.isAuthenticated();

  if (!alreadyAuthenticated) {
    // Only prompt for authentication if not already authenticated
    const isAuthenticated = await authManager.waitForAuth();

    if (!isAuthenticated) {
      console.log('⚠️  Authentication failed. Skipping upload.');
      console.log('💡 Tip: Run the daemon again and authenticate in your browser.');
      return;
    }
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

  // Extract and merge projects from both Claude Code and Cursor
  const claudeCodeProjects = extractProjectsFromClaudeCodeHistories(claudeHistories);
  const cursorProjects = extractProjectsFromConversations(cursorConversations);
  const allProjects = mergeProjects(cursorProjects, claudeCodeProjects);

  if (allProjects.length > 0) {
    await syncProjects(allProjects, accountId);
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

  // Check authentication status on startup
  const alreadyAuthenticated = await authManager.isAuthenticated();
  if (alreadyAuthenticated) {
    console.log('✓ Using existing authentication session');
  }

  // Set up periodic token refresh (every 30 minutes)
  // This ensures the session stays alive even during long-running daemon processes
  setInterval(async () => {
    const stillAuthenticated = await authManager.isAuthenticated();
    if (stillAuthenticated) {
      console.log('[Auth] Token refreshed successfully');
    } else {
      console.log('[Auth] Token refresh failed - authentication required');
    }
  }, 30 * 60 * 1000); // 30 minutes

  // Process immediately on startup
  await processHistories();

  // Set up periodic session data sync
  // Get sync interval from environment variable (default: 5 minutes)
  const syncIntervalMs = parseInt(process.env.PERIODIC_SYNC_INTERVAL_MS || '300000', 10);
  console.log(`Setting up periodic session sync (every ${syncIntervalMs}ms / ${syncIntervalMs / 1000}s)...`);

  setInterval(async () => {
    console.log('\n[Periodic Sync] Checking for new session data...');
    await processHistories();
  }, syncIntervalMs);

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

  // Start periodic editor activity monitoring (every 2 minutes)
  // This tracks which editors are actively being used
  console.log('Starting editor activity monitor (run every 2 minutes)...');

  // Run immediately on startup
  const accountId = authManager.getUserId();
  if (accountId) {
    await runPeriodicActivitySync(accountId);
  }

  // Then run every 2 minutes
  setInterval(async () => {
    const userId = authManager.getUserId();
    if (userId) {
      await runPeriodicActivitySync(userId);
    }
  }, 2 * 60 * 1000); // 2 minutes

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
