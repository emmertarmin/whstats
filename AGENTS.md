# AGENTS.md - Coding Agent Guidelines for whstats

This document provides essential information for AI coding agents working in this repository.

## Project Overview

**whstats** is a TypeScript CLI tool that compares booked hours from Redmine against clocked hours from a timelogger MSSQL database. It runs on Bun or Node.js (>=18).

## Technology Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Bun (primary) / Node.js
- **Module System:** ESM (`"type": "module"`)
- **Build:** TypeScript compiler (`tsc`)
- **Database:** MSSQL (via `mssql` package)
- **External APIs:** Redmine REST API

## Project Structure

```
├── index.ts              # CLI entry point, argument parsing, main logic
├── lib/
│   ├── config.ts         # Configuration management (~/.config/whstats/)
│   ├── utils.ts          # Utility functions (date/formatting helpers)
│   ├── redmine.ts        # Redmine API client
│   └── mssql.ts          # MSSQL database queries
├── dist/                 # Compiled output (generated)
├── package.json
└── tsconfig.json
```

## Build Commands

```bash
# Build the project (compiles TypeScript to dist/)
npm run build
# or
bun run build

# Run directly with Bun (no build needed)
bun index.ts

# Run the built CLI
node dist/index.js
# or after npm link:
whstats
```

## Testing

**No test framework is currently configured.** If adding tests:
- Recommended: Use Bun's built-in test runner (`bun test`) or Vitest
- Place test files as `*.test.ts` alongside source files or in a `tests/` directory
- Run single test: `bun test <filename>` or `vitest run <filename>`

## Code Style Guidelines

### TypeScript Configuration

The project uses strict TypeScript settings (see `tsconfig.json`):
- `strict: true` - All strict type-checking options enabled
- `noUncheckedIndexedAccess: true` - Array/object index access may be undefined
- `noFallthroughCasesInSwitch: true` - Require break/return in switch cases
- `noImplicitOverride: true` - Require `override` keyword for overridden methods
- Target: ES2022, Module: NodeNext

### Import Conventions

1. **Use `.js` extension** for local imports (required by NodeNext module resolution):
   ```typescript
   // Correct
   import { Config } from "./config.js";
   import { formatDate } from "./utils.js";

   // Wrong
   import { Config } from "./config";
   import { Config } from "./config.ts";
   ```

2. **Import order** (follow existing patterns):
   - Node.js built-ins first
   - External packages
   - Local modules
   ```typescript
   import { homedir } from "os";
   import { join } from "path";
   import sql from "mssql";
   import type { Config } from "./config.js";
   ```

3. **Use `import type`** for type-only imports:
   ```typescript
   import type { Config } from "./config.js";
   ```

### Formatting

- **Indentation:** 2 spaces
- **Quotes:** Double quotes for strings
- **Semicolons:** Required
- **Trailing commas:** Use in multiline arrays/objects
- **Line length:** Keep reasonable (~100 chars)

### Naming Conventions

- **Functions:** camelCase (`fetchTimeEntries`, `formatHours`)
- **Variables:** camelCase (`clockedHours`, `dateStr`)
- **Interfaces/Types:** PascalCase (`Config`, `TimeEntry`, `User`)
- **Constants:** SCREAMING_SNAKE_CASE for module-level (`CONFIG_DIR`, `VERSION`)
- **Files:** lowercase with hyphens if needed (`config.ts`, `mssql.ts`)

### Type Annotations

1. **Always annotate function parameters and return types:**
   ```typescript
   export function formatHours(hours: number): string {
     return hours % 1 === 0 ? `${hours}h` : `${hours.toFixed(2)}h`;
   }

   export async function fetchCurrentUser(config: Config): Promise<User> {
     // ...
   }
   ```

2. **Define interfaces** for API responses and data structures:
   ```typescript
   export interface TimeEntry {
     id: number;
     project: { id: number; name: string };
     issue?: { id: number };  // Optional fields use ?
     hours: number;
     spent_on: string;
   }
   ```

3. **Use type assertions** with `as` for JSON parsing:
   ```typescript
   const data = (await response.json()) as TimeEntriesResponse;
   ```

4. **Handle `noUncheckedIndexedAccess`** with non-null assertion when safe:
   ```typescript
   const days = ["Sun", "Mon", "Tue"];
   return days[new Date(dateStr).getDay()]!;  // ! when you know it's valid
   ```

### Error Handling

1. **Use try/catch** with proper error typing:
   ```typescript
   try {
     const user = await fetchCurrentUser(config);
   } catch (error) {
     if (error instanceof Error) {
       console.error(`\n  Error: ${error.message}\n`);
     } else {
       console.error("\n  An unexpected error occurred.\n");
     }
     process.exit(1);
   }
   ```

2. **Throw descriptive Error objects:**
   ```typescript
   if (!response.ok) {
     throw new Error(`Redmine API error: ${response.status} ${response.statusText}`);
   }
   ```

3. **Use `finally`** for cleanup (e.g., closing database connections):
   ```typescript
   try {
     const result = await pool.request().query(`...`);
     return result;
   } finally {
     await pool.close();
   }
   ```

### Async/Await Patterns

- Always use `async/await` over raw Promises
- Use `Promise.all` for parallel operations:
  ```typescript
  const [entries, clockedHours] = await Promise.all([
    fetchTimeEntries(config, user.id, from, to),
    fetchClockedHours(config, from, to),
  ]);
  ```

### CLI Output

- Use `console.log` for normal output
- Use `console.error` for errors
- Prefix output with spacing for readability: `console.log("\n  Message\n")`
- Exit with appropriate codes: `process.exit(1)` for errors

### Configuration

- Config stored in `~/.config/whstats/config.json`
- Use secure file permissions: `mode: 0o600` for config, `mode: 0o700` for directories
- Validate all required fields before saving

## Common Patterns in This Codebase

1. **Export functions individually** (no default exports)
2. **Group related functionality** into separate lib/ modules
3. **CLI arguments** handled via switch statement in `main()`
4. **Dates** formatted as ISO strings (`YYYY-MM-DD`)
5. **Maps** used for date-keyed data structures
