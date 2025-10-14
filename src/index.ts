import { readChatHistories } from './reader.js';
import { uploadAllHistories } from './uploader.js';
import * as fs from 'fs';
import * as path from 'path';

async function processHistories() {
  console.log('Processing chat histories...');

  const histories = readChatHistories();

  if (histories.length === 0) {
    console.log('No chat histories found.');
    return;
  }

  console.log(`Found ${histories.length} chat histories.`);
  await uploadAllHistories(histories);
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
