#!/usr/bin/env node

const { listPackage } = require('@electron/asar');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  SUPPORTED_ARCH,
  SUPPORTED_PLATFORM,
  ensureDirectory,
  findExecutable,
  getAssetName,
  getExecutableName,
  readPackageMetadata,
  resolvePackageRoot,
} = require('./distribution');

function toPowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runCommand(file, args, options, runner = spawnSync) {
  const result = runner(file, args, options);
  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${file} ${args.join(' ')} failed with exit code ${result.status}.`);
  }

  return result;
}

function runPowerShell(command, runner = spawnSync) {
  return runCommand(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { stdio: 'pipe', encoding: 'utf8' },
    runner,
  );
}

function normalizeVersion(value) {
  const trimmedValue = String(value || '').trim();
  if (trimmedValue === '') {
    return '';
  }

  const versionWithoutBuild = trimmedValue.split('+')[0];
  const prereleaseIndex = versionWithoutBuild.indexOf('-');
  const coreVersion = prereleaseIndex === -1
    ? versionWithoutBuild
    : versionWithoutBuild.slice(0, prereleaseIndex);
  const prereleaseSuffix = prereleaseIndex === -1
    ? ''
    : versionWithoutBuild.slice(prereleaseIndex);
  const versionParts = coreVersion.split('.').filter(Boolean);

  while (versionParts.length > 3 && versionParts[versionParts.length - 1] === '0') {
    versionParts.pop();
  }

  return `${versionParts.join('.')}${prereleaseSuffix}`;
}

function getExecutableVersion(executablePath, runner = spawnSync) {
  const result = runPowerShell(
    `(Get-Item -LiteralPath ${toPowerShellLiteral(executablePath)}).VersionInfo.ProductVersion`,
    runner,
  );

  return typeof result.stdout === 'string' ? result.stdout.trim() : '';
}

function assertPackagedExecutableVersion(packagedDirectory, metadata, runner = spawnSync) {
  const executablePath = findExecutable(packagedDirectory, getExecutableName(metadata));
  if (!executablePath) {
    throw new Error(`No packaged executable named ${getExecutableName(metadata)} was found under ${packagedDirectory}.`);
  }

  const actualVersion = getExecutableVersion(executablePath, runner);
  if (normalizeVersion(actualVersion) !== normalizeVersion(metadata.version)) {
    throw new Error(
      `Packaged QuakeShell executable version ${actualVersion || 'unknown'} does not match package version ${metadata.version}.`,
    );
  }

  return executablePath;
}

function findFirstMatchingFile(rootDirectory, matcher) {
  if (!fs.existsSync(rootDirectory)) {
    return null;
  }

  const pendingDirectories = [rootDirectory];
  const visitedDirectories = new Set();
  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    let realPath;
    try {
      realPath = (fs.realpathSync.native || fs.realpathSync)(currentDirectory);
    } catch {
      continue;
    }

    if (visitedDirectories.has(realPath)) {
      continue;
    }

    visitedDirectories.add(realPath);

    let entries;
    try {
      entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
        continue;
      }

      let isMatch = false;
      try {
        isMatch = entry.isFile() && matcher(entryPath, entry.name);
      } catch {
        continue;
      }

      if (isMatch) {
        return entryPath;
      }
    }
  }

  return null;
}

function normalizePathForComparison(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function stripLeadingSlash(filePath) {
  return normalizePathForComparison(filePath).replace(/^\/+/, '');
}

function readPackagedAsarEntries(packagedDirectory, options = {}) {
  const listPackageImpl = options.listPackageImpl || listPackage;
  const asarPath = path.join(packagedDirectory, 'resources', 'app.asar');

  let listedAsarEntries;
  try {
    listedAsarEntries = listPackageImpl(asarPath, {});
  } catch (error) {
    const details = error instanceof Error && error.message ? `: ${error.message}` : '';
    throw new Error(`Failed to read packaged app archive at ${asarPath}${details}`);
  }

  if (!Array.isArray(listedAsarEntries)) {
    throw new Error(`Failed to read packaged app archive at ${asarPath}: expected a file list.`);
  }

  return {
    asarPath,
    asarEntries: listedAsarEntries.map((entryPath) => stripLeadingSlash(entryPath)),
  };
}

function assertPackagedRendererPayload(packagedDirectory, options = {}) {
  const { asarPath, asarEntries } = readPackagedAsarEntries(packagedDirectory, options);
  const rendererRoots = [
    'src/renderer/.vite/renderer/main_window',
    '.vite/renderer/main_window',
  ];
  const matchedRendererRoot = rendererRoots.find((rendererRoot) =>
    asarEntries.includes(`${rendererRoot}/index.html`),
  );

  if (!matchedRendererRoot) {
    throw new Error(`Packaged QuakeShell app is missing the renderer entry HTML inside ${asarPath}.`);
  }

  const assetPrefix = `${matchedRendererRoot}/assets/`;
  const hasRendererScript = asarEntries.some((entryPath) =>
    entryPath.startsWith(assetPrefix) && entryPath.endsWith('.js'),
  );

  if (!hasRendererScript) {
    throw new Error(
      `Packaged QuakeShell app is missing the renderer script bundle under ${assetPrefix} inside ${asarPath}.`,
    );
  }

  return `${matchedRendererRoot}/index.html`;
}

function assertPackagedIconPayload(packagedDirectory, options = {}) {
  const { asarPath, asarEntries } = readPackagedAsarEntries(packagedDirectory, options);
  const iconPath = 'assets/icon.ico';

  if (!asarEntries.includes(iconPath)) {
    throw new Error(`Packaged QuakeShell app is missing ${iconPath} inside ${asarPath}.`);
  }

  return iconPath;
}

function assertPackagedNodePtyPayload(packagedDirectory, options = {}) {
  const platform = options.platform || SUPPORTED_PLATFORM;
  const arch = options.arch || SUPPORTED_ARCH;
  const { asarPath, asarEntries } = readPackagedAsarEntries(packagedDirectory, options);
  const unpackedModuleRoot = path.join(
    packagedDirectory,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
  );

  const requiredAsarEntries = [
    'package.json',
    'node_modules/node-pty/package.json',
    'node_modules/node-pty/lib/index.js',
  ];

  for (const requiredEntry of requiredAsarEntries) {
    if (!asarEntries.includes(requiredEntry)) {
      throw new Error(`Packaged QuakeShell app is missing ${requiredEntry} inside ${asarPath}.`);
    }
  }

  const archSpecificPrefix = `/bin/${platform}-${arch}-`;
  const nativeBinaryPath = findFirstMatchingFile(
    unpackedModuleRoot,
    (filePath, fileName) => {
      const normalizedPath = normalizePathForComparison(filePath);
      return path.extname(fileName).toLowerCase() === '.node'
        && (
          normalizedPath.includes('/build/Release/')
          || normalizedPath.includes(`/prebuilds/${platform}-${arch}/`)
          || normalizedPath.includes(archSpecificPrefix)
        );
    },
  );

  if (!nativeBinaryPath) {
    throw new Error(
      `Packaged QuakeShell app is missing the unpacked ${platform}-${arch} node-pty native payload under ${unpackedModuleRoot}.`,
    );
  }

  return nativeBinaryPath;
}

function runPackageBuild(packageRoot, platform, runner = spawnSync) {
  if (platform === 'win32') {
    const shell = process.env.ComSpec || 'cmd.exe';
    runCommand(
      shell,
      ['/d', '/s', '/c', 'npm run package'],
      { cwd: packageRoot, stdio: 'inherit' },
      runner,
    );
    return;
  }

  runCommand(
    'npm',
    ['run', 'package'],
    { cwd: packageRoot, stdio: 'inherit' },
    runner,
  );
}

function isFreshExecutable(executablePath, minExecutableMtimeMs) {
  if (typeof minExecutableMtimeMs !== 'number' || Number.isNaN(minExecutableMtimeMs)) {
    return true;
  }

  return fs.statSync(executablePath).mtimeMs >= minExecutableMtimeMs;
}

function resolvePackagedAppDir(packageRoot, metadata, options = {}) {
  const outputRoot = path.join(packageRoot, 'out');
  const minExecutableMtimeMs = options.minExecutableMtimeMs;
  if (!fs.existsSync(outputRoot)) {
    throw new Error('No packaged output was found. Run `npm run package` first.');
  }

  const preferredDirectory = path.join(
    outputRoot,
    `${metadata.productName || metadata.name}-${SUPPORTED_PLATFORM}-${SUPPORTED_ARCH}`,
  );
  const preferredExecutable = findExecutable(preferredDirectory, getExecutableName(metadata));
  if (preferredExecutable && isFreshExecutable(preferredExecutable, minExecutableMtimeMs)) {
    return preferredDirectory;
  }

  const matchingDirectories = [];
  const candidates = fs.readdirSync(outputRoot, { withFileTypes: true })
    .filter((candidate) => candidate.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const candidate of candidates) {
    const candidatePath = path.join(outputRoot, candidate.name);
    const candidateExecutable = findExecutable(candidatePath, getExecutableName(metadata));
    if (!candidateExecutable || !isFreshExecutable(candidateExecutable, minExecutableMtimeMs)) {
      continue;
    }

    matchingDirectories.push(candidatePath);
  }

  if (matchingDirectories.length === 1) {
    return matchingDirectories[0];
  }

  if (matchingDirectories.length > 1) {
    throw new Error(
      `Multiple packaged apps containing ${getExecutableName(metadata)} were found under ${outputRoot}. Remove stale output directories and rerun packaging.`,
    );
  }

  throw new Error(`No packaged app containing ${getExecutableName(metadata)} was found under ${outputRoot}.`);
}

function createArchive(sourceDirectory, assetPath, runner = spawnSync) {
  ensureDirectory(path.dirname(assetPath));
  fs.rmSync(assetPath, { force: true });
  const command = `Compress-Archive -LiteralPath ${toPowerShellLiteral(sourceDirectory)} -DestinationPath ${toPowerShellLiteral(assetPath)} -Force`;
  runPowerShell(command, runner);
}

function computeFileSha256(assetPath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(assetPath);

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });
    stream.on('error', reject);
  });
}

async function writeChecksumFile(assetPath) {
  const checksum = await computeFileSha256(assetPath);
  const checksumPath = `${assetPath}.sha256`;
  fs.writeFileSync(checksumPath, `${checksum}  ${path.basename(assetPath)}\n`, 'utf8');
  return checksumPath;
}

async function buildReleaseAsset(options = {}) {
  const packageRoot = options.packageRoot || resolvePackageRoot();
  const platform = options.platform || process.platform;
  const metadata = options.metadata || readPackageMetadata(packageRoot);
  const skipPackageBuild = Boolean(options.skipPackageBuild);
  let buildStartedAt;
  const outputRoot = path.join(packageRoot, 'out');

  if (platform !== SUPPORTED_PLATFORM) {
    throw new Error('QuakeShell release asset packaging currently requires Windows.');
  }

  if (!skipPackageBuild) {
    fs.rmSync(outputRoot, { recursive: true, force: true });
    buildStartedAt = Date.now();
    runPackageBuild(packageRoot, platform, options.commandRunner || spawnSync);
  }

  const packagedDirectory = resolvePackagedAppDir(packageRoot, metadata, {
    minExecutableMtimeMs: buildStartedAt,
  });
  assertPackagedExecutableVersion(packagedDirectory, metadata, options.powerShellRunner || spawnSync);
  assertPackagedRendererPayload(packagedDirectory);
  assertPackagedIconPayload(packagedDirectory);
  assertPackagedNodePtyPayload(packagedDirectory);
  const assetName = getAssetName(metadata, SUPPORTED_PLATFORM, SUPPORTED_ARCH);
  const assetPath = path.join(packageRoot, 'release', assetName);
  createArchive(packagedDirectory, assetPath, options.powerShellRunner || spawnSync);
  const checksumPath = await writeChecksumFile(assetPath);

  return {
    assetName,
    assetPath,
    checksumPath,
    dryRun: Boolean(options.dryRun),
    packagedDirectory,
  };
}

if (require.main === module) {
  (async () => {
    try {
      const dryRun = process.argv.includes('--dry-run');
      const skipPackageBuild = process.argv.includes('--skip-package-build');
      const result = await buildReleaseAsset({
        dryRun,
        skipPackageBuild,
      });
      const suffix = dryRun ? ' (dry run)' : '';
      console.log(`[quakeshell] Prepared ${result.assetName} at ${result.assetPath}${suffix}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[quakeshell] ${message}`);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  assertPackagedExecutableVersion,
  assertPackagedRendererPayload,
  assertPackagedIconPayload,
  assertPackagedNodePtyPayload,
  buildReleaseAsset,
  computeFileSha256,
  createArchive,
  findFirstMatchingFile,
  getExecutableVersion,
  isFreshExecutable,
  normalizePathForComparison,
  normalizeVersion,
  resolvePackagedAppDir,
  runPackageBuild,
  runPowerShell,
  writeChecksumFile,
};