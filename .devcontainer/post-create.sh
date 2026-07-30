#!/usr/bin/env bash

set -euo pipefail

readonly SAFE_DIRECTORY="/workspaces/Coralie_Core"
readonly CODEX_HOME_DIRECTORY="${HOME}/.codex"
readonly UV_BIN_DIRECTORY="${HOME}/.local/bin"

if ! git config --global --get-all safe.directory 2>/dev/null |
  grep -Fxq "${SAFE_DIRECTORY}"; then
  git config --global --add safe.directory "${SAFE_DIRECTORY}"
fi

if [[ ! -d "${CODEX_HOME_DIRECTORY}" ||
      ! -w "${CODEX_HOME_DIRECTORY}" ]]; then
  printf '%s\n' \
    "Codex home is not writable: ${CODEX_HOME_DIRECTORY}" \
    "Initialize ownership of the coralie-core-codex-home volume on the host, then reopen the project in Zed." \
    >&2
  exit 1
fi

if ! command -v codex >/dev/null 2>&1; then
  npm install --global @openai/codex
fi

if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh |
    env UV_INSTALL_DIR="${UV_BIN_DIRECTORY}" UV_NO_MODIFY_PATH=1 sh
fi

export PATH="${UV_BIN_DIRECTORY}:${PATH}"

if ! command -v serena >/dev/null 2>&1; then
  uv tool install --python 3.13 serena-agent
fi

if [[ ! -f "${HOME}/.serena/serena_config.yml" ]]; then
  serena init
fi

if codex mcp get github >/dev/null 2>&1; then
  codex mcp remove github
fi

serena setup codex

if codex mcp get github >/dev/null 2>&1; then
  printf '%s\n' "GitHub MCP remains configured unexpectedly." >&2
  exit 1
fi

if ! codex mcp get serena >/dev/null 2>&1; then
  printf '%s\n' "Serena MCP was not configured successfully." >&2
  exit 1
fi
