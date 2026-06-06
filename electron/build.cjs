const { spawn } = require('node:child_process');

const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const mirrorEnv = {
  CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || 'false',
};

if (!isGitHubActions) {
  mirrorEnv.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
  mirrorEnv.npm_config_electron_mirror = process.env.npm_config_electron_mirror || 'https://npmmirror.com/mirrors/electron/';
}

if (!isGitHubActions && process.env.ELECTRON_BUILDER_BINARIES_MIRROR) {
  mirrorEnv.ELECTRON_BUILDER_BINARIES_MIRROR = process.env.ELECTRON_BUILDER_BINARIES_MIRROR;
}

const ciMirrorEnvNames = [
  'ELECTRON_MIRROR',
  'NPM_CONFIG_ELECTRON_MIRROR',
  'npm_config_electron_mirror',
  'npm_package_config_electron_mirror',
  'ELECTRON_NIGHTLY_MIRROR',
  'NPM_CONFIG_ELECTRON_NIGHTLY_MIRROR',
  'npm_config_electron_nightly_mirror',
  'npm_package_config_electron_nightly_mirror',
  'ELECTRON_BUILDER_BINARIES_DOWNLOAD_OVERRIDE_URL',
  'ELECTRON_BUILDER_BINARIES_MIRROR',
  'NPM_CONFIG_ELECTRON_BUILDER_BINARIES_MIRROR',
  'npm_config_electron_builder_binaries_mirror',
  'npm_package_config_electron_builder_binaries_mirror',
  'ELECTRON_BUILDER_BINARIES_CUSTOM_DIR',
  'NPM_CONFIG_ELECTRON_BUILDER_BINARIES_CUSTOM_DIR',
  'npm_config_electron_builder_binaries_custom_dir',
  'npm_package_config_electron_builder_binaries_custom_dir',
];

function withNoDeprecationWarning(nodeOptions) {
  const value = (nodeOptions || '').trim();

  if (value.split(/\s+/).includes('--no-deprecation')) {
    return value;
  }

  return `${value} --no-deprecation`.trim();
}

const env = {
  ...process.env,
  ...mirrorEnv,
  NODE_OPTIONS: withNoDeprecationWarning(process.env.NODE_OPTIONS),
};

if (isGitHubActions) {
  for (const name of ciMirrorEnvNames) {
    delete env[name];
  }
}

const child = spawn(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
