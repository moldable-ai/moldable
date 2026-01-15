# Moldable App Commands (Cmd+K)

This document specifies how Moldable apps can extend the desktop's global command palette (Cmd+K) with context-aware actions.

## Overview

When an app is active, the Moldable desktop fetches commands from the app's internal API. These commands appear at the top of the Cmd+K menu, allowing for deep integration like "Add Todo", "Start Meeting", or "Filter View".

## App Implementation

### 1. The Commands API

Apps MUST expose a GET endpoint at `/api/moldable/commands`.

**Requirements:**

- Must return `Access-Control-Allow-Origin: *` headers (CORS).
- Must handle `OPTIONS` preflight requests.
- Should use `export const dynamic = 'force-dynamic'` to ensure fresh data.

**Response Schema:**

```json
{
  "commands": [
    {
      "id": "add-todo",
      "label": "Add todo",
      "shortcut": "n",
      "icon": "plus",
      "group": "Actions",
      "action": { "type": "message", "payload": { "focus": "input" } }
    }
  ]
}
```

### 2. Action Types

| Type       | Description                                                               |
| :--------- | :------------------------------------------------------------------------ |
| `message`  | Sends a `moldable:command` postMessage to the app iframe.                 |
| `navigate` | Changes the iframe `src` to the specified relative path.                  |
| `focus`    | Shorthand for a message that tells the app to focus a specific UI target. |

### 3. Handling Commands (Client-Side)

Apps should use the `useMoldableCommands` hook from `@moldable-ai/ui` to respond to desktop messages.

```tsx
import { useMoldableCommands } from '@moldable-ai/ui'

export default function Page() {
  useMoldableCommands({
    'add-todo': (payload) => {
      // Logic to focus input or open modal
    },
    'filter-active': () => {
      setFilter('active')
    },
  })
}
```

## Icons

Available icon keys (mapped to Lucide in the desktop):

- `plus`
- `trash-2`
- `filter`
- _(Add more to `iconMap` in `global-command-menu.tsx` as needed)_

## Best Practices

1. **Contextual Commands**: Only return commands relevant to the current state (e.g., don't show "Complete All" if all todos are already done).
2. **Shortcuts**: Use single-character strings for shortcuts. The desktop displays these as hints.
3. **Grouping**: Use the `group` field to keep the palette organized (e.g., "Actions", "Settings", "View").
