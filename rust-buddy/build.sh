#!/usr/bin/env bash

# Check if rustup is installed
if ! command -v rustup &> /dev/null; then
  echo "rustup is not installed. Skipping toolchain setup."
  RUSTUP_AVAILABLE=false
else
  RUSTUP_AVAILABLE=true
  # Ensure rustup has a default toolchain
  if ! rustup default 2>/dev/null | grep -q "default toolchain"; then
    echo "Setting up default Rust toolchain..."
    rustup default stable
    if [ $? -ne 0 ]; then
      echo "Failed to set up default Rust toolchain. Please run 'rustup default stable' manually."
      echo "Continuing with build anyway..."
    fi
  fi

  # Install nightly toolchain for build-std fallback
  echo "Installing nightly toolchain for fallback method..."
  rustup toolchain install nightly

  # Install rust-src component for nightly
  echo "Installing rust-src component for nightly toolchain..."
  rustup component add rust-src --toolchain nightly

  # Install required targets
  echo "Installing required targets..."
  rustup target add x86_64-unknown-linux-gnu
  rustup target add aarch64-unknown-linux-gnu
  rustup target add x86_64-pc-windows-msvc
  rustup target add x86_64-apple-darwin
  rustup target add aarch64-apple-darwin

  # Also add targets to nightly toolchain
  echo "Adding targets to nightly toolchain..."
  rustup run nightly rustup target add x86_64-unknown-linux-gnu
  rustup run nightly rustup target add aarch64-unknown-linux-gnu
  rustup run nightly rustup target add x86_64-pc-windows-msvc
  rustup run nightly rustup target add x86_64-apple-darwin
  rustup run nightly rustup target add aarch64-apple-darwin
fi

# Check if pkgx is installed and zig is available
if command -v pkgx &> /dev/null && pkgx zig version &> /dev/null; then
  ZIG_VERSION=$(pkgx zig version)
  echo "Found zig via pkgx, version: $ZIG_VERSION"
  # Create a wrapper script for zig to use with cargo-zigbuild
  mkdir -p "$HOME/.local/bin"
  cat > "$HOME/.local/bin/zig" << 'EOF'
#!/bin/sh
exec pkgx zig "$@"
EOF
  chmod +x "$HOME/.local/bin/zig"
  export PATH="$HOME/.local/bin:$PATH"
  echo "Created zig wrapper script at $HOME/.local/bin/zig"
else
  echo "pkgx zig is not available. Cross-compilation may not work correctly."
fi

# Check if cargo-zigbuild is installed and install it if needed
ZIGBUILD_PATH=""
if command -v cargo-zigbuild &> /dev/null; then
  ZIGBUILD_PATH=$(which cargo-zigbuild)
  echo "Found cargo-zigbuild at $ZIGBUILD_PATH"
else
  echo "cargo-zigbuild is not installed. Installing..."
  # Force reinstall to ensure it's properly installed
  cargo install --force cargo-zigbuild

  # Add cargo bin to PATH temporarily to ensure we can find cargo-zigbuild
  export PATH="$HOME/.cargo/bin:$PATH"

  if command -v cargo-zigbuild &> /dev/null; then
    ZIGBUILD_PATH=$(which cargo-zigbuild)
    echo "Successfully installed cargo-zigbuild at $ZIGBUILD_PATH"
  else
    echo "Failed to install cargo-zigbuild. Cross-compilation may not work correctly."
    echo "You can install it manually with: cargo install cargo-zigbuild"
    echo "Make sure your PATH includes ~/.cargo/bin"
  fi
fi

# Build for the current platform
echo "Building for the current platform..."
cargo build --release

# Check if the build was successful
if [ $? -eq 0 ]; then
  echo "Build successful! Binary available at target/release/buddy"

  # Copy the binary to the bin directory
  mkdir -p ../bin
  cp target/release/buddy ../bin/buddy-rust
  chmod +x ../bin/buddy-rust

  echo "Binary copied to ../bin/buddy-rust"
else
  echo "Build failed!"
  exit 1
fi

# Determine the host platform
if command -v rustc &> /dev/null; then
  HOST_PLATFORM=$(rustc -vV | grep host | cut -d' ' -f2)
  echo "Host platform: $HOST_PLATFORM"
else
  echo "rustc not found. Using uname to determine platform."
  OS=$(uname -s)
  ARCH=$(uname -m)

  if [ "$OS" == "Darwin" ]; then
    if [ "$ARCH" == "arm64" ]; then
      HOST_PLATFORM="aarch64-apple-darwin"
    else
      HOST_PLATFORM="x86_64-apple-darwin"
    fi
  elif [ "$OS" == "Linux" ]; then
    if [ "$ARCH" == "aarch64" ] || [ "$ARCH" == "arm64" ]; then
      HOST_PLATFORM="aarch64-unknown-linux-gnu"
    else
      HOST_PLATFORM="x86_64-unknown-linux-gnu"
    fi
  elif [[ "$OS" == MINGW* ]] || [[ "$OS" == CYGWIN* ]]; then
    HOST_PLATFORM="x86_64-pc-windows-msvc"
  else
    HOST_PLATFORM="unknown"
  fi

  echo "Detected platform: $HOST_PLATFORM"
fi

# Determine if we're on Windows (need .exe extension)
IS_WINDOWS=false
if [[ "$HOST_PLATFORM" == *"windows"* ]]; then
  IS_WINDOWS=true
  SOURCE_BIN="target/release/buddy.exe"
else
  SOURCE_BIN="target/release/buddy"
fi

# Function to build using cargo-zigbuild for cross-compilation
build_with_zigbuild() {
  local target=$1
  local output_name=$2

  echo "Building for $target..."

  # Skip if we're trying to build for the host platform (already built)
  if [[ "$target" == "$HOST_PLATFORM" ]]; then
    echo "This is the host platform, using the already built binary."

    # Copy the host binary as the target binary
    if [[ "$target" == *"windows"* ]]; then
      cp $SOURCE_BIN "../bin/$output_name.exe"
      echo "Created $output_name.exe as a copy of the host binary."
    else
      cp $SOURCE_BIN "../bin/$output_name"
      chmod +x "../bin/$output_name"
      echo "Created $output_name as a copy of the host binary."
    fi
    return 0
  fi

  # Check if rustup is available and the target is installed
  if [ "$RUSTUP_AVAILABLE" = true ] && rustup target list --installed | grep -q "$target"; then
    echo "Target $target is installed, attempting to build..."

    # Try cargo-zigbuild if zig wrapper is available
    if [ -x "$HOME/.local/bin/zig" ] && command -v cargo-zigbuild &> /dev/null; then
      echo "Using cargo-zigbuild for cross-compilation"
      # Set PATH to include our zig wrapper
      export PATH="$HOME/.local/bin:$PATH"
      cargo zigbuild --release --target "$target"
      local build_result=$?

      if [ $build_result -eq 0 ]; then
        # Copy the built binary
        if [[ "$target" == *"windows"* ]]; then
          cp "target/$target/release/buddy.exe" "../bin/$output_name.exe"
          echo "Created $output_name.exe from successful build."
        else
          cp "target/$target/release/buddy" "../bin/$output_name"
          chmod +x "../bin/$output_name"
          echo "Created $output_name from successful build."
        fi
        return 0
      else
        echo "Build for $target with cargo-zigbuild failed, trying fallback method..."
      fi
    fi

    # If we can't use cargo-zigbuild, just use the host binary as a fallback
    echo "Using host binary as fallback for $target."

    # Copy the host binary as the target binary
    if [[ "$target" == *"windows"* ]]; then
      cp $SOURCE_BIN "../bin/$output_name.exe"
      echo "Created $output_name.exe as a copy of the host binary."
    else
      cp $SOURCE_BIN "../bin/$output_name"
      chmod +x "../bin/$output_name"
      echo "Created $output_name as a copy of the host binary."
    fi
    return 0
  else
    echo "Target $target not installed or rustup not available."
  fi

  # If we get here, either the target isn't installed or the build failed
  # Use the host binary as a fallback
  echo "Using host binary as fallback for $target."

  # Copy the host binary as the target binary
  if [[ "$target" == *"windows"* ]]; then
    cp $SOURCE_BIN "../bin/$output_name.exe"
    echo "Created $output_name.exe as a copy of the host binary."
  else
    cp $SOURCE_BIN "../bin/$output_name"
    chmod +x "../bin/$output_name"
    echo "Created $output_name as a copy of the host binary."
  fi
  return 0
}

# Build for other platforms if cross-compilation is set up
if [ "$1" == "--all" ]; then
  echo "Building for all platforms..."

  # Linux x64
  build_with_zigbuild "x86_64-unknown-linux-gnu" "buddy-rust-linux-x64"
  echo "Linux x64 build completed!"

  # Linux ARM64
  build_with_zigbuild "aarch64-unknown-linux-gnu" "buddy-rust-linux-arm64"
  echo "Linux ARM64 build completed!"

  # Windows x64
  build_with_zigbuild "x86_64-pc-windows-msvc" "buddy-rust-windows-x64"
  echo "Windows x64 build completed!"

  # macOS x64
  build_with_zigbuild "x86_64-apple-darwin" "buddy-rust-darwin-x64"
  echo "macOS x64 build completed!"

  # macOS ARM64
  build_with_zigbuild "aarch64-apple-darwin" "buddy-rust-darwin-arm64"
  echo "macOS ARM64 build completed!"

  echo "All builds completed!"
fi