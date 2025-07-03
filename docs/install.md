# Install

Installing `buddy` is easy. Simply pull it in via your package manager of choice, or download the binary directly.

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
brew install buddy # coming soon
```

```sh [pkgx]
pkgx buddy # coming soon
```

:::

Read more about how to use it in the Usage section of the documentation.

## Binaries

Choose the binary that matches your platform and architecture:

::: code-group

```sh [macOS (arm64)]
# Download the binary
curl -L https://github.com/stacksjs/buddy/releases/download/v0.9.1/buddy-darwin-arm64 -o buddy

# Make it executable
chmod +x buddy

# Move it to your PATH
mv buddy /usr/local/bin/buddy
```

```sh [macOS (x64)]
# Download the binary
curl -L https://github.com/stacksjs/buddy/releases/download/v0.9.1/buddy-darwin-x64 -o buddy

# Make it executable
chmod +x buddy

# Move it to your PATH
mv buddy /usr/local/bin/buddy
```

```sh [Linux (arm64)]
# Download the binary
curl -L https://github.com/stacksjs/buddy/releases/download/v0.9.1/buddy-linux-arm64 -o buddy

# Make it executable
chmod +x buddy

# Move it to your PATH
mv buddy /usr/local/bin/buddy
```

```sh [Linux (x64)]
# Download the binary
curl -L https://github.com/stacksjs/buddy/releases/download/v0.9.1/buddy-linux-x64 -o buddy

# Make it executable
chmod +x buddy

# Move it to your PATH
mv buddy /usr/local/bin/buddy
```

```sh [Windows (x64)]
# Download the binary
curl -L https://github.com/stacksjs/buddy/releases/download/v0.9.1/buddy-windows-x64.exe -o buddy.exe

# Move it to your PATH (adjust the path as needed)
move buddy.exe C:\Windows\System32\buddy.exe
```

::: tip
You can also find the `buddy` binaries in GitHub [releases](https://github.com/stacksjs/buddy/releases).
:::
