# Install

Installing `buddy` is easy. Simply pull it in via your package manager of choice, or download the binary directly.

## Package Managers

Choose your package manager of choice:

::: code-group

```sh [npm]
npm install --save-dev @stacksjs/buddy
# npm i -d @stacksjs/buddy

# or, install globally via
npm i -g @stacksjs/buddy
```

```sh [bun]
bun install --dev @stacksjs/buddy
# bun add --dev @stacksjs/buddy
# bun i -d @stacksjs/buddy

# or, install globally via
bun add --global @stacksjs/buddy
```

```sh [pnpm]
pnpm add --save-dev @stacksjs/buddy
# pnpm i -d @stacksjs/buddy

# or, install globally via
pnpm add --global @stacksjs/buddy
```

```sh [yarn]
yarn add --dev @stacksjs/buddy
# yarn i -d @stacksjs/buddy

# or, install globally via
yarn global add @stacksjs/buddy
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
