import { supabase } from './supabase.js';
import type { ChatHistory } from './claude-code-reader.js';

export async function uploadChatHistory(
  history: ChatHistory,
  accountId: string | null
): Promise<boolean> {
  try {
    // Upsert based on project ID (which is deterministic based on project path)
    // This allows us to update existing records when re-running the uploader
    const { error } = await supabase
      .from('chat_histories')
      .upsert(
        {
          id: history.id,
          timestamp: history.timestamp,
          messages: history.messages,
          metadata: history.metadata,
          agent_type: history.agent_type,
          account_id: accountId,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: 'id', // Use id as the unique constraint for upsert
          ignoreDuplicates: false // Always update existing records
        }
      );

    if (error) {
      console.error(`Error uploading chat history ${history.id}:`, error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return false;
    }

    const projectPath = history.metadata?.projectPath || 'unknown';
    const messageCount = history.messages.length;
    const authStatus = accountId ? '🔐' : '🔓';
    console.log(`✓ ${authStatus} Uploaded: ${projectPath} (${messageCount} messages)`);
    return true;
  } catch (error) {
    console.error(`Failed to upload chat history ${history.id}:`, error);
    return false;
  }
}

export async function uploadAllHistories(
  histories: ChatHistory[],
  accountId: string | null
): Promise<void> {
  console.log(`Uploading ${histories.length} chat histories...`);

  let successCount = 0;
  let failureCount = 0;

  for (const history of histories) {
    const success = await uploadChatHistory(history, accountId);
    if (success) {
      successCount++;
    } else {
      failureCount++;
    }
  }

  console.log(`Upload complete: ${successCount} succeeded, ${failureCount} failed`);
}
