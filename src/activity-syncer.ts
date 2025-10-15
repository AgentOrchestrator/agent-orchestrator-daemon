import { createClient } from '@supabase/supabase-js';
import { detectAllEditorActivity, type EditorActivity } from './activity-detector.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Sync editor activity to active_sessions table
 */
export async function syncEditorActivity(userId: string): Promise<void> {
  console.log('[Activity] Detecting editor activity...');

  const activities = detectAllEditorActivity();

  if (activities.length === 0) {
    console.log('[Activity] No editor activity detected');
    return;
  }

  console.log(`[Activity] Found ${activities.length} editor(s) with activity:`);
  activities.forEach(activity => {
    const timeAgo = Math.floor((Date.now() - activity.lastActivityAt.getTime()) / 1000 / 60);
    const status = activity.isActive ? '🟢 ACTIVE' : '⚫ INACTIVE';
    console.log(`  ${status} ${activity.editorType}: ${timeAgo}m ago ${activity.workspacePath ? `(${activity.workspacePath})` : ''}`);
  });

  // Sync each activity to database
  for (const activity of activities) {
    try {
      // Try to find matching project
      let projectId: string | null = null;
      if (activity.workspacePath) {
        const { data: project } = await supabase
          .from('projects')
          .select('id')
          .eq('user_id', userId)
          .eq('project_path', activity.workspacePath)
          .single();

        projectId = project?.id || null;
      }

      // Upsert active session
      const { error } = await supabase
        .from('active_sessions')
        .upsert({
          user_id: userId,
          editor_type: activity.editorType,
          last_activity_at: activity.lastActivityAt.toISOString(),
          is_active: activity.isActive,
          workspace_path: activity.workspacePath || null,
          project_id: projectId,
          recent_files: activity.recentFiles,
          session_metadata: activity.metadata,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,editor_type'
        });

      if (error) {
        console.error(`[Activity] Error syncing ${activity.editorType}:`, error.message);
      } else {
        console.log(`[Activity] ✓ Synced ${activity.editorType} activity`);
      }
    } catch (error) {
      console.error(`[Activity] Error syncing ${activity.editorType}:`, error);
    }
  }

  // Mark editors with no recent activity as inactive
  const detectedEditorTypes = activities.map(a => a.editorType);
  const allEditorTypes: Array<'cursor' | 'windsurf' | 'claude_code' | 'vscode' | 'other'> =
    ['cursor', 'windsurf', 'claude_code', 'vscode'];

  const inactiveEditorTypes = allEditorTypes.filter(type => !detectedEditorTypes.includes(type));

  if (inactiveEditorTypes.length > 0) {
    const { error } = await supabase
      .from('active_sessions')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .in('editor_type', inactiveEditorTypes);

    if (error) {
      console.error('[Activity] Error marking inactive editors:', error.message);
    }
  }
}

/**
 * Run periodic activity sync
 */
export async function runPeriodicActivitySync(userId: string): Promise<void> {
  try {
    await syncEditorActivity(userId);
  } catch (error) {
    console.error('[Activity] Error in periodic sync:', error);
  }
}
