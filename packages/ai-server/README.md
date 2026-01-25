# @moldable-ai/ai-server

Internal AI server that powers Moldable's desktop chat and gateway integrations.

## Gateway endpoints

The gateway API accepts plain text messages from Moldable Gateway (Telegram/WhatsApp/etc.) and stores sessions separately from desktop conversations.

### POST `/api/gateway/chat`

```json
{
  "sessionId": "agent:main:telegram:dm:123",
  "messages": [{ "role": "user", "text": "hello", "timestamp": 1737811000 }],
  "model": "anthropic/claude-3.7-sonnet",
  "reasoningEffort": "medium",
  "activeWorkspaceId": "personal",
  "gateway": {
    "channel": "telegram",
    "peerId": "123",
    "displayName": "alice",
    "isGroup": false,
    "agentId": "main",
    "sessionKey": "agent:main:telegram:dm:123"
  }
}
```

Response:

```json
{ "text": "assistant response", "sessionId": "agent:main:telegram:dm:123" }
```

### Session listing

- `GET /api/gateway/sessions?workspaceId=personal`
- `GET /api/gateway/sessions/:id?workspaceId=personal`
- `DELETE /api/gateway/sessions/:id?workspaceId=personal`

### Storage

- Shared sessions: `~/.moldable/shared/gateway-sessions/`
- Workspace sessions: `~/.moldable/workspaces/{workspaceId}/gateway-sessions/`

## Notes

- `/api/chat` remains the desktop app entry point for interactive chat sessions.
- Gateway sessions are kept separate to avoid mixing UI history.
