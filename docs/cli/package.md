# Package Commands

Commands for analyzing packages, checking versions, and exploring the npm registry.

## check

Check specific packages for updates.

### Usage

```bash
buddy-bot check <packages...> [options]
```

### Parameters

- `<packages...>` - One or more package names to check

### Options

- `--verbose, -v` - Enable verbose logging
- `--strategy <type>` - Update strategy: major|minor|patch|all (default: all)

### Examples

```bash
# Check single package
buddy-bot check react

# Check multiple packages
buddy-bot check react typescript eslint

# Check with specific strategy
buddy-bot check react --strategy minor

# Verbose output
buddy-bot check react typescript --verbose
```

### Output

```bash
Checking specific packages: react, typescript

Found 2 updates:
  react: ^18.2.0 → ^18.3.1 (minor)
  typescript: ^5.3.3 → ^5.4.2 (minor)
```

## info

Show detailed package information.

### Usage

```bash
buddy-bot info <package> [options]
```

### Parameters

- `<package>` - Package name to get information about

### Options

- `--verbose, -v` - Enable verbose logging
- `--json` - Output in JSON format

### Examples

```bash
# Basic package info
buddy-bot info react

# Package with version
buddy-bot info typescript@latest

# JSON output
buddy-bot info react --json
```

### Output

```bash
📦 react@18.3.1
📝 React is a JavaScript library for building user interfaces.
🌐 https://react.dev
📁 https://github.com/facebook/react
⚖️  License: MIT
👤 Author: React Team
🏷️  Keywords: react, framework, javascript, library, ui
```

## versions

Show all available versions of a package.

### Usage

```bash
buddy-bot versions <package> [options]
```

### Parameters

- `<package>` - Package name to show versions for

### Options

- `--verbose, -v` - Enable verbose logging
- `--latest <count>` - Show only the latest N versions (default: 10)

### Examples

```bash
# Show recent versions
buddy-bot versions react

# Show only 5 latest versions
buddy-bot versions react --latest 5

# Show more versions
buddy-bot versions typescript --latest 20
```

### Output

```bash
📦 react - Available Versions
📈 Total: 847 versions
⭐ Latest: 18.3.1

📋 Recent versions:
⭐ 18.3.1
   18.3.0
   18.2.0
   18.1.0
   18.0.0
   17.0.2
   17.0.1
   17.0.0
   16.14.0
   16.13.1
   ... and 837 older versions
```

## latest

Get the latest version of a package.

### Usage

```bash
buddy-bot latest <package> [options]
```

### Parameters

- `<package>` - Package name to get latest version for

### Options

- `--verbose, -v` - Enable verbose logging

### Examples

```bash
# Get latest version
buddy-bot latest react

# Get latest version of scoped package
buddy-bot latest @types/node

# Verbose output
buddy-bot latest typescript --verbose
```

### Output

```bash
📦 react@18.3.1
```

## exists

Check if a package exists in the registry.

### Usage

```bash
buddy-bot exists <package> [options]
```

### Parameters

- `<package>` - Package name to check

### Options

- `--verbose, -v` - Enable verbose logging

### Examples

```bash
# Check if package exists
buddy-bot exists react

# Check non-existent package
buddy-bot exists nonexistent-package-xyz

# Verbose output
buddy-bot exists @types/react --verbose
```

### Output

```bash
# Existing package (exit code 0)
✅ Package "react" exists in the registry

# Non-existent package (exit code 1)
❌ Package "nonexistent-package-xyz" does not exist in the registry
```

## deps

Show dependencies of a package.

### Usage

```bash
buddy-bot deps <package> [options]
```

### Parameters

- `<package>` - Package name to show dependencies for

### Options

- `--verbose, -v` - Enable verbose logging
- `--dev` - Show dev dependencies
- `--peer` - Show peer dependencies
- `--all` - Show all dependency types

### Examples

```bash
# Show production dependencies
buddy-bot deps react

# Show dev dependencies
buddy-bot deps react --dev

# Show peer dependencies
buddy-bot deps react --peer

# Show all dependency types
buddy-bot deps react --all
```

### Output

```bash
📦 react@18.3.1 - Dependencies

📋 Production Dependencies (1):
  loose-envify: ^1.4.0

📋 Dev Dependencies (15):
  @babel/core: ^7.20.0
  @babel/preset-env: ^7.20.0
  eslint: ^8.0.0
  jest: ^29.0.0
  ...

📋 Peer Dependencies (0):
  No peer dependencies
```

## compare

Compare two versions of a package.

### Usage

```bash
buddy-bot compare <package> <version1> <version2> [options]
```

### Parameters

- `<package>` - Package name to compare
- `<version1>` - First version to compare
- `<version2>` - Second version to compare

### Options

- `--verbose, -v` - Enable verbose logging

### Examples

```bash
# Compare React versions
buddy-bot compare react 17.0.0 18.0.0

# Compare TypeScript versions
buddy-bot compare typescript 4.9.0 5.0.0

# Verbose comparison
buddy-bot compare react 18.2.0 18.3.1 --verbose
```

### Output

```bash
📊 Comparing react: 17.0.0 vs 18.0.0

🔍 Version Analysis:
   From: 17.0.0
   To:   18.0.0
   Type: major update
   Gap:  47 versions between them
   📈 18.0.0 is newer than 17.0.0

💡 Use 'buddy-bot versions react' to see all available versions
💡 Use 'buddy-bot info react' for detailed package information
```

## search

Search for packages in the registry.

### Usage

```bash
buddy-bot search <query> [options]
```

### Parameters

- `<query>` - Search query (can include spaces)

### Options

- `--verbose, -v` - Enable verbose logging
- `--limit <count>` - Limit number of results (default: 10)

### Examples

```bash
# Search for React packages
buddy-bot search react

# Search with multiple terms
buddy-bot search "test framework"

# Limit results
buddy-bot search react --limit 5

# Verbose search
buddy-bot search typescript --verbose
```

### Output

```bash
🔍 Searching for: "test framework"
📊 Showing top 10 results

1. 📦 jest@29.7.0
   📝 A comprehensive JavaScript testing framework
   🏷️  javascript, testing, framework

2. 📦 mocha@10.2.0
   📝 Simple, flexible, fun test framework
   🏷️  mocha, test, framework

3. 📦 vitest@1.1.0
   📝 A blazing fast unit test framework powered by Vite
   🏷️  vite, vitest, test

✨ Use 'buddy-bot info <package>' for detailed information
```

## Registry Integration

All package commands integrate with npm registry APIs to provide:

### Package Information
- **Metadata**: Description, homepage, repository, license
- **Statistics**: Download counts, popularity metrics
- **Versions**: Complete version history
- **Dependencies**: All dependency types (prod, dev, peer, optional)

### Search Capabilities
- **Text Search**: Package names and descriptions
- **Keyword Matching**: Based on package keywords
- **Popularity Ranking**: Results sorted by relevance and downloads
- **Scoped Packages**: Supports @org/package format

### Version Analysis
- **Semantic Versioning**: Proper semver comparison
- **Update Classification**: Major, minor, patch detection
- **Gap Analysis**: Version count between releases
- **Timeline Information**: Release dates and patterns

## Performance & Caching

### Registry Client Optimization
- **Parallel Requests**: Multiple packages checked simultaneously
- **Response Caching**: Intelligent caching of registry responses
- **Request Deduplication**: Avoid duplicate API calls
- **Retry Logic**: Automatic retry for failed requests

### Error Handling
- **Network Errors**: Graceful handling of connectivity issues
- **Rate Limiting**: Respect registry rate limits
- **Invalid Packages**: Clear error messages for non-existent packages
- **API Failures**: Fallback strategies for registry unavailability

## Use Cases

### Development Workflow

```bash
# Check if a package exists before adding
buddy-bot exists some-new-package

# Get package info before deciding
buddy-bot info some-new-package

# Check current versions in project
buddy-bot check react typescript eslint

# Find test frameworks
buddy-bot search "testing framework"
```

### CI/CD Integration

```bash
# Validate package existence in scripts
if buddy-bot exists "$PACKAGE_NAME"; then
  echo "Package exists, proceeding..."
else
  echo "Package not found!"
  exit 1
fi

# Get latest version for automated updates
LATEST=$(buddy-bot latest typescript | cut -d'@' -f2)
echo "Latest TypeScript: $LATEST"
```

### Package Analysis

```bash
# Compare current vs latest
CURRENT=$(grep '"typescript":' package.json | cut -d'"' -f4)
LATEST=$(buddy-bot latest typescript | cut -d'@' -f2)
buddy-bot compare typescript "$CURRENT" "$LATEST"

# Analyze dependencies
buddy-bot deps typescript --all > typescript-deps.txt
```

## Configuration

Package commands respect global configuration:

```typescript
// buddy-bot.config.ts
export default {
  verbose: true, // Affects all commands
  registry: {
    url: 'https://registry.npmjs.org', // Custom registry
    timeout: 10000, // Request timeout
    retries: 3 // Retry failed requests
  }
}
```

## Troubleshooting

### Common Issues

**Package not found:**
```bash
❌ Package "nonexistent-package" not found
```
- Verify package name spelling
- Check if package is scoped (@org/package)
- Confirm package exists on npm registry

**Network errors:**
```bash
❌ Failed to fetch package information: ENOTFOUND
```
- Check internet connectivity
- Verify registry URL accessibility
- Check firewall/proxy settings

**Rate limiting:**
```bash
❌ Registry API rate limit exceeded
```
- Wait before retrying
- Use authenticated requests if available
- Consider caching responses

### Debug Mode

Enable verbose output for debugging:

```bash
buddy-bot info react --verbose
buddy-bot search test --verbose --limit 3
```

## Integration Examples

### NPM Scripts

```json
{
  "scripts": {
    "check-deps": "buddy-bot check react typescript",
    "find-test-tools": "buddy-bot search 'testing framework' --limit 5",
    "latest-versions": "buddy-bot versions react --latest 3"
  }
}
```

### Shell Scripts

```bash
#!/bin/bash
# check-outdated.sh

PACKAGES=("react" "typescript" "eslint")

for package in "${PACKAGES[@]}"; do
  echo "Checking $package..."
  buddy-bot check "$package"
done
```
