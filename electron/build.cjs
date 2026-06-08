const { spawn } = require('node:child_process');

const DEFAULT_ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
const DEFAULT_ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/';

const mirrorEnv = {
  CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || 'false',
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || process.env.npm_config_electron_mirror || DEFAULT_ELECTRON_MIRROR,
  npm_config_electron_mirror: process.env.npm_config_electron_mirror || process.env.ELECTRON_MIRROR || DEFAULT_ELECTRON_MIRROR,
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
    process.env.npm_config_electron_builder_binaries_mirror ||
    DEFAULT_ELECTRON_BUILDER_BINARIES_MIRROR,
  npm_config_electron_builder_binaries_mirror:
    process.env.npm_config_electron_builder_binaries_mirror ||
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
    DEFAULT_ELECTRON_BUILDER_BINARIES_MIRROR,
};

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
