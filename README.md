# hey-mcp

A local MCP (Model Context Protocol) server for Hey.com email integration with Claude.

## Features

- Read emails from Imbox, Feed, Paper Trail, Set Aside, Reply Later
- Send and reply to emails
- Search emails
- Manage email organisation (set aside, reply later, screen in/out)
- Lightweight (~30MB idle memory)
- Browser-identical requests to avoid detection
- No cloud dependencies - runs entirely locally

## Requirements

- [Bun](https://bun.sh) 1.1 or later
- Python 3.10 or later
- A Hey.com account

## Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/hey-mcp.git
cd hey-mcp

# Install dependencies
bun install
pip install -r auth/requirements.txt

# First run - will open browser for Hey.com login
bun run dev
```

## Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "hey": {
      "command": "bun",
      "args": ["run", "/path/to/hey-mcp/src/index.ts"]
    }
  }
}
```

## Available Tools

| Tool                   | Description                   |
|------------------------|-------------------------------|
| `hey_list_imbox`       | List emails in Imbox          |
| `hey_list_feed`        | List emails in The Feed       |
| `hey_list_paper_trail` | List emails in Paper Trail    |
| `hey_list_set_aside`   | List Set Aside emails         |
| `hey_list_reply_later` | List Reply Later emails       |
| `hey_read_email`       | Read full email content by ID |
| `hey_search`           | Search emails by query        |
| `hey_send_email`       | Send a new email              |
| `hey_reply`            | Reply to an email thread      |
| `hey_set_aside`        | Move email to Set Aside       |
| `hey_reply_later`      | Move email to Reply Later     |
| `hey_screen_in`        | Approve sender from Screener  |
| `hey_screen_out`       | Reject sender from Screener   |

## How It Works

1. On first run (or when session expires), a system webview opens for Hey.com login
2. Session cookies are captured and stored locally
3. The MCP server makes direct HTTP requests to Hey.com using stored cookies
4. Requests use browser-identical TLS fingerprints and headers

## Privacy & Security

- No credentials are ever stored - only session cookies
- Authentication happens entirely within Hey's own login page
- All data stays on your machine
- MCP uses stdio transport with no network exposure

## Limitations

- No real-time notifications (polling only)
- Attachment uploads not yet supported
- Single account only
- May break if Hey.com changes their frontend

## License

MIT
