import { supabase } from './supabase.js';
import type { ChatHistory } from './reader.js';

export async function uploadChatHistory(history: ChatHistory): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('chat_histories')
      .upsert({
        id: history.id,
        timestamp: history.timestamp,
        messages: history.messages,
        metadata: history.metadata,
        created_at: new Date().toISOString()
      });

    if (error) {
      console.error(`Error uploading chat history ${history.id}:`, error);
      return false;
    }

    console.log(`Successfully uploaded chat history: ${history.id}`);
    return true;
  } catch (error) {
    console.error(`Failed to upload chat history ${history.id}:`, error);
    return false;
  }
}

export async function uploadAllHistories(histories: ChatHistory[]): Promise<void> {
  console.log(`Uploading ${histories.length} chat histories...`);

  let successCount = 0;
  let failureCount = 0;

  for (const history of histories) {
    const success = await uploadChatHistory(history);
    if (success) {
      successCount++;
    } else {
      failureCount++;
    }
  }

  console.log(`Upload complete: ${successCount} succeeded, ${failureCount} failed`);
}
