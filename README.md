# WH Stats

Compare booked hours (Redmine) vs clocked hours (timelogger) for the last 7 days.

## Installation

```bash
# Using bun (recommended)
bun x whstats

# Using npx
npx whstats

# Or install globally
bun install -g whstats
```

## Usage

```bash
# First-time setup (interactive)
whstats --setup

# Show time statistics
whstats

# Show config file location and current settings
whstats --config

# Reset configuration
whstats --reset

# Show help
whstats --help
```

## Configuration

On first run, use `whstats --setup` to configure your credentials interactively.

Configuration is stored in `~/.config/whstats/config.json`.

Alternatively, you can set environment variables:
- `REDMINE_API_KEY`
- `REDMINE_URL`
- `MSSQL_SERVER`
- `MSSQL_DATABASE`
- `MSSQL_USER`
- `MSSQL_PASSWORD`
- `SLACK_USER_ID`

## Example Output

```
Fetching time entries for John Doe...

2026-02-03 Monday: 8h booked / 8.25h clocked
  - #1234 4h Implemented feature X
  - #1235 4h Code review and testing

2026-02-04 Tuesday: 7h booked / 7.5h clocked
  - #1236 3h Bug fixes
  - #1237 4h Documentation updates
```

## Development

```bash
# Install dependencies
bun install

# Run locally
bun run index.ts

# Run with flags
bun run index.ts --help
```

## License

MIT
