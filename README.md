# Daptin LLM Demo

Demo and API contract test for [Daptin](https://github.com/daptin/daptin)'s OpenAI-compatible LLM endpoints.

**Key idea:** This webapp uses the **official OpenAI JS SDK** pointed at Daptin. If the SDK works without patches, the API contract is proven compatible with any downstream client.

## What it tests

| Test | Validates |
|------|-----------|
| `GET /v1/models` | Model listing returns `{object: "list", data: [...]}` |
| `POST /v1/chat/completions` | Non-streaming: correct `chat.completion` object, choices, usage |
| `POST /v1/chat/completions` (stream) | SSE format: `data: {...}\n\n`, chunk objects, `[DONE]` terminator |
| `POST /v1/completions` | Native text-completion contract when enabled for the selected model |
| Error: invalid model | Returns 404 with `{error: {message, type}}` |
| Error: missing model | Returns 400 with error object |

## Quick start

### Standalone (with existing Daptin)

```bash
npm install
node server.js
# Open http://localhost:7777
# Enter your Daptin URL + JWT token in the config bar
```

### Auto-setup (creates the complete gateway catalog)

```bash
cp .env.example .env.local
# Edit .env.local with your Daptin credentials and LLM API key
npm install
node scripts/setup.js   # creates credential, provider, model, and deployment
node server.js
```

### Docker Compose (full stack)

```bash
cp .env.example .env
# Set the administrator password and provider API key in .env
docker compose up
# Daptin at :6336, Demo at :7777
```

## Architecture

```
Browser (openai JS SDK)
    |
    v
  Daptin (:6336)
  /v1/chat/completions  -->  llm_model  -->  llm_deployment  -->  llm_provider
  /v1/models
  /v1/embeddings
    ^
    |
  Demo (:7777) -- serves UI + runs contract tests
```

The demo webapp makes direct `fetch()` calls using the exact same JSON format as the OpenAI SDK. Each test validates response structure field-by-field against the OpenAI spec. Daptin `v0.13.0` or newer is required.

## License

MIT
