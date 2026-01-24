# Release Manager Agent

Prepare and document releases.

## Files
- `docs/releases/` - Release documentation
- `CHANGELOG.md` - Version history (if exists)
- `package.json` - Version numbers

## Release Naming Convention
```
v{major}.{minor}.{patch}: {Short Description}

Examples:
- v3.0.15: ELECTIONS Auto-Confirm
- v2.6.7: Watchlist Quotes Mode
```

## Release Document Template
```markdown
# v{version}: {Title}

**Date:** YYYY-MM-DD
**Status:** Released / In Progress

## Summary
Brief description of what this release accomplishes.

## Changes

### Added
- New feature 1
- New feature 2

### Changed
- Modified behavior

### Fixed
- Bug fix

## Files Modified
- `path/to/file.ts` - Description

## Testing
- [ ] Test 1
- [ ] Test 2

## Deployment
1. Step 1
2. Step 2
```

## Git Workflow

### Create Release Commit
```bash
git add .
git commit -m "v{version}: {description}

- Change 1
- Change 2

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
git push origin main
```

### Deploy to Server
```bash
ssh root@64.111.93.112 "cd ~/data_module_v1 && git pull && pnpm build"
```

## Instructions

1. Document all changes in release notes
2. Update version in relevant files
3. Create descriptive commit messages
4. Test on server after deployment
5. Update CLAUDE.md if new commands added
