/**
 * MOCK Summarizer Module
 *
 * This module provides simplified, non-AI summarization and keyword extraction
 * for development environments where OpenAI API calls are not desired.
 *
 * Enable by setting DEVELOPMENT=true in .env
 */

interface Message {
  display: string;
  pastedContents?: Record<string, any>;
}

interface KeywordClassification {
  type: string[];
  topic: string[];
}

/**
 * Generate a simple summary without AI
 * Uses basic heuristics to create a summary from messages
 */
export function generateMockSummary(messages: Message[]): string {
  if (messages.length === 0) {
    return 'No messages in this session yet.';
  }

  // Get first and last messages
  const firstMessage = messages[0]?.display.substring(0, 100) || '';
  const lastMessage = messages[messages.length - 1]?.display.substring(0, 100) || '';
  const messageCount = messages.length;

  // Simple summary template
  return `Session with ${messageCount} message${messageCount === 1 ? '' : 's'}. Started with: "${firstMessage}..." Last message: "${lastMessage}..."`;
}

/**
 * Extract keywords using simple text analysis
 * No AI required - uses word frequency and common patterns
 */
export function generateMockKeywords(messages: Message[]): KeywordClassification {
  if (messages.length === 0) {
    return { type: [], topic: [] };
  }

  // Combine all message text
  const allText = messages
    .map(m => m.display.toLowerCase())
    .join(' ');

  // Determine work type based on keywords
  const types: string[] = [];

  if (allText.includes('bug') || allText.includes('error') || allText.includes('fix')) {
    types.push('bug');
  }
  if (allText.includes('feature') || allText.includes('add') || allText.includes('new')) {
    types.push('feature');
  }
  if (allText.includes('refactor') || allText.includes('clean') || allText.includes('reorganize')) {
    types.push('refactor');
  }
  if (allText.includes('test') || allText.includes('spec') || allText.includes('jest')) {
    types.push('testing');
  }
  if (allText.includes('debug') || allText.includes('console.log') || allText.includes('breakpoint')) {
    types.push('debugging');
  }
  if (allText.includes('deploy') || allText.includes('release') || allText.includes('production')) {
    types.push('deployment');
  }
  if (allText.includes('config') || allText.includes('setup') || allText.includes('install')) {
    types.push('configuration');
  }
  if (allText.includes('optimize') || allText.includes('performance') || allText.includes('speed')) {
    types.push('optimization');
  }
  if (allText.includes('document') || allText.includes('readme') || allText.includes('comment')) {
    types.push('documentation');
  }
  if (allText.includes('learn') || allText.includes('understand') || allText.includes('how')) {
    types.push('learning');
  }

  // If no types found, default to 'exploration'
  if (types.length === 0) {
    types.push('exploration');
  }

  // Extract topics using simple pattern matching
  const topics: string[] = [];

  // Common tech keywords
  const techPatterns = [
    'react', 'vue', 'angular', 'svelte',
    'typescript', 'javascript', 'python', 'java', 'go', 'rust',
    'api', 'rest', 'graphql', 'websocket',
    'database', 'sql', 'mongodb', 'postgres', 'mysql',
    'auth', 'authentication', 'login', 'oauth',
    'docker', 'kubernetes', 'aws', 'azure', 'gcp',
    'git', 'github', 'gitlab',
    'node', 'express', 'fastify', 'nest',
    'supabase', 'firebase', 'vercel',
    'email', 'gmail', 'whatsapp', 'telegram',
  ];

  for (const pattern of techPatterns) {
    if (allText.includes(pattern)) {
      topics.push(pattern);
      if (topics.length >= 5) break;
    }
  }

  // If no topics found, extract some common words
  if (topics.length === 0) {
    const words = allText.split(/\s+/).filter(w => w.length > 4);
    const wordFreq = new Map<string, number>();

    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }

    const topWords = Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([word]) => word);

    topics.push(...topWords);
  }

  return {
    type: types.slice(0, 3),
    topic: topics.slice(0, 5),
  };
}
