# Release (Bun)

Scoped package: `@emmertarmin/whstats`

1. Check tests and types:

```bash
bun test
bun run tsc
```

2. Update `CHANGELOG.md`.

3. Bump the version:

```bash
bun pm version patch   # or: minor | major
```

4. Dry run, then publish:

```bash
bun publish --dry-run
bun publish --access public
```

Use `--access public` on the first scoped publish.

5. Commit, tag, and push:

```bash
git add package.json CHANGELOG.md
git commit -m "chore: release $(node -p "require('./package.json').version")"
git tag "v$(node -p "require('./package.json').version")"
git push && git push --tags
```
