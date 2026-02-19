#!/usr/bin/env bash
set -euo pipefail

WORKFLOW_FILE="create-release-metadata.yml"
REF="${1:-master}"

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is required."
  echo "Install it: https://cli.github.com/"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Error: gh is not authenticated."
  echo "Run: gh auth login"
  exit 1
fi

echo "This will trigger '${WORKFLOW_FILE}' on ref '${REF}'."
read -r -p "Continue? [y/N] " CONFIRM

case "${CONFIRM}" in
  y|Y|yes|YES)
    gh workflow run "${WORKFLOW_FILE}" --ref "${REF}"
    echo "Release workflow dispatched."
    echo "Recent runs:"
    gh run list --workflow "${WORKFLOW_FILE}" --limit 5
    ;;
  *)
    echo "Cancelled."
    ;;
esac
