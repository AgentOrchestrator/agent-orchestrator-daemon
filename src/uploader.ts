import { supabase } from './supabase.js';
import type { ChatHistory } from './claude-code-reader.js';
import type { ProjectInfo } from './cursor-reader.js';

export async function uploadChatHistory(
  history: ChatHistory,
  accountId: string | null
): Promise<boolean> {
  try {
    // Calculate the latest message timestamp from the messages array
    let latestMessageTimestamp: string | null = null;
    if (history.messages && history.messages.length > 0) {
      // Find the most recent timestamp among all messages
      const timestamps = history.messages
        .map(msg => msg.timestamp)
        .filter((ts): ts is string => !!ts)
        .sort()
        .reverse();

      latestMessageTimestamp = timestamps[0] || null;
    }

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
          latest_message_timestamp: latestMessageTimestamp,
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

/**
 * Upsert a project to the database
 */
export async function upsertProject(
  project: ProjectInfo,
  accountId: string | null
): Promise<string | null> {
  if (!accountId) {
    console.log(`Skipping project ${project.name} (not authenticated)`);
    return null;
  }

  try {
    // Build workspace metadata from project info
    const workspaceMetadata = {
      workspaceIds: project.workspaceIds,
      composerCount: project.composerCount,
      copilotSessionCount: project.copilotSessionCount,
      lastActivity: project.lastActivity
    };

    const { data, error } = await supabase
      .from('projects')
      .upsert(
        {
          user_id: accountId,
          name: project.name,
          project_path: project.path,
          workspace_metadata: workspaceMetadata,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: 'user_id,project_path',
          ignoreDuplicates: false
        }
      )
      .select('id')
      .single();

    if (error) {
      console.error(`Error upserting project ${project.name}:`, error);
      return null;
    }

    console.log(`✓ Project: ${project.name} (Composer: ${project.composerCount}, Copilot: ${project.copilotSessionCount})`);
    return data.id;
  } catch (error) {
    console.error(`Failed to upsert project ${project.name}:`, error);
    return null;
  }
}

/**
 * Sync all projects from conversations
 */
export async function syncProjects(
  projects: ProjectInfo[],
  accountId: string | null
): Promise<Map<string, string>> {
  console.log(`\nSyncing ${projects.length} projects...`);

  const projectIdMap = new Map<string, string>(); // Map project path to project ID

  for (const project of projects) {
    const projectId = await upsertProject(project, accountId);
    if (projectId) {
      projectIdMap.set(project.path, projectId);
    }
  }

  console.log(`Project sync complete: ${projectIdMap.size}/${projects.length} synced\n`);
  return projectIdMap;
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
