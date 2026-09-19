#!/usr/bin/env bash
# Derives the version for an auto-published dev build from the manifest
# version and the workflow run number, and writes `version` and `tag` in
# GitHub Actions output format.
#
# The minor component is bumped so the result outranks the released version:
# `1.2.0-mike.7` would be a PRERELEASE of 1.2.0 and therefore sort BELOW it,
# so the updater would never offer it to an app on 1.2.0. `1.3.0-mike.7`
# sorts above 1.2.0, above every earlier dev build, and below a real 1.3.0.
#
# Manifests are deliberately left untouched: dev builds take their version
# from `--config` at bundle time, and only tagged releases bump the manifest.
#
# Usage: .github/scripts/dev-version.sh <run-number>
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <run-number>" >&2
  exit 2
fi

RUN_NUMBER="$1"
BASE=$(jq -r '.version' client/src-tauri/tauri.conf.json)

if ! [[ "$BASE" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "::error::Manifest version '$BASE' is not a plain MAJOR.MINOR.PATCH version." >&2
  exit 1
fi

VERSION="${BASH_REMATCH[1]}.$((BASH_REMATCH[2] + 1)).0-mike.${RUN_NUMBER}"

echo "version=$VERSION"
echo "tag=v$VERSION"
