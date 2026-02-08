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

## Publishing to npm

Follow this checklist when publishing a new version:

### Pre-publish Checklist

- [ ] Ensure all changes are committed and pushed to git
- [ ] Run tests manually: `bun run index.ts` (or `npm run build && node dist/index.js`)
- [ ] Review the `files` array in `package.json` to ensure only necessary files are published
- [ ] Check that `dist/` directory is not committed to git (should be in `.gitignore`)

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
- Only files listed in `package.json` `files` array are published (dist/**/*.js, dist/**/*.d.ts)
- npm creates a git tag (e.g., `v1.0.1`) when you run `npm version`

### Post-publish Verification

- [ ] Check the package on npm: `npm view whstats`
- [ ] Verify it works via npx: `npx whstats --help`
- [ ] Push git tags: `git push --follow-tags`

### Important Notes

- **No manual build needed** - `prepublishOnly` handles it
- **Log in to npm** first if needed: `npm login`
- **Dry run** to test without publishing: `npm publish --dry-run`
- **Public access** is default; for scoped packages use `npm publish --access public`

## License

MIT
