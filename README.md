## About the project

At Wirth & Horn we use Redmine for project management and time tracking. Since 2024 we have a custom internal Slackbot that lets us track our active work hours and greet each other.

This CLI tool, `whstats` ("Wirth & Horn Statistics"), reads both sources, and provides a custom unified view of booked vs clocked hours, as well as longer term statistics. It is custom built for my own needs and those of my colleagues, and is not intended for public use.

<br />
<div align="center">
	<h3 align="center">whstats</h3>

  <p align="center">
    A custom CLI tool for tracking and analyzing work hours at <a href="https://www.wirth-horn.de/">Wirth & Horn</a>.
    <br />
    <a href="https://github.com/emmertarmin/whstats#run-directly-recommended">Get started!</a>
    <br />
    <br />
    <a href="https://github.com/emmertarmin/whstats#run-directly-recommended">Run directly</a>
    &middot;
    <a href="https://github.com/emmertarmin/whstats#configuration">Configure</a>
    &middot;
    <a href="https://github.com/emmertarmin/whstats#development">Contribute</a>
  </p>
</div>

## Run directly (recommended)

`whstats` can be run directly with `bun x whstats` or `npx whstats`, which ensures you're always running the latest version.

The first time you will be prompted to set up your credentials interactively. See: [Configuration](#configuration).

## Installation (optional)

You can install it globally, allowing you to run `whstats` directly, but this requires manual updates.

bun:

```bash
# install
bun install -g whstats
# update
bun update -g whstats
```

npm:

```bash
# install
npm install -g whstats
# update
npm update -g whstats

```

## Usage

```bash
# Show time statistics
whstats

# Show year-to-date statistics
whstats --year-to-date

# First time setup (interactive)
whstats --config    # or --setup

# Show config file location and current settings
whstats --show-config

# Reset configuration
whstats --reset

# Show help
whstats --help
```

## Configuration

Run `whstats --config` (or `whstats --setup`) to interactively enter your Redmine API key and other settings. Values marked in square brackets `[]` show preconfigured defaults, or past configuration, and can be accepted by pressing Enter.

To change your configuration later, simply run `whstats --config` again to edit and overwrite existing values.

Configuration is stored in `~/.config/whstats/config.json` automatically.

```json
{
  "redmineUrl": "https://redmine.wirth-horn.de",
  "redmineApiKey": "<your_redmine_api_key>",
  "mssqlServer": "10.10.10.15",
  "mssqlDatabase": "wh_timelogger",
  "mssqlUser": "<username>",
  "mssqlPassword": "<password>",
  "slackUserId": "<slack_user_id>",
  "targetHoursPerDay": 8,
  "ignoredRedmineTicketIds": [39193]
}
```

`ignoredRedmineTicketIds` lets you exclude one or more Redmine ticket IDs from "booked-hour" calculations. This is useful for "non-productive" tickets (for example, sick days), that don't pair with Slackbot presence data. In the interactive setup, use comma-separated numbers.

During `whstats --setup`, existing ignored IDs are prepopulated so you can edit and overwrite the full list.

## Example Output

```
Fetching time entries for John Doe...

[...]

2026-02-03 Monday: 8h booked / 8.25h clocked
  - #11111 4h Implemented feature X
  - #22222 4h Code review and testing

2026-02-04 Tuesday: 7h booked / 7.41h clocked
  - #33333 3h Bug fixes
  - #44444 4h Documentation updates
────────────────────────────────────────────────────────────
Summary (past 6 days)
    Target:        40h + 7.41h
    Booked:        40h +    7h =  99% (-0.41h)
    Clocked:    43.59h + 7.41h = 115% (+3.59h)
    Efficiency:                   92% (booked/clocked ratio)
```

## Development

### Running Locally

```bash
# Install dependencies
bun install

# Run locally
bun run index.ts

# Run with flags
bun run index.ts --help
```

### Testing

- [ ] Typecheck with `bun run tsc`
- [ ] Run `bun run index.ts` and verify output is correct
- [ ] Test `--help` and `--version` flags
- [ ] Test flag combinations, e.g., `bun run index.ts --month --brief`
- [ ] Unknown flags produce helpful error messages
- [ ] Built distribution (`bun run build && node dist/index.js --version`) runs correctly

## Publishing to npm

Follow this checklist when publishing a new version:

### Pre-publish Checklist

- [ ] Ensure tests pass, see [Testing](#testing)
- [ ] Ensure all changes are committed and pushed to git
- [ ] Review the `files` array in `package.json` to ensure only necessary files are published
- [ ] Check that `dist/` directory is not committed to git (should be in `.gitignore`)
- [ ] `CHANGELOG.md`, `--help` command output and `README.md` are up to date with new changes, if relevant

### Version Bump & Publish

1. **Bump version** (creates git tag automatically):

   ```bash
   npm version patch   # 1.0.0 → 1.0.1 (bug fixes)
   npm version minor   # 1.0.0 → 1.1.0 (new features)
   npm version major   # 1.0.0 → 2.0.0 (breaking changes)
   ```

2. **Publish to npm**:
   ```bash
   npm publish
   ```

### What Happens Automatically

- `prepublishOnly` hook runs `npm run build` before publishing (compiles TypeScript)
- Only files listed in `package.json` `files` array are published (dist/**/\*.js, dist/**/\*.d.ts)
- npm creates a git tag (e.g., `v1.0.1`) when you run `npm version`

### Post-publish Verification

- [ ] Check the package on npm: `npm view whstats`
- [ ] Verify it works via npx: `npx whstats --help`
- [ ] Push git tags: `git push --follow-tags`

## License

MIT
