# ReleaseHub CLI

ReleaseHub CLI is a command-line tool designed to bundle, package, and publish Over-The-Air (OTA) updates for React Native applications to the **ReleaseHub Server**.

---

## Features

- **Authentication**: Easy login and token verification via CLI.
- **Auto Bundling**: Packages your React Native project for Android and iOS using the native React Native packager (`metro`).
- **Support Pre-built Bundles**: Upload pre-built assets without triggering a rebuild.
- **Release Management**: Control deployment targets (`Staging` vs `Production`), mandatory flags, target versions, and release notes.
- **History Tracking**: View release history straight from the CLI.

---

## Installation & Setup

Install the CLI globally on your machine:

```bash
npm install -g release-hub-cli
```

Once installed, the `release-hub` command will be available globally.

---

## Command Reference

### 1. `login`
Authenticate the CLI with your ReleaseHub server.

```bash
release-hub login [options]
```

**Options:**
- `-s, --server <url>`: Specify the ReleaseHub server URL (e.g., `https://release-hub.example.com`).

**Usage:**
```bash
release-hub login -s https://release-hub.example.com
```
This command will prompt you to:
1. Open the ReleaseHub dashboard in your browser.
2. Log in and copy your **CLI Access Token**.
3. Paste the token into the CLI to save configuration locally in `~/.release-hub.json`.

---

### 2. `release-react`
Build, zip, and deploy a React Native bundle.

```bash
release-hub release-react [options]
```

**Required Options:**
- `-a, --app <appName>`: The application name registered on the server.
- `-p, --platform <platform>`: Target platform (`ios` or `android`).
- `-v, --version <appVersion>`: The binary target version of your app (e.g., `1.0.0`, `^1.0.0`).

**Optional Options:**
- `-e, --deployment <deployment>`: Deployment target (`Staging` or `Production`). *Default: `Staging`*
- `-d, --description <desc>`: Release description/changelog.
- `-m, --mandatory`: Mark this release as mandatory (forces client app to apply the update).
- `--entry-file <file>`: Entry file path. *Default: `index.js`*
- `--bundle-path <path>`: Use pre-built bundle directory instead of running Metro bundler.
- `--server <url>`: Override the saved server URL.
- `--token <token>`: Override the saved authorization token.
- `--dry-run`: Build and compress the bundle locally at `./.tmp_releasehub_bundle.zip` without uploading to the server.

**Example (Bundle & Release to Staging):**
```bash
release-hub release-react -a MyAwesomeApp -p android -v 1.0.0 -d "Fix navigation bug"
```

**Example (Release Pre-built Bundle to Production as Mandatory):**
```bash
release-hub release-react -a MyAwesomeApp -p ios -v 1.0.0 -e Production -m --bundle-path ./ios/build/bundle
```

---

### 3. `history`
View release history for an application.

```bash
release-hub history [options]
```

**Required Options:**
- `-a, --app <appName>`: The application name.
- `-p, --platform <platform>`: Target platform (`ios` or `android`).

**Optional Options:**
- `-e, --deployment <deployment>`: Deployment target (`Staging` or `Production`). *Default: `Staging`*
- `--server <url>`: Override server URL.
- `--token <token>`: Override authorization token.

**Example:**
```bash
release-hub history -a MyAwesomeApp -p android -e Staging
```

---

## Local Configuration File

Your credentials and server URL are stored in your home directory:
`~/.release-hub.json`

Format:
```json
{
  "serverUrl": "https://release-hub.example.com",
  "token": "your_saved_cli_access_token_here"
}
```
