# Schedulr - Visual Task Scheduler

**Schedule commands, scripts, and HTTP requests with a beautiful web UI**

Schedulr is a cron-style task scheduler with a modern web interface for managing recurring jobs.

## Features

- **Web UI** - Beautiful dashboard for managing tasks
- **Crontab syntax** - Familiar cron expressions
- **HTTP Requests** - Schedule API calls
- **Script Execution** - Run shell scripts
- **Logging** - View output of each run
- **One-click Enable/Disable** - Toggle tasks on/off

## Installation

```bash
bun install
bun run start
```

Then open http://localhost:3000

## Usage

```bash
bun run start     # Start the scheduler
bun run add        # Add a new task
bun run list      # List all tasks
bun run remove 1  # Remove task by ID
```

## Task Types

### HTTP Request
```json
{
  "type": "http",
  "url": "https://api.example.com/cleanup",
  "method": "POST"
}
```

### Shell Command
```json
{
  "type": "shell",
  "command": "echo 'Hello' >> /tmp/log.txt"
}
```

## Crontab Format

```
* * * * * *
│ │ │ │ │ └── Day of week (0-6, Sunday=0)
│ │ │ │ └──── Month (1-12)
│ │ │ └────── Day of month (1-31)
│ │ └──────── Hour (0-23)
│ └────────── Minute (0-59)
└──────────── Second (0-59, optional)
```

## License

MIT
