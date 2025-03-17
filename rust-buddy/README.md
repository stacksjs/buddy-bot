# Buddy CLI (Rust Version)

> The Stacks CLI implemented in Rust.

## Features

- Access to all Stacks Buddy commands
- Extremely lightweight
- Cross-platform
- Native performance with Rust
- Command proxying to original implementation

## Requirements

- Rust and Cargo installed
- A default Rust toolchain configured (`rustup default stable`)

## Building

```bash
cd rust-buddy
cargo build --release
```

The compiled binary will be available at `target/release/buddy`.

## Build Options

### Simple Build (Recommended)

The simple build script will build for the current platform only:

```bash
./build-simple.sh
```

With the `--all` flag, it will also create a platform-specific binary:

```bash
./build-simple.sh --all
```

This will create:

- `../bin/buddy-rust` - The main binary
- `../bin/buddy-rust-[platform]` - Platform-specific binary (e.g., `buddy-rust-darwin-arm64` for macOS ARM64)

### Advanced Build (Experimental)

The advanced build script attempts to use cross-compilation with cargo-zigbuild:

```bash
# Install cargo-zigbuild
cargo install cargo-zigbuild

# Install required targets
rustup target add x86_64-unknown-linux-gnu
rustup target add aarch64-unknown-linux-gnu
rustup target add x86_64-pc-windows-msvc
rustup target add x86_64-apple-darwin
rustup target add aarch64-apple-darwin

# Run the advanced build
./build.sh --all
```

Note: Cross-compilation may not work on all systems and requires additional dependencies.

## Usage

```bash
# Create a new Stacks project
./buddy new my-project

# Change to a different Stacks project
./buddy cd <project>

# Show the CLI version
./buddy version

# Show help
./buddy help
```

## Command Proxying

The CLI is designed to proxy any undefined commands to the original `./buddy` script. This means that if you run a command that is not explicitly defined in the Rust version, it will automatically fall back to the original implementation.

This allows for a seamless transition between the two versions and ensures that all commands continue to work as expected.

## License

The MIT License (MIT). Please see [LICENSE](https://github.com/stacksjs/stacks/tree/main/LICENSE.md) for more information.

Made with 💙
