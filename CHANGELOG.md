# Changelog

## v2.0.0

### Breaking Changes

- **Removed `--ytd` alias**: Year-to-date statistics now only accessible via `--year-to-date` or `-Y` (uppercase)
- **Changed `-y` meaning**: Previously `-y` was alias for `--year-to-date`, now `-y` means `--year` (past 365 days), and `-Y` (uppercase) means `--year-to-date`
- **Removed `--no-summary` / `-n` flag**: Summary is now always shown; use `--brief` for concise output
- **Removed `-s` short option**: `--setup` no longer has `-s` short option; use `--config` or `--setup`
- **Removed `-c` short option**: `--config` previously had `-c` short option and showed config location; now `--config` runs interactive setup, and `--show-config` displays settings
- **Changed `--config` behavior**: Previously showed config location (now `--show-config`); now runs interactive setup (previously `--setup`)
- **Removed `-r` short option**: `--reset` no longer has a short option; must be typed out fully as a safety measure

### Added or Changed

- Added `--year` flag with `-y` short option to show statistics for the past 365 days
- Added `--brief` / `-b` modifier for concise output (daily totals only, no entries)
- Added `--json` / `-j` modifier for JSON output format
- Added `--week` / `-w` and `--month` / `-m` as explicit range commands
- Added `--show-config` command to display config file location and current settings
- Implemented Unified Command & Modifier Registry for maintainable command structure
- Migrated argument parsing to Node.js `parseArgs` utility with strict validation
- Streamlined help text generation from centralized command registry
- Enhanced unknown flag detection with helpful error messages

## v1.3.3

### Added or Changed

- Added comprehensive "Publishing to npm" documentation section to README
- Restructured README with improved sections and better navigation
- Added installation instructions for both bun and npm
