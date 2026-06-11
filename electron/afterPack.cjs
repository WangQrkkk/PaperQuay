const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

async function assertFile(filePath, label) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

async function run(filePath, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(filePath, args, {
    maxBuffer: 1024 * 1024 * 8,
    ...options,
  });

  if (stdout) {
    process.stdout.write(stdout);
  }

  if (stderr) {
    process.stderr.write(stderr);
  }
}

async function updateWindowsExecutableIcon(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const projectDir = context.packager.projectDir;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(projectDir, 'public', 'icon.ico');
  const rceditPath = path.join(projectDir, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');

  await assertFile(exePath, 'Windows executable');
  await assertFile(iconPath, 'Windows icon');
  await assertFile(rceditPath, 'rcedit executable');

  await run(rceditPath, [exePath, '--set-icon', iconPath], {
    windowsHide: true,
  });

  console.log(`[afterPack] updated Windows executable icon: ${exeName}`);
}

async function adHocSignMacApp(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('macOS app signing must run on a macOS build host.');
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  await assertFile(appPath, 'macOS app bundle');

  try {
    await run('codesign', ['--remove-signature', appPath]);
  } catch (error) {
    console.warn(`[afterPack] no removable macOS signature found for ${appName}: ${error.message}`);
  }

  await run('codesign', ['--force', '--deep', '--sign', '-', appPath]);
  await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);

  console.log(`[afterPack] ad-hoc signed macOS app bundle: ${appName}`);
}

exports.default = async function afterPack(context) {
  await updateWindowsExecutableIcon(context);
  await adHocSignMacApp(context);
};
