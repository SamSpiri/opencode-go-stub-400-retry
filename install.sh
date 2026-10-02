#!/usr/bin/env sh
# Install opencode-go-stub-retry into the OpenCode global plugins directory.
#
#   ./install.sh                              # from a checkout
#   curl -fsSL <raw-url>/install.sh | sh      # on a remote machine
set -eu

file=opencode-go-stub-retry.ts
dest="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/$file"
src="$(dirname "$0")/$file"

mkdir -p "$(dirname "$dest")"
if [ -f "$src" ]; then
  cp "$src" "$dest"
else
  curl -fsSL "https://raw.githubusercontent.com/SamSpiri/opencode-go-stub-400-retry/main/$file" -o "$dest"
fi
echo "installed $dest"
