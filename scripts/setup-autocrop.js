#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

function parseArgs(argv) {
  const args = { pyCommand: 'python3', pyDir: process.cwd() };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--py-command' && argv[i + 1]) {
      args.pyCommand = argv[++i];
    } else if (arg === '--py-dir' && argv[i + 1]) {
      args.pyDir = path.resolve(argv[++i]);
    }
  }
  return args;
}

(async () => {
  const { pyCommand, pyDir } = parseArgs(process.argv);
  const root = pyDir;
  const targetDir = path.join(root, 'autocrop-vertical');

  console.log(`Using Python command: ${pyCommand}`);
  console.log(`AutoCrop-vertical base dir: ${root}`);

  if (!fs.existsSync(targetDir)) {
    console.log('Cloning AutoCrop-vertical repository...');
    await run('git', ['clone', 'https://github.com/kamilstanuch/Autocrop-vertical.git', 'autocrop-vertical'], {
      cwd: root,
    });
  } else {
    console.log('AutoCrop-vertical directory already exists, skipping clone.');
  }

  const venvDir = path.join(targetDir, '.venv');
  if (!fs.existsSync(venvDir)) {
    console.log('Creating Python virtual environment (.venv)...');
    await run(pyCommand, ['-m', 'venv', '.venv'], { cwd: targetDir });
  } else {
    console.log('Virtual environment already exists, skipping venv creation.');
  }

  const pythonBin =
    process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python');

  console.log('Upgrading pip and installing dependencies (pinning numpy<2)...');
  await run(pythonBin, ['-m', 'pip', 'install', '--upgrade', 'pip'], { cwd: targetDir });
  await run(pythonBin, ['-m', 'pip', 'install', '\"numpy<2\"'], { cwd: targetDir });
  await run(pythonBin, ['-m', 'pip', 'install', '-r', 'requirements.txt'], { cwd: targetDir });

  const configPath = path.join(root, '.autocrop-config.json');
  const config = {
    pythonDir: targetDir,
    pythonCommand: pythonBin,
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log('\nAutoCrop-vertical setup complete.');
  console.log(`Config written to ${configPath}`);
})().catch((err) => {
  console.error('AutoCrop-vertical setup failed:', err.message);
  process.exit(1);
});

