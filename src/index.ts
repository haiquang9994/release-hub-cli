#!/usr/bin/env node
import { Command } from 'commander';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import archiver from 'archiver';
import readline from 'readline';

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
}

const program = new Command();
const CONFIG_PATH = path.join(os.homedir(), '.release-hub.json');

interface Config {
  serverUrl?: string;
  token?: string;
}

// Read saved config
function readConfig(): Config {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

// Write config
function writeConfig(config: Config) {
  const current = readConfig();
  const updated = { ...current, ...config };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf-8');
}

// Resolve server and token from options or config
function resolveAuth(options: any): { serverUrl: string; token: string } {
  const config = readConfig();
  const serverUrl = options.server || config.serverUrl;
  const token = options.token || config.token;

  if (!serverUrl) {
    console.error('Error: Server URL is not configured. Run login first or pass --server.');
    process.exit(1);
  }
  if (!token) {
    console.error('Error: Token is not configured. Run login first or pass --token.');
    process.exit(1);
  }

  return { serverUrl, token };
}

// Helper to zip directory
function zipDirectory(sourceDir: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false); // false means don't include the parent directory folder itself
    archive.finalize();
  });
}

// Helper to calculate file hash
function calculateFileHash(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

program
  .name('release-hub')
  .description('CLI for ReleaseHub OTA Updates')
  .version('1.0.0');

// Login Command
program
  .command('login')
  .description('Configure ReleaseHub server credentials')
  .option('-s, --server <url>', 'Server URL (e.g. https://release-hub.example.com)')
  .action(async (options) => {
    const config = readConfig();
    let serverUrl = options.server || config.serverUrl;
    
    if (!serverUrl) {
      console.log('No server URL configured.');
      serverUrl = await askQuestion('Enter ReleaseHub server URL (e.g., https://release-hub.example.com): ');
      if (!serverUrl) {
        console.error('Error: Server URL is required.');
        process.exit(1);
      }
    }
    
    // Strip trailing slash
    if (serverUrl.endsWith('/')) {
      serverUrl = serverUrl.slice(0, -1);
    }
    
    console.log(`\nTo complete authentication:`);
    console.log(`1. Open the dashboard in your browser: \x1b[36m${serverUrl}\x1b[0m`);
    console.log(`2. Log in and copy your "CLI Access Token" from the sidebar.`);
    
    const token = await askQuestion('\nPaste your CLI Access Token: ');
    if (!token) {
      console.error('Error: Token is required.');
      process.exit(1);
    }

    // Verify the token by calling GET /api/me
    console.log('Verifying token with server...');
    try {
      const response = await axios.get(`${serverUrl}/api/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const user = response.data.user;
      console.log(`\x1b[32mSuccess! Logged in as ${user.username} (${user.role}).\x1b[0m`);
      
      writeConfig({ serverUrl, token });
      console.log(`Credentials saved to ${CONFIG_PATH}`);
    } catch (error: any) {
      console.error('\n\x1b[31mAuthentication failed.\x1b[0m');
      if (error.response) {
        console.error(`Server error (${error.response.status}):`, error.response.data);
      } else {
        console.error(error.message);
      }
      process.exit(1);
    }
  });

// Release Command
program
  .command('release-react')
  .description('Build, package, and upload React Native bundle to server')
  .requiredOption('-a, --app <appName>', 'Application name')
  .requiredOption('-p, --platform <platform>', 'Platform (ios or android)')
  .requiredOption('-v, --version <appVersion>', 'Binary target version (e.g. 1.0.0, ^1.0.0)')
  .option('-e, --deployment <deployment>', 'Deployment name (Staging or Production)', 'Staging')
  .option('-d, --description <desc>', 'Release notes / description')
  .option('-m, --mandatory', 'Mark the release as mandatory', false)
  .option('--entry-file <file>', 'Entry file path', 'index.js')
  .option('--bundle-path <path>', 'Use pre-built bundle directory instead of running bundler')
  .option('--server <url>', 'Override server URL')
  .option('--token <token>', 'Override authorization token')
  .option('--dry-run', 'Prepare bundle zip locally but do not upload')
  .action(async (options) => {
    const { app, platform, version, deployment, description, mandatory, entryFile, bundlePath, dryRun } = options;
    
    if (platform !== 'ios' && platform !== 'android') {
      console.error('Error: Platform must be "ios" or "android"');
      process.exit(1);
    }

    const { serverUrl, token } = resolveAuth(options);

    // Setup working directories
    const workDir = path.resolve(process.cwd(), './.tmp_releasehub');
    const zipPath = path.resolve(process.cwd(), './.tmp_releasehub_bundle.zip');

    try {
      // 1. Prepare bundle
      let sourceDir = '';

      if (bundlePath) {
        sourceDir = path.resolve(process.cwd(), bundlePath);
        if (!fs.existsSync(sourceDir)) {
          console.error(`Error: Pre-built bundle path "${bundlePath}" does not exist.`);
          process.exit(1);
        }
        console.log(`Using pre-built bundle directory: ${sourceDir}`);
      } else {
        // Run React Native Bundler
        console.log(`Bundling React Native app for ${platform}...`);
        
        if (fs.existsSync(workDir)) {
          fs.rmSync(workDir, { recursive: true, force: true });
        }
        fs.mkdirSync(workDir, { recursive: true });
        sourceDir = workDir;

        const bundleOutput = platform === 'ios' 
          ? path.join(workDir, 'main.jsbundle') 
          : path.join(workDir, 'index.android.bundle');

        const bundleCmd = `npx react-native bundle \
          --platform ${platform} \
          --dev false \
          --entry-file ${entryFile} \
          --bundle-output ${bundleOutput} \
          --assets-dest ${workDir}`;

        console.log(`Running: ${bundleCmd}`);
        execSync(bundleCmd, { stdio: 'inherit' });
        console.log('React Native bundle built successfully.');
      }

      // 2. Zip folder
      console.log('Compressing bundle assets...');
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
      await zipDirectory(sourceDir, zipPath);
      console.log(`ZIP created successfully at ${zipPath}`);

      // Calculate hash
      const hash = calculateFileHash(zipPath);
      const size = fs.statSync(zipPath).size;
      console.log(`Package hash (SHA256): ${hash}`);
      console.log(`Package size: ${(size / 1024 / 1024).toFixed(2)} MB`);

      // 3. Upload or Dry Run
      if (dryRun) {
        console.log('Dry run enabled. Skipping upload.');
        console.log('Packaged zip remains at ./.tmp_releasehub_bundle.zip');
        return;
      }

      console.log(`Uploading release to ${serverUrl}...`);
      const form = new FormData();
      form.append('appName', app);
      form.append('platform', platform);
      form.append('deploymentName', deployment);
      form.append('appVersion', version);
      form.append('description', description || '');
      form.append('isMandatory', mandatory ? 'true' : 'false');
      form.append('package', fs.createReadStream(zipPath));

      const response = await axios.post(`${serverUrl}/api/deploy`, form, {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${token}`
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      console.log('\nSuccess! Release deployed successfully:');
      console.log(JSON.stringify(response.data.release, null, 2));

      // Clean up zip
      fs.unlinkSync(zipPath);
      if (!bundlePath && fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    } catch (error: any) {
      console.error('\nError: Operation failed.');
      if (error.response) {
        console.error(`Server error (${error.response.status}):`, error.response.data);
      } else {
        console.error(error.message);
      }
      
      // Attempt cleanup
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      if (!bundlePath && fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      
      process.exit(1);
    }
  });

// History Command
program
  .command('history')
  .description('View release history for an application')
  .requiredOption('-a, --app <appName>', 'Application name')
  .requiredOption('-p, --platform <platform>', 'Platform (ios or android)')
  .option('-e, --deployment <deployment>', 'Deployment name (Staging or Production)', 'Staging')
  .option('--server <url>', 'Override server URL')
  .option('--token <token>', 'Override authorization token')
  .action(async (options) => {
    const { app, platform, deployment } = options;
    const { serverUrl, token } = resolveAuth(options);

    try {
      const response = await axios.get(`${serverUrl}/api/releases`, {
        params: {
          appName: app,
          platform,
          deploymentName: deployment
        },
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const releases = response.data.releases;

      if (!releases || releases.length === 0) {
        console.log(`No releases found for ${app} (${platform} - ${deployment})`);
        return;
      }

      console.log(`\nRelease History for ${app} (${platform} - ${deployment}):`);
      console.log('='.repeat(80));
      console.log(`${'Ver'.padEnd(10)} | ${'Hash'.padEnd(10)} | ${'Mandatory'.padEnd(9)} | ${'Size'.padEnd(10)} | ${'Date'.padEnd(20)} | ${'Description'}`);
      console.log('-'.repeat(80));

      for (const rel of releases) {
        const date = new Date(rel.createdAt).toLocaleString();
        const shortHash = rel.packageHash.substring(0, 8);
        const sizeStr = `${(rel.size / 1024).toFixed(1)} KB`;
        const mandatoryStr = rel.isMandatory ? 'Yes' : 'No';
        console.log(`${rel.appVersion.padEnd(10)} | ${shortHash.padEnd(10)} | ${mandatoryStr.padEnd(9)} | ${sizeStr.padEnd(10)} | ${date.padEnd(20)} | ${rel.description}`);
      }
      console.log('='.repeat(80));
    } catch (error: any) {
      if (error.response) {
        console.error(`Server error (${error.response.status}):`, error.response.data);
      } else {
        console.error('Error:', error.message);
      }
      process.exit(1);
    }
  });

program.parse(process.argv);
