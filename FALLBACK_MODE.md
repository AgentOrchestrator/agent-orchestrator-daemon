# Fallback Mode for Summarization and Keyword Extraction

The daemon now supports a **fallback mode** that allows it to work without OpenAI API integration. This is useful for:

- **Development environments** where you want to avoid API costs
- **Rate limit avoidance** during testing
- **Offline or restricted environments** where OpenAI API access is not available
- **Initial setup** when you haven't configured an OpenAI API key yet

## How It Works

The daemon automatically uses fallback mode when either:

1. **DEVELOPMENT=true** is set in your `.env` file, OR
2. **OPENAI_API_KEY** is not configured

When in fallback mode:
- **Summarization**: Uses a simple template-based approach that extracts first and last messages
- **Keyword Extraction**: Uses pattern matching and word frequency analysis to identify work types and topics

## Configuration

### Using Development Mode

Add to your `.env` file:

```env
DEVELOPMENT=true
```

This will use the fallback mechanism even if you have an OpenAI API key configured.

### Without OpenAI API Key

Simply don't set or leave empty:

```env
# OPENAI_API_KEY=
```

The daemon will automatically detect the missing key and use fallback mode.

## Fallback Summarization

The mock summarizer creates summaries in this format:

```
Session with 15 messages. Started with: "I need to fix a bug..." Last message: "Great, that worked!..."
```

## Fallback Keyword Extraction

The mock keyword extractor:

### Work Type Detection
Identifies work types based on keyword presence:
- **bug**: "bug", "error", "fix"
- **feature**: "feature", "add", "new"
- **refactor**: "refactor", "clean", "reorganize"
- **testing**: "test", "spec", "jest"
- **debugging**: "debug", "console.log", "breakpoint"
- **deployment**: "deploy", "release", "production"
- **configuration**: "config", "setup", "install"
- **optimization**: "optimize", "performance", "speed"
- **documentation**: "document", "readme", "comment"
- **learning**: "learn", "understand", "how"

### Topic Extraction
Identifies topics using:
1. **Technology pattern matching**: React, TypeScript, API, database, etc.
2. **Word frequency analysis**: Most common words in the conversation

## Example Output

```json
{
  "type": ["feature", "bug"],
  "topic": ["react", "authentication", "typescript"]
}
```

## Switching Between Modes

You can easily switch between fallback and OpenAI modes:

### Use Fallback Mode
```env
DEVELOPMENT=true
```

### Use OpenAI Mode
```env
DEVELOPMENT=false
OPENAI_API_KEY=sk-your-api-key-here
```

## Logs

The daemon will log which mode it's using:

```
[Summary] Using fallback summarizer (DEVELOPMENT mode)
[Keywords] Using fallback keyword extraction (DEVELOPMENT mode)
```

or

```
[Summary] Using fallback summarizer (OPENAI_API_KEY not set)
[Keywords] Using fallback keyword extraction (OPENAI_API_KEY not set)
```

## Production Recommendations

For production environments:
- Use **DEVELOPMENT=false**
- Configure a valid **OPENAI_API_KEY**
- This ensures high-quality AI-powered summaries and keyword extraction

For development/testing:
- Use **DEVELOPMENT=true**
- This avoids API costs and rate limits during active development
