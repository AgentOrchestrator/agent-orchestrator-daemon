import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create Supabase client with service role key (safe in backend daemon)
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface Message {
  display: string;
  pastedContents?: Record<string, any>;
}

interface ChatHistory {
  id: string;
  messages: Message[];
  ai_summary?: string | null;
  ai_summary_generated_at?: string | null;
  ai_summary_message_count?: number | null;
  updated_at: string;
}

async function generateSessionSummary(messages: Message[]): Promise<string> {
  if (messages.length === 0) {
    return 'No messages in this session yet.';
  }

  // Construct conversation context for the AI
  const conversationText = messages
    .map((msg, idx) => `Message ${idx + 1}: ${msg.display}`)
    .join('\n\n');

  const prompt = `Analyze this AI coding assistant session and provide a concise summary (2-3 sentences) covering:
1. What is the user attempting to accomplish?
2. What problems or errors are they encountering?
3. Are they making progress or stuck/circling around the same issue?

Session transcript:
${conversationText}

Provide a brief, insightful summary:`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at analyzing software development conversations and identifying user intent, problems, and progress patterns.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    return response.choices[0]?.message?.content || 'Unable to generate summary.';
  } catch (error) {
    console.error('Error generating summary with GPT-4o-mini:', error);
    throw error;
  }
}

/**
 * Fetches sessions that need summary updates.
 * Returns sessions that:
 * 1. Were updated within the specified time window
 * 2. Either have no summary OR their message count has changed
 */
export async function getSessionsNeedingSummaryUpdate(
  withinHours: number = 1
): Promise<ChatHistory[]> {
  const cutoffTime = new Date();
  cutoffTime.setHours(cutoffTime.getHours() - withinHours);

  // Fetch recent sessions
  const { data, error } = await supabase
    .from('chat_histories')
    .select('*')
    .gte('updated_at', cutoffTime.toISOString())
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching sessions for summary update:', error);
    return [];
  }

  // Filter sessions where message count has changed or no summary exists
  const needsUpdate = (data || []).filter((session: ChatHistory) => {
    const currentMessageCount = Array.isArray(session.messages)
      ? session.messages.length
      : 0;

    // Skip sessions with no messages
    if (currentMessageCount === 0) {
      return false;
    }

    // Needs update if no summary exists or message count changed
    return (
      !session.ai_summary ||
      !session.ai_summary_generated_at ||
      session.ai_summary_message_count !== currentMessageCount
    );
  });

  return needsUpdate;
}

/**
 * Generate and save summary for a single session
 */
export async function updateSessionSummary(
  sessionId: string
): Promise<{ success: boolean; summary?: string; error?: string }> {
  try {
    // Fetch the session
    const { data: session, error: fetchError } = await supabase
      .from('chat_histories')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (fetchError || !session) {
      return { success: false, error: 'Session not found' };
    }

    const messages = Array.isArray(session.messages) ? session.messages : [];
    const messageCount = messages.length;

    if (messageCount === 0) {
      return { success: false, error: 'No messages to summarize' };
    }

    // Generate summary
    const summary = await generateSessionSummary(messages);

    // Update database
    const { error: updateError } = await supabase
      .from('chat_histories')
      .update({
        ai_summary: summary,
        ai_summary_generated_at: new Date().toISOString(),
        ai_summary_message_count: messageCount,
      })
      .eq('id', sessionId);

    if (updateError) {
      console.error('Error updating summary in database:', updateError);
      return { success: false, error: 'Failed to save summary' };
    }

    return { success: true, summary };
  } catch (error) {
    console.error(`Error updating summary for session ${sessionId}:`, error);
    return { success: false, error: String(error) };
  }
}

/**
 * Batch update summaries for multiple sessions
 */
export async function batchUpdateSessionSummaries(
  sessionIds: string[]
): Promise<{
  updated: number;
  cached: number;
  errors: number;
  results: any[];
}> {
  const results = await Promise.allSettled(
    sessionIds.map(async (sessionId) => {
      const result = await updateSessionSummary(sessionId);
      return { sessionId, ...result };
    })
  );

  const processedResults = results.map((result) =>
    result.status === 'fulfilled' ? result.value : { status: 'error', error: 'Promise rejected' }
  );

  return {
    updated: processedResults.filter((r) => r.success).length,
    cached: 0, // Not using cache in daemon version
    errors: processedResults.filter((r) => !r.success).length,
    results: processedResults,
  };
}

/**
 * Main function to run periodic summary updates
 * Should be called every 5 minutes
 */
export async function runPeriodicSummaryUpdate(): Promise<void> {
  console.log('[Summary Updater] Starting periodic summary update...');

  try {
    // Get sessions from the last hour that need updates
    const sessions = await getSessionsNeedingSummaryUpdate(1);

    if (sessions.length === 0) {
      console.log('[Summary Updater] No sessions need updating');
      return;
    }

    console.log(`[Summary Updater] Found ${sessions.length} sessions needing summary updates`);

    // Batch update all sessions
    const sessionIds = sessions.map((s) => s.id);
    const result = await batchUpdateSessionSummaries(sessionIds);

    console.log('[Summary Updater] Update complete:', {
      total: sessionIds.length,
      updated: result.updated,
      errors: result.errors,
    });
  } catch (error) {
    console.error('[Summary Updater] Error during periodic update:', error);
  }
}
