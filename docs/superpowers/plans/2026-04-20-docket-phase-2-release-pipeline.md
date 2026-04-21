# Docket Phase 2 — Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship docket as a signed, notarized `.dmg` that installs cleanly via double-click, with in-app auto-updates. Mirror the repo-radar release pipeline.

**Architecture:** `electron-builder` for packaging + Apple code-signing + notarization. `electron-updater` for auto-update client. GitHub Releases as the update manifest host. A `release.sh` ported from repo-radar drives version bumping, building, publishing, and tagging. `main` branch → stable channel; `dev` branch → pre-release channel with a distinct `appId`/productName/icon so both variants coexist on one Mac.

**Tech Stack:** electron-builder 24.x, electron-updater 6.x, `gh` CLI, Apple Developer ID cert in Keychain.

**Reference:**
- Spec: `docs/superpowers/specs/2026-04-20-docket-electron-design.md` (Phase 2 section)
- Prior art: `~/Development/Reperio/repos/repo-radar/menubar/package.json`, `entitlements.plist`, `release.sh`, `main.js` (auto-update block)
- Phase 1 plan: `docs/superpowers/plans/2026-04-20-docket-phase-1-viewer.md`

**Prerequisites:**
- Phase 1 is merged and functional.
- Apple Developer ID Application cert in Keychain: `"Matthew Wallington (5S875AN2HU)"`.
- Env vars for notarization available when running `release.sh`: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID=5S875AN2HU`.
- `gh` CLI authenticated.
- A GitHub repo at `github.com/mattwallington/docket`.

---

## File Structure

**Created:**
- `VERSION` (Task 1)
- `entitlements.plist` (Task 3)
- `assets/icon.icns` (Task 2 — high-quality app icon)
- `assets/icon-dev.icns` (Task 2 — dev channel icon)
- `scripts/release.sh` (Task 7)
- `scripts/create-installer.js` (Task 7)
- `scripts/build-with-version.js` (Task 7)
- `build-info.json` (written at build time — gitignored)

**Modified:**
- `package.json` (Tasks 3, 6 — add `build` config + `electron-updater` dep)
- `main.js` (Tasks 5, 6 — add `build-info.json` loader, single-instance lock, auto-updater)
- `renderer/settings.js` (Task 6 — wire "Check for updates" button)
- `preload.js` (Task 6 — expose `checkForUpdates`)
- `.gitignore` (Task 1 — add `build-info.json`, `dist/`)

---

## Task 1: Add VERSION file + gitignore updates

**Files:**
- Create: `VERSION`
- Modify: `.gitignore`

- [ ] **Step 1: Create VERSION**

```bash
cd ~/Development/docket && echo "0.1.0" > VERSION
```

- [ ] **Step 2: Update .gitignore**

Append to `~/Development/docket/.gitignore`:
```
build-info.json
dist/
```

- [ ] **Step 3: Commit**

```bash
cd ~/Development/docket
git add VERSION .gitignore
git commit -m "chore: add VERSION file and ignore dist/ and build-info.json"
```

---

## Task 2: Create app icons

**Files:**
- Create: `assets/icon.icns` (stable channel — replaces placeholder icon.png)
- Create: `assets/icon-dev.icns` (dev channel)
- Create: `assets/icon.png` (1024×1024 source — only if you want to regenerate later)

- [ ] **Step 1: Produce a 1024×1024 source PNG**

Any tool works. Example if you have a square design PNG at `assets/source.png`:

```bash
cd ~/Development/docket
sips -z 1024 1024 assets/icon.png --out assets/icon-1024.png
```

If you don't have a design yet, generate a placeholder with a D on a dark background using ImageMagick:

```bash
brew install imagemagick 2>/dev/null || true
cd ~/Development/docket
magick -size 1024x1024 xc:'#0b0f19' \
  -fill '#7b93ff' -gravity center -pointsize 640 -font 'SF-Pro-Display-Bold' -annotate 0 'D' \
  assets/icon-1024.png
magick -size 1024x1024 xc:'#0b0f19' \
  -fill '#ff9e4f' -gravity center -pointsize 640 -font 'SF-Pro-Display-Bold' -annotate 0 'D' \
  assets/icon-dev-1024.png
```

- [ ] **Step 2: Convert to .icns**

macOS ships `iconutil` for this. Create an iconset, populate it, convert:

```bash
cd ~/Development/docket
mkdir -p assets/icon.iconset
for size in 16 32 64 128 256 512 1024; do
  sips -z "$size" "$size" assets/icon-1024.png --out "assets/icon.iconset/icon_${size}x${size}.png" >/dev/null
  if [ "$size" -lt 1024 ]; then
    double=$((size * 2))
    sips -z "$double" "$double" assets/icon-1024.png --out "assets/icon.iconset/icon_${size}x${size}@2x.png" >/dev/null
  fi
done
iconutil -c icns assets/icon.iconset -o assets/icon.icns
rm -rf assets/icon.iconset

mkdir -p assets/icon-dev.iconset
for size in 16 32 64 128 256 512 1024; do
  sips -z "$size" "$size" assets/icon-dev-1024.png --out "assets/icon-dev.iconset/icon_${size}x${size}.png" >/dev/null
  if [ "$size" -lt 1024 ]; then
    double=$((size * 2))
    sips -z "$double" "$double" assets/icon-dev-1024.png --out "assets/icon-dev.iconset/icon_${size}x${size}@2x.png" >/dev/null
  fi
done
iconutil -c icns assets/icon-dev.iconset -o assets/icon-dev.icns
rm -rf assets/icon-dev.iconset
```

- [ ] **Step 3: Remove placeholder PNG**

```bash
cd ~/Development/docket
rm -f assets/icon.png
```

- [ ] **Step 4: Commit**

```bash
cd ~/Development/docket
git add assets/
git commit -m "chore: add stable and dev channel app icons (.icns)"
```

---

## Task 3: entitlements.plist + electron-builder config in package.json

**Files:**
- Create: `entitlements.plist`
- Modify: `package.json`

- [ ] **Step 1: Write entitlements.plist**

Create `~/Development/docket/entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

- [ ] **Step 2: Add `build` config to package.json**

Open `~/Development/docket/package.json`. Add this top-level `build` key alongside `scripts`:

```json
"build": {
  "appId": "com.mattwallington.docket",
  "productName": "Docket",
  "publish": {
    "provider": "github",
    "owner": "mattwallington",
    "repo": "docket"
  },
  "artifactName": "${name}-${version}-${arch}-${os}.${ext}",
  "mac": {
    "category": "public.app-category.productivity",
    "identity": "Matthew Wallington (5S875AN2HU)",
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "entitlements.plist",
    "entitlementsInherit": "entitlements.plist",
    "notarize": {
      "teamId": "5S875AN2HU"
    },
    "target": [
      { "target": "dir",  "arch": ["arm64", "x64"] },
      { "target": "dmg",  "arch": ["arm64", "x64"] },
      { "target": "zip",  "arch": ["arm64", "x64"] }
    ],
    "icon": "assets/icon.icns"
  },
  "files": [
    "**/*",
    "!scripts/create-installer.js",
    "!test/**",
    "!docs/**",
    "build-info.json"
  ],
  "directories": {
    "output": "dist"
  }
}
```

Also add `electron-builder` to `devDependencies`:

```json
"devDependencies": {
  "electron": "^32.0.0",
  "electron-builder": "^24.9.1"
}
```

Run `npm install`.

- [ ] **Step 3: Commit**

```bash
cd ~/Development/docket
git add entitlements.plist package.json package-lock.json
git commit -m "feat(build): add electron-builder config, entitlements, and notarize settings"
```

---

## Task 4: Dry-run build to validate config

- [ ] **Step 1: Build unsigned (local dry run)**

Temporarily bypass signing to confirm the rest of the config is correct:

```bash
cd ~/Development/docket
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --dir
```

Expected: `dist/mac-arm64/Docket.app` exists. No sign/notarize step. No errors about missing icons, missing entitlements, or missing files.

- [ ] **Step 2: Smoke-launch the built app**

```bash
open ~/Development/docket/dist/mac-arm64/Docket.app
```

Expected: window opens, renders sidebar. First-run seeding creates `~/.docket/` (or reuses it). Quit.

- [ ] **Step 3: No commit**

This task is verification only. Clean up: `rm -rf dist/`.

---

## Task 5: Single-instance lock + build-info loader in main.js

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Add build-info loader + IS_DEV_BUILD constant**

Near the top of `main.js` (after imports, before `app` lifecycle), insert:

```javascript
// ---- Build info ----
const BUILD_INFO = (() => {
  try {
    const p = path.join(__dirname, 'build-info.json');
    if (fsSync.existsSync(p)) return JSON.parse(fsSync.readFileSync(p, 'utf8'));
  } catch {}
  return { version: require('./package.json').version, channel: 'stable', buildDate: null };
})();
const IS_DEV_BUILD = BUILD_INFO.channel === 'dev';
```

Add `const fsSync = require('fs');` at the top of `main.js` if not already present.

- [ ] **Step 2: Update `docket:getVersion` IPC to use BUILD_INFO**

Find:
```javascript
ipcMain.handle('docket:getVersion', async () => {
  const pkg = require('./package.json');
  return { version: pkg.version, channel: 'stable', buildDate: null };
});
```

Replace with:
```javascript
ipcMain.handle('docket:getVersion', async () => ({
  version: BUILD_INFO.version,
  channel: BUILD_INFO.channel,
  buildDate: BUILD_INFO.buildDate
}));
```

- [ ] **Step 3: Add single-instance lock**

Near the top of `main.js` (after `BUILD_INFO` / `IS_DEV_BUILD`):

```javascript
const APP_LOCK_ID = IS_DEV_BUILD ? 'docket-dev' : 'docket';
const gotTheLock = app.requestSingleInstanceLock({ appId: APP_LOCK_ID });
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
```

- [ ] **Step 4: Commit**

```bash
cd ~/Development/docket
git add main.js
git commit -m "feat: load build-info.json and add single-instance lock per channel"
```

---

## Task 6: electron-updater integration

**Files:**
- Modify: `package.json` (add `electron-updater` dep)
- Modify: `main.js` (install updater, dialog flow, periodic check)
- Modify: `preload.js` (expose `checkForUpdates`)
- Modify: `renderer/settings.js` (wire About pane button)

- [ ] **Step 1: Install electron-updater**

```bash
cd ~/Development/docket
npm install --save electron-updater@^6.8.0
```

- [ ] **Step 2: Add auto-updater setup in main.js**

Add to `main.js` imports:
```javascript
const { autoUpdater } = require('electron-updater');
const { Notification } = require('electron');
```

(If `Notification` isn't part of the existing import line, add it.)

Near the bottom of `main.js` (after IPC handlers, before `app.whenReady()`), add:

```javascript
function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = IS_DEV_BUILD;

  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Docket${IS_DEV_BUILD ? ' Dev' : ''} v${info.version} is available`,
      detail: `You are currently running v${app.getVersion()}. Download now?`,
      buttons: ['Download', 'Later'],
      defaultId: 0
    }).then((r) => {
      if (r.response === 0) {
        autoUpdater.downloadUpdate();
        if (Notification.isSupported()) {
          new Notification({ title: 'Docket', body: 'Downloading update in the background…' }).show();
        }
      }
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `Docket v${info.version} has been downloaded`,
      detail: 'Restart docket to install the update.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0
    }).then((r) => {
      if (r.response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('auto-updater error:', err && err.message ? err.message : err);
  });

  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 5000);
  setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 4 * 60 * 60 * 1000);
}
```

Modify `app.whenReady().then(async () => { ... })` to call it:

```javascript
app.whenReady().then(async () => {
  await rebuildIndex();
  await restartWatcher();
  buildAppMenu();
  createMainWindow();
  setupAutoUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});
```

Add a new IPC handler for the manual "Check for updates" button:

```javascript
ipcMain.handle('docket:checkForUpdates', async () => {
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, updateInfo: r ? r.updateInfo : null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
```

- [ ] **Step 3: Expose `checkForUpdates` in preload.js**

Add to `preload.js` within the `contextBridge.exposeInMainWorld('docket', {...})` object:

```javascript
checkForUpdates: () => ipcRenderer.invoke('docket:checkForUpdates'),
```

- [ ] **Step 4: Wire About pane button in settings.js**

In `renderer/settings.js`, find `renderAbout` and replace with:

```javascript
async function renderAbout() {
  const v = await window.docket.getVersion();
  panes.about.innerHTML = `
    <h2>About</h2>
    <div class="about-line"><span class="label">Version</span>${escapeHTML(v.version)}</div>
    <div class="about-line"><span class="label">Channel</span>${escapeHTML(v.channel)}</div>
    ${v.buildDate ? `<div class="about-line"><span class="label">Build date</span>${escapeHTML(v.buildDate)}</div>` : ''}
    <div style="margin-top: 16px;">
      <button type="button" id="check-updates" class="btn">Check for updates…</button>
      <span id="update-status" style="margin-left: 10px; color: var(--muted); font-size: 12px;"></span>
    </div>
  `;
  const statusEl = document.getElementById('update-status');
  document.getElementById('check-updates').addEventListener('click', async () => {
    statusEl.textContent = 'Checking…';
    const r = await window.docket.checkForUpdates();
    if (!r.ok) { statusEl.textContent = 'Error: ' + r.error; return; }
    if (!r.updateInfo || r.updateInfo.version === v.version) {
      statusEl.textContent = 'Up to date.';
    } else {
      statusEl.textContent = `v${r.updateInfo.version} available`;
    }
  });
}
```

- [ ] **Step 5: Commit**

```bash
cd ~/Development/docket
git add main.js preload.js renderer/settings.js package.json package-lock.json
git commit -m "feat(updater): integrate electron-updater with dialog flow and settings button"
```

---

## Task 7: release.sh + support scripts

**Files:**
- Create: `scripts/release.sh`
- Create: `scripts/build-with-version.js`
- Create: `scripts/create-installer.js`

Ported from repo-radar. Bumps version, builds signed+notarized packages for arm64+x64, creates GitHub release with DMG + ZIP + `latest-mac.yml`.

- [ ] **Step 1: Write scripts/build-with-version.js**

Create `~/Development/docket/scripts/build-with-version.js`:

```javascript
const fs = require('fs');
const path = require('path');

const versionFile = path.resolve(__dirname, '../VERSION');
const version = fs.readFileSync(versionFile, 'utf8').trim();

const buildInfo = {
  version,
  channel: process.env.DOCKET_CHANNEL || 'stable',
  buildDate: new Date().toISOString(),
  buildTimestamp: Date.now()
};

fs.writeFileSync(
  path.resolve(__dirname, '../build-info.json'),
  JSON.stringify(buildInfo, null, 2) + '\n'
);

console.log(`Wrote build-info.json: v${version} (${buildInfo.channel})`);
```

- [ ] **Step 2: Write scripts/create-installer.js**

Create `~/Development/docket/scripts/create-installer.js`:

```javascript
// Validates expected release artifacts exist and logs them.
// (release.sh attaches them to the GitHub release.)
const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '../dist');
const version = fs.readFileSync(path.resolve(__dirname, '../VERSION'), 'utf8').trim();

const expected = [
  `docket-${version}-arm64-mac.zip`,
  `docket-${version}-x64-mac.zip`,
  `docket-${version}-arm64-mac.dmg`,
  `docket-${version}-x64-mac.dmg`,
  `latest-mac.yml`
];

console.log('Expected release artifacts:');
for (const f of expected) {
  const p = path.join(distDir, f);
  const ok = fs.existsSync(p);
  console.log(`  ${ok ? 'OK ' : '-- '} ${f}`);
}
```

- [ ] **Step 3: Write scripts/release.sh**

Create `~/Development/docket/scripts/release.sh` (verbatim port of repo-radar's release.sh with `repo-radar` → `docket` and path adjustments):

```bash
#!/bin/bash
# release.sh - Full release workflow for Docket
# Usage: ./scripts/release.sh [--minor|--major|--dry-run|--help]
# Default: patch bump (0.1.0 -> 0.1.1)
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
for tool in gh node npm git; do command -v "$tool" &>/dev/null || error "$tool is not installed"; done
CURRENT_BRANCH=$(git branch --show-current)
IS_DEV=false
if [[ "$CURRENT_BRANCH" == "dev" ]]; then IS_DEV=true; info "Dev branch — will build Docket Dev (pre-release)";
elif [[ "$CURRENT_BRANCH" == "main" ]]; then info "Main branch — production release";
else error "Must be on main or dev branch (currently on: $CURRENT_BRANCH)"; fi
gh auth status &>/dev/null || error "Not authenticated with GitHub CLI. Run: gh auth login"
git diff --cached --quiet || error "You have staged changes. Commit or unstage them first."
success "Preflight OK"

step "Version calculation"
CURRENT_VERSION=$(cat VERSION | tr -d '[:space:]')
BASE_VERSION="${CURRENT_VERSION%%-*}"
IFS='.' read -r MAJOR MINOR PATCH <<< "$BASE_VERSION"
case "$BUMP_TYPE" in
  patch) NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))" ;;
  minor) NEW_VERSION="$MAJOR.$((MINOR + 1)).0" ;;
  major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
esac
if $IS_DEV; then DEV_BUILD=$(date +%Y%m%d%H%M); NEW_VERSION="${NEW_VERSION}-dev.${DEV_BUILD}"; fi
info "Current: $CURRENT_VERSION -> New: $NEW_VERSION ($BUMP_TYPE)"

if $DRY_RUN; then
  step "Dry run"
  dry "Bump VERSION + package.json to $NEW_VERSION"
  dry "Commit, tag v$NEW_VERSION"
  dry "Build arm64 + x64, sign + notarize"
  dry "gh release create v$NEW_VERSION with DMG + ZIP + latest-mac.yml"
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
  # swap appId/productName/icon for dev build
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
  if [[ -f "$f" ]]; then success "Found: $(basename "$f")"; ASSETS+=("$f"); else warn "Missing: $(basename "$f")"; fi
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
```

- [ ] **Step 4: Make it executable**

```bash
cd ~/Development/docket
chmod +x scripts/release.sh
```

- [ ] **Step 5: Add npm scripts**

Modify `package.json` `scripts`:

```json
"scripts": {
  "start": "electron .",
  "test": "node --test test/",
  "postinstall": "node scripts/copy-vendor.js || true",
  "build": "node scripts/build-with-version.js && electron-builder",
  "release": "./scripts/release.sh"
}
```

- [ ] **Step 6: Commit**

```bash
cd ~/Development/docket
git add scripts/ package.json
git commit -m "feat(build): add release.sh and supporting scripts mirroring repo-radar"
```

---

## Task 8: Dry-run release

- [ ] **Step 1: Run the dry-run**

```bash
cd ~/Development/docket
./scripts/release.sh --dry-run
```

Expected output:
- Preflight passes (main branch, clean git, gh authed)
- Prints version calculation and planned artifacts
- Exits without changing anything

- [ ] **Step 2: Same from dev branch (after creating one)**

```bash
cd ~/Development/docket
git checkout -b dev
./scripts/release.sh --dry-run
git checkout main
```

Expected: prints dev-suffixed version (e.g. `0.1.1-dev.YYYYMMDDHHMM`) and mentions "pre-release".

---

## Task 9: First real release (0.1.1)

Prerequisites:
- Notarization env vars set in the shell:
  ```bash
  export APPLE_ID="your-apple-id@example.com"
  export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
  export APPLE_TEAM_ID="5S875AN2HU"
  ```
- GitHub remote configured: `git remote -v` shows `origin` pointing at `github.com/mattwallington/docket`.

- [ ] **Step 1: Release from main**

```bash
cd ~/Development/docket
./scripts/release.sh
```

This will take ~5-10 minutes. Notarization adds 1-3 minutes.

Expected: `v0.1.1` tag pushed, GitHub release exists with 4 artifacts (two DMGs, two ZIPs) plus `latest-mac.yml`.

- [ ] **Step 2: Verify signing on the built app**

```bash
cd ~/Development/docket
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/Docket.app"
```

Expected: exits 0, prints "valid on disk" / "satisfies its Designated Requirement".

- [ ] **Step 3: Verify notarization**

```bash
cd ~/Development/docket
stapler validate "dist/mac-arm64/Docket.app"
```

Expected: "The validate action worked!"

- [ ] **Step 4: Fresh-install round-trip**

From Finder: open `dist/docket-0.1.1-arm64-mac.dmg`. Drag the icon to Applications. Double-click the app in Applications.

Expected: launches without a Gatekeeper "unidentified developer" warning.

---

## Task 10: Auto-update round-trip

- [ ] **Step 1: Note installed version**

Launch docket from Applications. Open settings → About. Note: "Version 0.1.1".

- [ ] **Step 2: Publish a second release**

```bash
cd ~/Development/docket
./scripts/release.sh
```

This bumps to `0.1.2`.

- [ ] **Step 3: Trigger update check in installed app**

In the installed v0.1.1 app: settings → About → "Check for updates…"

Expected within 10 seconds: dialog "Docket v0.1.2 is available. Download?" → Download → wait a moment → "Update Ready" dialog → Restart Now → app relaunches as v0.1.2.

- [ ] **Step 4: Channel isolation test**

Create a dev build from the `dev` branch:

```bash
cd ~/Development/docket
git checkout dev
./scripts/release.sh  # produces 0.1.3-dev.YYYYMMDDHHMM as a pre-release
git checkout main
```

Confirm:
- Stable install never picks up the pre-release (no dialog).
- Install the dev DMG (same steps as Step 4 above) — it DOES get pre-release prompts, since `allowPrerelease = true`.
- Both Docket and Docket Dev appear in Applications, distinct icons, launch independently.

---

## Task 11: Write release docs

**Files:**
- Create: `docs/releasing.md`

- [ ] **Step 1: Write the doc**

Create `~/Development/docket/docs/releasing.md`:

```markdown
# Releasing Docket

## Prerequisites

- On `main` or `dev` branch, clean working tree.
- Apple Developer ID cert `"Matthew Wallington (5S875AN2HU)"` in Keychain.
- Env vars:
  - `APPLE_ID`
  - `APPLE_APP_SPECIFIC_PASSWORD`
  - `APPLE_TEAM_ID=5S875AN2HU`
- `gh` CLI authenticated.

## Flow

```sh
./scripts/release.sh [--minor|--major|--dry-run]
```

Default is `--patch`. `main` produces a stable release; `dev` produces a pre-release with `-dev.YYYYMMDDHHMM` suffix and uses a distinct `appId` so both installs coexist.

## What it does

1. Bumps `VERSION` + `package.json` + `package-lock.json`.
2. Commits and tags `v$NEW_VERSION`.
3. Writes `build-info.json` with channel.
4. Builds arm64 + x64, signed + notarized.
5. Creates GitHub release with DMG + ZIP + `latest-mac.yml` attached. Dev builds use `--prerelease`.
6. Pushes branch and tag.

## Auto-update

- Installed apps poll GitHub Releases 5s after launch and every 4h.
- Stable installs see stable releases only; dev installs see stable + pre-releases.
- No user action needed beyond the "Download" / "Restart Now" dialogs.

## Troubleshooting

- **Notarization hangs or errors**: check `xcrun notarytool log <UUID> --apple-id ... --password ... --team-id ...`. The electron-builder output includes the UUID.
- **Signing fails with "no identity found"**: make sure your Developer ID cert is still in Keychain and not expired.
- **"zip archive not found"** from electron-builder: check `dist/` contents; the zip target needs an arch-specific build to complete first.
```

- [ ] **Step 2: Commit**

```bash
cd ~/Development/docket
git add docs/releasing.md
git commit -m "docs: add releasing.md runbook"
git push origin main
```

---

## Success criteria

Phase 2 is complete when:

- `./scripts/release.sh` succeeds from `main` branch and produces a signed + notarized release on GitHub.
- `codesign --verify` and `stapler validate` both pass on the produced `.app`.
- Fresh install via DMG launches without Gatekeeper warnings on both arm64 and x64.
- Auto-update round-trip works: v0.1.1 → v0.1.2 via in-app dialog → restart → app is v0.1.2.
- `dev` branch produces a coexisting "Docket Dev" install with distinct icon and separate userData.
- Stable installs are never prompted with pre-release versions; dev installs are.

Phase 3 (checkbox toggling) begins after Phase 2 ships.
