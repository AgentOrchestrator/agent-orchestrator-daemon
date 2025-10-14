import { readChatHistories } from './reader.js';
import { readCursorHistories, convertCursorToStandardFormat } from './cursor-reader.js';
import { uploadAllHistories } from './uploader.js';
import { runPeriodicSummaryUpdate, runPeriodicKeywordUpdate } from './summarizer.js';
import * as fs from 'fs';
import * as path from 'path';

async function processHistories() {
  console.log('Processing chat histories...');

  // Read Claude Code histories
  const claudeHistories = readChatHistories();
  console.log(`Found ${claudeHistories.length} Claude Code chat histories.`);

  // Read Cursor histories
  const cursorConversations = readCursorHistories();
  const cursorHistories = convertCursorToStandardFormat(cursorConversations);
  console.log(`Found ${cursorHistories.length} Cursor chat histories.`);

  // Combine all histories
  const allHistories = [...claudeHistories, ...cursorHistories];

  if (allHistories.length === 0) {
    console.log('No chat histories found.');
    return;
  }

  console.log(`Total: ${allHistories.length} chat histories.`);
  await uploadAllHistories(allHistories);
  console.log('Upload complete.');
}

async function main() {
  console.log('Agent Orchestrator Daemon Starting...');
  console.log('Running in background watch mode...');

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
  console.log('Starting AI summary and keyword updaters (run every 5 minutes)...');

  // Run immediately on startup
  if (process.env.OPENAI_API_KEY) {
    await runPeriodicSummaryUpdate();
    await runPeriodicKeywordUpdate();
  } else {
    console.log('[AI Updater] Skipping: OPENAI_API_KEY not set');
  }

  // Then run every 5 minutes
  setInterval(async () => {
    if (process.env.OPENAI_API_KEY) {
      await runPeriodicSummaryUpdate();
      await runPeriodicKeywordUpdate();
    }
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
