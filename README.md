# Agent Orchestrator Daemon

Backend service that monitors AI coding assistant chat histories and generates intelligent summaries.

## What it does

- Watches for new chat histories from Claude Code, Cursor, and other AI assistants
- Generates AI-powered summaries using GPT-4o-mini
- Stores processed conversations in Supabase for team visibility
- Runs as a background daemon with optional system tray integration

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment (copy .env.example to .env)
cp .env.example .env

# Run in development mode
npm run dev

# Run with system tray (requires Electron)
npm run dev:tray
```

## Environment Variables

See `.env.example` for required configuration:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anon key
- `OPENAI_API_KEY` - OpenAI API key for generating summaries

## Documentation

See the [main repository](https://github.com/AgentOrchestrator/agent-orchestrator) for full setup instructions and architecture details.