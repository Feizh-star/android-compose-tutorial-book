---
name: notify
description: >
  Sends a Windows toast notification when the local conversation ends.
  Trigger at the end of each task to alert the user that Codex has finished responding.
disable-model-invocation: false
---

# notify — Windows Notification on Task End

## Overview

Sends a Windows native toast notification (or popup fallback) when invoked. Use it at the end of each task so the user knows Codex has finished responding without having to watch the window.

## Invocation

```
/notify [title] [message]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `title` | `Codex` | Notification title |
| `message` | `任务已完成` | Notification body text |

## How It Works

Runs `notify.ps1` via PowerShell, which attempts:

1. **Native WinRT toast** (Windows 10+) — a proper Windows notification that appears in Action Center
2. **WScript Popup fallback** — a simple popup dialog that auto-closes after 5 seconds
3. **Console output** — last resort if neither works

## Auto-Trigger via Hook

This skill is designed to be triggered automatically at the end of every response via a `Stop` hook in `settings.local.json`:

```json
"hooks": {
  "Stop": [
    {
      "matcher": "",
      "hooks": [
        {
          "type": "command",
          "command": "powershell -ExecutionPolicy Bypass -File \"f:/Android/note/.Codex/skills/notify/notify.ps1\""
        }
      ]
    }
  ]
}
```

With this hook in place, you don't need to call `/notify` manually — every response triggers the notification.
