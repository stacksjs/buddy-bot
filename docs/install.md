# Installation

Installing `buddy-bot` is easy. Simply pull it in via your package manager of choice, or download the binary directly.

## Package Managers

Choose your package manager of choice:

::: code-group

```sh [npm]
npm install --save-dev buddy-bot
# npm i -d buddy-bot

# or, install globally via
npm i -g buddy-bot
```

```sh [bun]
bun install --dev buddy-bot
# bun add --dev buddy-bot
# bun i -d buddy-bot

# or, install globally via
bun add --global buddy-bot
```

```sh [pnpm]
pnpm add --save-dev buddy-bot
# pnpm i -d buddy-bot

# or, install globally via
pnpm add --global buddy-bot
```

```sh [yarn]
yarn add --dev buddy-bot
# yarn i -d buddy-bot

# or, install globally via
yarn global add buddy-bot
```

```sh [brew]
brew install buddy-bot # coming soon
```

```sh [pkgx]
pkgx buddy-bot # coming soon
```

:::

## Prerequisites

Buddy-bot requires:

- **Bun** - The fast package manager and runtime
- **Node.js** 18+ (for compatibility)
- **Git** - For repository operations

### Install Bun

If you don't have Bun installed:

::: code-group

```sh [macOS/Linux]
curl -fsSL https://bun.sh/install | bash
```

```sh [Windows]
powershell -c "irm bun.sh/install.ps1 | iex"
```

```sh [npm]
npm install -g bun
```

:::

## Binaries

Choose the binary that matches your platform and architecture:

::: code-group

```sh [macOS (arm64)]
# Download the binary
curl -L https://github.com/stacksjs/buddy-bot/releases/download/v0.9.1/buddy-bot-darwin-arm64 -o buddy-bot

# Make it executable
chmod +x buddy-bot

# Move it to your PATH
mv buddy-bot /usr/local/bin/buddy-bot
```

```sh [macOS (x64)]
# Download the binary
curl -L https://github.com/stacksjs/buddy-bot/releases/download/v0.9.1/buddy-bot-darwin-x64 -o buddy-bot

# Make it executable
chmod +x buddy-bot

# Move it to your PATH
mv buddy-bot /usr/local/bin/buddy-bot
```

```sh [Linux (arm64)]
# Download the binary
curl -L https://github.com/stacksjs/buddy-bot/releases/download/v0.9.1/buddy-bot-linux-arm64 -o buddy-bot

# Make it executable
chmod +x buddy-bot

# Move it to your PATH
mv buddy-bot /usr/local/bin/buddy-bot
```

```sh [Linux (x64)]
# Download the binary
curl -L https://github.com/stacksjs/buddy-bot/releases/download/v0.9.1/buddy-bot-linux-x64 -o buddy-bot

# Make it executable
chmod +x buddy-bot

# Move it to your PATH
mv buddy-bot /usr/local/bin/buddy-bot
```

```sh [Windows (x64)]
# Download the binary
curl -L https://github.com/stacksjs/buddy-bot/releases/download/v0.9.1/buddy-bot-windows-x64.exe -o buddy-bot.exe

# Move it to your PATH (adjust the path as needed)
move buddy-bot.exe C:\Windows\System32\buddy-bot.exe
```

:::

::: tip
You can also find the `buddy-bot` binaries in GitHub [releases](https://github.com/stacksjs/buddy-bot/releases).
:::

## GitHub Setup

### For GitHub Actions (Recommended)

When using buddy-bot in GitHub Actions, you don't need a personal token. Just configure proper workflow permissions:

```yaml
name: Dependency Updates
on:
  schedule:
    - cron: '0 2 * * 1'

jobs:
  update:
    runs-on: ubuntu-latest
    permissions:
      contents: write        # Read repository and write changes
      pull-requests: write   # Create and update pull requests
      actions: write         # Update workflow files (optional)

    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bunx buddy-bot update
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} # Built-in token
```

The `GITHUB_TOKEN` is automatically provided by GitHub Actions with the permissions you specify.

### For Local Development (Optional)

If you want to run buddy-bot locally to create PRs, you'll need a personal access token:

#### Personal Access Token (Classic)

1. Go to [GitHub Settings > Personal Access Tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Select scopes:
   - `repo` - Full repository access
   - `workflow` - Update GitHub Actions workflows (optional)
4. Set as environment variable:

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

#### Fine-grained Personal Access Token

1. Go to [GitHub Settings > Personal Access Tokens (fine-grained)](https://github.com/settings/personal-access-tokens/new)
2. Select repository access and grant permissions:
   - **Contents**: Read and Write
   - **Pull requests**: Write
   - **Metadata**: Read

## Verification

Verify your installation:

```bash
# Check version
buddy-bot --version

# Test GitHub authentication
buddy-bot scan --verbose

# Generate sample configuration
buddy-bot init
```

## IDE Integration

### VS Code

Install the Bun extension for better TypeScript support:

```bash
code --install-extension oven.bun-vscode
```

### Configuration Files

Buddy-bot will automatically detect and use:

- `buddy-bot.config.ts` (TypeScript)
- `buddy-bot.config.js` (JavaScript)
- `buddy-bot.config.json` (JSON)

## Docker Support

Run buddy-bot in a container:

```dockerfile
FROM oven/bun:latest

WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install

COPY . .
RUN bun install -g buddy-bot

CMD ["buddy-bot", "scan"]
```

## CI/CD Setup

### GitHub Actions

```yaml
name: Dependency Updates
on:
  schedule:
    - cron: '0 2 * * 1' # Weekly on Monday

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bunx buddy-bot update
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### GitLab CI

```yaml
dependency-updates:
  image: oven/bun:latest
  script:
    - bun install
    - bunx buddy-bot update
  only:
    - schedules
  variables:
    GITLAB_TOKEN: $CI_JOB_TOKEN
```

## Troubleshooting

### Common Issues

**Bun not found:**
```bash
# Add Bun to PATH
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

**GitHub token issues:**
```bash
# Test token permissions
gh auth status
# or
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user
```

**Package not found:**
```bash
# Clear package cache
bun pm cache rm
# Reinstall
bun install
```

Read more about how to use it in the [Usage](/usage) section of the documentation.
