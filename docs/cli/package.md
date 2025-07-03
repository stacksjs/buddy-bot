# Package Commands

CLI commands for package analysis, management, and information retrieval.

## Package Information

### `info` - Package Details

Get comprehensive information about a package:

```bash
# Basic package info
buddy-bot info react

# Detailed information
buddy-bot info react --detailed

# Include dependencies
buddy-bot info react --include-deps

# Show version history
buddy-bot info react --versions --limit 10

# Output as JSON
buddy-bot info react --json
```

**Options:**
- `--detailed` - Show extended package information
- `--include-deps` - Include dependency tree
- `--versions` - Show available versions
- `--limit <number>` - Limit version results
- `--json` - Output as JSON

### `versions` - Available Versions

List all available versions for a package:

```bash
# All versions
buddy-bot versions typescript

# Latest 10 versions
buddy-bot versions typescript --limit 10

# Include pre-releases
buddy-bot versions typescript --include-pre

# Filter by tag
buddy-bot versions typescript --tag latest

# Show release dates
buddy-bot versions typescript --with-dates
```

### `latest` - Latest Version

Get the latest version of a package:

```bash
# Latest stable version
buddy-bot latest vue

# Latest including pre-releases
buddy-bot latest vue --include-pre

# Latest for specific tag
buddy-bot latest vue --tag next
```

## Package Analysis

### `deps` - Dependency Analysis

Analyze package dependencies:

```bash
# Direct dependencies
buddy-bot deps react

# Full dependency tree
buddy-bot deps react --tree

# Specific depth
buddy-bot deps react --depth 2

# Include dev dependencies
buddy-bot deps react --include-dev

# Show outdated dependencies
buddy-bot deps react --outdated

# Export dependency graph
buddy-bot deps react --graph --output deps.json
```

**Options:**
- `--tree` - Show full dependency tree
- `--depth <number>` - Limit tree depth
- `--include-dev` - Include devDependencies
- `--outdated` - Show outdated dependencies
- `--graph` - Generate dependency graph
- `--output <file>` - Save output to file

### `check` - Package Updates

Check for available updates:

```bash
# Check all packages
buddy-bot check

# Check specific packages
buddy-bot check react vue typescript

# Check with strategy
buddy-bot check --strategy minor

# Check security updates only
buddy-bot check --security-only

# Check by pattern
buddy-bot check --pattern "@types/*"

# Show changelogs
buddy-bot check --with-changelog

# Group by update type
buddy-bot check --group-by-type
```

**Options:**
- `--strategy <type>` - Update strategy (patch|minor|major|all)
- `--security-only` - Security updates only
- `--pattern <pattern>` - Package name pattern
- `--with-changelog` - Include changelog information
- `--group-by-type` - Group results by update type

### `outdated` - Outdated Packages

List packages that have updates available:

```bash
# All outdated packages
buddy-bot outdated

# Outdated with severity
buddy-bot outdated --severity

# Outdated dev dependencies
buddy-bot outdated --dev-only

# Outdated production dependencies
buddy-bot outdated --prod-only

# Table format
buddy-bot outdated --table

# JSON output
buddy-bot outdated --json
```

## Package Search

### `search` - Package Search

Search for packages in registries:

```bash
# Basic search
buddy-bot search "state management"

# Limit results
buddy-bot search "testing" --limit 20

# Search by keywords
buddy-bot search --keywords "typescript,testing"

# Search by maintainer
buddy-bot search --maintainer "facebook"

# Include deprecated packages
buddy-bot search "react" --include-deprecated

# Sort by popularity
buddy-bot search "ui components" --sort popularity
```

**Options:**
- `--limit <number>` - Limit search results
- `--keywords <keywords>` - Search by keywords (comma-separated)
- `--maintainer <name>` - Filter by maintainer
- `--include-deprecated` - Include deprecated packages
- `--sort <field>` - Sort by field (popularity|quality|maintenance)

### `exists` - Package Existence

Check if a package exists:

```bash
# Check if package exists
buddy-bot exists @types/unknown-package

# Check multiple packages
buddy-bot exists react vue angular

# Check with version
buddy-bot exists react@18.0.0

# Silent mode (exit code only)
buddy-bot exists react --silent
```

## Package Comparison

### `compare` - Version Comparison

Compare package versions:

```bash
# Compare two versions
buddy-bot compare react 17.0.0 18.0.0

# Compare with current
buddy-bot compare react --current 17.0.0 --target 18.0.0

# Show breaking changes
buddy-bot compare react 17.0.0 18.0.0 --breaking-changes

# Include changelog
buddy-bot compare react 17.0.0 18.0.0 --changelog

# Detailed comparison
buddy-bot compare react 17.0.0 18.0.0 --detailed
```

### `diff` - Package Differences

Show differences between package versions:

```bash
# Show package.json differences
buddy-bot diff react 17.0.0 18.0.0

# Show dependency differences
buddy-bot diff react 17.0.0 18.0.0 --deps

# Show size differences
buddy-bot diff react 17.0.0 18.0.0 --size

# Show vulnerability differences
buddy-bot diff react 17.0.0 18.0.0 --vulnerabilities
```

## Registry Operations

### `registry` - Registry Management

Manage package registries:

```bash
# List configured registries
buddy-bot registry list

# Add new registry
buddy-bot registry add --name company --url https://npm.company.com

# Set default registry
buddy-bot registry default company

# Test registry connection
buddy-bot registry test company

# Remove registry
buddy-bot registry remove company
```

### `whoami` - Registry Authentication

Check registry authentication:

```bash
# Check current user
buddy-bot whoami

# Check for specific registry
buddy-bot whoami --registry npm

# Check all registries
buddy-bot whoami --all
```

## Package Validation

### `validate` - Package Validation

Validate package configurations:

```bash
# Validate package.json
buddy-bot validate

# Validate dependencies
buddy-bot validate --deps

# Check for security issues
buddy-bot validate --security

# Check licenses
buddy-bot validate --licenses

# Validate workspace packages
buddy-bot validate --workspaces
```

### `audit` - Security Audit

Perform security audit:

```bash
# Basic audit
buddy-bot audit

# Audit with fix suggestions
buddy-bot audit --fix

# Audit specific severity
buddy-bot audit --severity high

# Audit production only
buddy-bot audit --production

# Generate audit report
buddy-bot audit --report --output audit-report.json
```

## Package Management

### `install` - Install Packages

Install or update packages:

```bash
# Install package
buddy-bot install lodash

# Install with version
buddy-bot install lodash@4.17.21

# Install as dev dependency
buddy-bot install --dev @types/lodash

# Install globally
buddy-bot install --global typescript

# Install from specific registry
buddy-bot install lodash --registry company
```

### `uninstall` - Remove Packages

Remove packages:

```bash
# Remove package
buddy-bot uninstall lodash

# Remove dev dependency
buddy-bot uninstall --dev @types/lodash

# Remove global package
buddy-bot uninstall --global typescript

# Remove and update dependencies
buddy-bot uninstall lodash --update-deps
```

## Workspace Operations

### `workspace` - Workspace Commands

Manage monorepo workspaces:

```bash
# List workspaces
buddy-bot workspace list

# Show workspace info
buddy-bot workspace info packages/ui

# Check workspace dependencies
buddy-bot workspace deps packages/ui

# Update workspace
buddy-bot workspace update packages/ui

# Validate workspace
buddy-bot workspace validate packages/ui
```

## Output Formats

All package commands support multiple output formats:

```bash
# JSON output
buddy-bot info react --json

# Table format
buddy-bot outdated --table

# YAML output
buddy-bot check --yaml

# CSV format
buddy-bot outdated --csv

# Custom format
buddy-bot info react --format "{name}@{version}"
```

## Configuration

Package commands respect global configuration:

```bash
# Use specific config file
buddy-bot check --config custom-config.ts

# Override registry
buddy-bot info react --registry https://npm.company.com

# Override strategy
buddy-bot check --strategy major

# Debug mode
buddy-bot check --debug

# Verbose output
buddy-bot check --verbose
```

## Examples

### Daily Package Health Check

```bash
# Comprehensive package health check
buddy-bot outdated --table && \
buddy-bot audit --severity high && \
buddy-bot validate --deps
```

### Security-Focused Analysis

```bash
# Check for security updates
buddy-bot check --security-only --with-changelog

# Audit for vulnerabilities
buddy-bot audit --production --report
```

### Monorepo Package Management

```bash
# Check all workspaces
buddy-bot workspace list | xargs -I {} buddy-bot check --workspace {}

# Validate workspace dependencies
buddy-bot workspace validate --all
```

See [Package Management](/features/package-management) for more details on package handling features.
