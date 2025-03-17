<p align="center"><img src="https://github.com/stacksjs/buddy/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# Buddy

> The Stacks CLI.

## Features

- Access to all Stacks Buddy commands
- Extremely lightweight
- Cross-platform
- No dependencies
- Multiple implementation options (JavaScript, QuickJS, Rust)

## Install

```bash
bun install -d @stacksjs/buddy
```

<!-- _Alternatively, you can install:_

```bash
brew install buddy # wip
pkgx install buddy # wip
``` -->

## Usage

```bash
buddy new my-project
buddy help
buddy version
```

## Build From Source

```bash
# Build the JavaScript version
bun run compile

# Build the Rust version
bun run compile:rust
```

> [!NOTE]
> QuickJS is required to build the JavaScript CLI. Soon, we expect to require it as a dependency via pkgx.

## Implementation Options

### JavaScript (QuickJS)

The CLI is implemented in JavaScript and can be compiled to a standalone executable using QuickJS.

```bash
# Build the JavaScript version
bun run compile

# Build for all platforms
bun run compile:all
```

### Rust

The CLI is also implemented in Rust for native performance and smaller binary size.

```bash
# Build the Rust version for current platform
bun run compile:rust

# Build for current platform + all platform binaries
bun run compile:rust:all
```

The Rust version is available at `bin/buddy-rust` and platform-specific binaries will be created at `bin/buddy-rust-[platform]` (e.g., `bin/buddy-rust-darwin-arm64` for macOS ARM64).

For cross-compilation, you'll need to set up Rust properly:

```bash
# Set up default toolchain
rustup default stable

# Install cargo-zigbuild for cross-compilation
cargo install cargo-zigbuild

# Install required targets
rustup target add x86_64-unknown-linux-gnu
rustup target add aarch64-unknown-linux-gnu
rustup target add x86_64-pc-windows-msvc
rustup target add x86_64-apple-darwin
rustup target add aarch64-apple-darwin
```

Note: Cross-compilation may not work on all systems and requires additional dependencies.

### Wrapper Script

A wrapper script is provided that can choose between the JavaScript and Rust versions:

```bash
# Use the JavaScript version (default)
./buddy-wrapper

# Use the Rust version with a flag
./buddy-wrapper --use-rust

# Use the Rust version with an environment variable
BUDDY_USE_RUST=true ./buddy-wrapper
```

The wrapper script will:

1. Use the Rust version if `--use-rust` flag is provided or `BUDDY_USE_RUST=true` environment variable is set
2. Fall back to the QuickJS version if available
3. Fall back to the original JavaScript implementation if neither is available

## Testing

```bash
bun test
```

## Changelog

Please see our [releases](https://github.com/stacksjs/stacks/releases) page for more information on what has changed recently.

## Contributing

Please review the [Contributing Guide](https://github.com/stacksjs/contributing) for details.

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/stacks/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://discord.gg/stacksjs)

## Postcardware

Two things are true: Stacks OSS will always stay open-source, and we do love to receive postcards from wherever Stacks is used! 🌍 _We also publish them on our website. And thank you, Spatie_

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## Credits

- [Chris Breuer](https://github.com/chrisbbreuer)
- [All Contributors](../../contributors)

## License

The MIT License (MIT). Please see [LICENSE](https://github.com/stacksjs/stacks/tree/main/LICENSE.md) for more information.

Made with 💙

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/@stacksjs/buddy?style=flat-square
[npm-version-href]: https://npmjs.com/package/@stacksjs/buddy
[github-actions-src]: https://img.shields.io/github/actions/workflow/status/stacksjs/buddy/ci.yml?style=flat-square&branch=main
[github-actions-href]: https://github.com/stacksjs/buddy/actions?query=workflow%3Aci

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/buddy/main?style=flat-square
[codecov-href]: https://codecov.io/gh/stacksjs/buddy -->
