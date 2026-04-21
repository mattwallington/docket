#!/bin/bash
# release.sh — Full release workflow for Docket
# Usage: ./scripts/release.sh [--minor|--major|--dry-run|--help]
# Default: patch bump (0.1.0 -> 0.1.1)
#
# Prerequisites:
#   - gh CLI authenticated
#   - Apple Developer ID Application cert in Keychain
#   - Env vars: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}[info]${NC}  $1"; }
success() { echo -e "${GREEN}[ok]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $1"; }
error()   { echo -e "${RED}[error]${NC} $1"; exit 1; }
step()    { echo -e "\n${BOLD}${CYAN}── $1 ──${NC}"; }
dry()     { echo -e "${YELLOW}[dry-run]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

DRY_RUN=false
BUMP_TYPE="patch"

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --minor)   BUMP_TYPE="minor" ;;
    --major)   BUMP_TYPE="major" ;;
    --help|-h)
      echo "Usage: ./scripts/release.sh [--minor|--major|--dry-run]"
      exit 0
      ;;
    *) error "Unknown argument: $arg" ;;
  esac
done

step "Preflight"
for tool in gh node npm git; do command -v "$tool" >/dev/null 2>&1 || error "$tool is not installed"; done
CURRENT_BRANCH=$(git branch --show-current)
IS_DEV=false
if [[ "$CURRENT_BRANCH" == "dev" ]]; then
  IS_DEV=true
  info "Dev branch — will build Docket Dev (pre-release)"
elif [[ "$CURRENT_BRANCH" == "main" ]]; then
  info "Main branch — production release"
else
  error "Must be on main or dev branch (currently on: $CURRENT_BRANCH)"
fi
gh auth status >/dev/null 2>&1 || error "Not authenticated with GitHub CLI. Run: gh auth login"
git diff --cached --quiet || error "You have staged changes. Commit or unstage them first."
git diff --quiet || error "You have unstaged changes. Commit or stash them first."
success "Preflight OK"

step "Version calculation"
CURRENT_VERSION=$(tr -d '[:space:]' < VERSION)
BASE_VERSION="${CURRENT_VERSION%%-*}"
IFS='.' read -r MAJOR MINOR PATCH <<< "$BASE_VERSION"
case "$BUMP_TYPE" in
  patch) NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))" ;;
  minor) NEW_VERSION="$MAJOR.$((MINOR + 1)).0" ;;
  major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
esac
if $IS_DEV; then
  DEV_BUILD=$(date +%Y%m%d%H%M)
  NEW_VERSION="${NEW_VERSION}-dev.${DEV_BUILD}"
fi
info "Current: $CURRENT_VERSION -> New: $NEW_VERSION ($BUMP_TYPE)"

if $DRY_RUN; then
  step "Dry run"
  dry "Bump VERSION + package.json to $NEW_VERSION"
  dry "Commit + tag v$NEW_VERSION"
  dry "Build arm64 + x64, sign + notarize"
  dry "Artifacts expected:"
  dry "  - dist/docket-$NEW_VERSION-arm64-mac.dmg"
  dry "  - dist/docket-$NEW_VERSION-x64-mac.dmg"
  dry "  - dist/docket-$NEW_VERSION-arm64-mac.zip"
  dry "  - dist/docket-$NEW_VERSION-x64-mac.zip"
  dry "  - dist/latest-mac.yml"
  dry "Push tag + branch"
  if $IS_DEV; then
    dry "gh release create v$NEW_VERSION --prerelease"
  else
    dry "gh release create v$NEW_VERSION"
  fi
  exit 0
fi

step "Update versions"
echo "$NEW_VERSION" > VERSION
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.version='$NEW_VERSION'; fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');"
npm install --package-lock-only --silent
success "VERSION + package.json -> $NEW_VERSION"

step "Commit + tag"
git add VERSION package.json package-lock.json
git commit -m "release: v$NEW_VERSION"
git tag "v$NEW_VERSION"

step "Build"
if $IS_DEV; then
  node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.build.appId='com.mattwallington.docket-dev'; p.build.productName='Docket Dev'; p.build.mac.icon='assets/icon-dev.icns'; fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');"
fi
export DOCKET_CHANNEL="stable"
$IS_DEV && export DOCKET_CHANNEL="dev"
node scripts/build-with-version.js
npx electron-builder --mac --arm64 --x64
if $IS_DEV; then git checkout package.json; fi
node scripts/create-installer.js
success "Build complete"

step "Locate artifacts"
DIST_DIR="$SCRIPT_DIR/dist"
ASSETS=()
for f in \
  "$DIST_DIR/docket-$NEW_VERSION-arm64-mac.zip" \
  "$DIST_DIR/docket-$NEW_VERSION-x64-mac.zip" \
  "$DIST_DIR/docket-$NEW_VERSION-arm64-mac.dmg" \
  "$DIST_DIR/docket-$NEW_VERSION-x64-mac.dmg" \
  "$DIST_DIR/latest-mac.yml"; do
  if [[ -f "$f" ]]; then
    success "Found: $(basename "$f")"
    ASSETS+=("$f")
  else
    warn "Missing: $(basename "$f")"
  fi
done

step "Push"
git push origin "$CURRENT_BRANCH"
git push origin "v$NEW_VERSION"

step "GitHub release"
RELEASE_ARGS=("v$NEW_VERSION" --title "Docket v$NEW_VERSION" --generate-notes)
$IS_DEV && RELEASE_ARGS+=(--prerelease)
gh release create "${RELEASE_ARGS[@]}" "${ASSETS[@]}"

step "Done"
echo -e "  ${GREEN}${BOLD}Docket v$NEW_VERSION released!${NC}"
