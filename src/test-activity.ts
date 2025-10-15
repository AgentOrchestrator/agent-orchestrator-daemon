#!/usr/bin/env ts-node
/**
 * Test script for editor activity detection
 * Run with: npx ts-node test-activity.ts
 */

import { detectAllEditorActivity, getMostRecentEditor, getActiveEditors } from './activity-detector.js';

console.log('🔍 Testing Editor Activity Detection\n');
console.log('=' .repeat(60));

// Detect all editor activity
console.log('\n📊 ALL EDITOR ACTIVITY:');
console.log('-'.repeat(60));

const allActivity = detectAllEditorActivity();

if (allActivity.length === 0) {
  console.log('❌ No editor activity detected');
} else {
  allActivity.forEach((activity, index) => {
    const timeAgo = Math.floor((Date.now() - activity.lastActivityAt.getTime()) / 1000 / 60);
    const status = activity.isActive ? '🟢' : '⚫';

    console.log(`\n${index + 1}. ${status} ${activity.editorType.toUpperCase()}`);
    console.log(`   Last Activity: ${timeAgo} minutes ago`);
    console.log(`   Timestamp: ${activity.lastActivityAt.toISOString()}`);
    console.log(`   Active: ${activity.isActive ? 'YES' : 'NO'}`);

    if (activity.workspacePath) {
      console.log(`   Workspace: ${activity.workspacePath}`);
    }

    if (activity.recentFiles.length > 0) {
      console.log(`   Recent Files: ${activity.recentFiles.length}`);
      activity.recentFiles.forEach(file => {
        console.log(`     - ${file.path}`);
      });
    }

    console.log(`   Metadata:`, JSON.stringify(activity.metadata, null, 4));
  });
}

// Get most recent editor
console.log('\n\n🏆 MOST RECENTLY USED EDITOR:');
console.log('-'.repeat(60));

const mostRecent = getMostRecentEditor();
if (mostRecent) {
  const timeAgo = Math.floor((Date.now() - mostRecent.lastActivityAt.getTime()) / 1000 / 60);
  console.log(`✓ ${mostRecent.editorType.toUpperCase()} (${timeAgo} minutes ago)`);
  if (mostRecent.workspacePath) {
    console.log(`  Working on: ${mostRecent.workspacePath}`);
  }
} else {
  console.log('❌ No editor activity detected');
}

// Get currently active editors
console.log('\n\n⚡ CURRENTLY ACTIVE EDITORS (within past hour):');
console.log('-'.repeat(60));

const activeEditors = getActiveEditors();
if (activeEditors.length === 0) {
  console.log('❌ No active editors (no activity in past hour)');
} else {
  activeEditors.forEach(editor => {
    const timeAgo = Math.floor((Date.now() - editor.lastActivityAt.getTime()) / 1000 / 60);
    console.log(`✓ ${editor.editorType.toUpperCase()} - ${timeAgo}m ago ${editor.workspacePath ? `(${editor.workspacePath})` : ''}`);
  });
}

console.log('\n' + '='.repeat(60));
console.log('✅ Test complete!');
