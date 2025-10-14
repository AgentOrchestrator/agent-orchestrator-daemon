import { readChatHistories } from './reader.js';
import { uploadAllHistories } from './uploader.js';

async function main() {
  console.log('Agent Orchestrator Daemon Starting...');
  console.log('Reading Claude Code chat histories...');

  const histories = readChatHistories();

  if (histories.length === 0) {
    console.log('No chat histories found.');
    console.log('Make sure CLAUDE_CODE_HOME is set or ~/.claude.json exists.');
    return;
  }

  console.log(`Found ${histories.length} chat histories.`);

  await uploadAllHistories(histories);

  console.log('Agent Orchestrator Daemon Complete.');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
