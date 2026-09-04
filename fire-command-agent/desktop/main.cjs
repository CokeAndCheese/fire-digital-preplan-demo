'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { inspectServiceHealth } = require('./health-check.cjs');

const FIRE_PORT = 3100;
const SCENE_PORT = 3000;
const FIRE_URL = `http://127.0.0.1:${FIRE_PORT}`;
const SCENE_URL = `http://127.0.0.1:${SCENE_PORT}`;
const CONFIG_DIRECTORY_ENV = 'FIRE_COMMAND_CONFIG_DIR';
const RUNTIME_SECRET_KEYS = [
  'AGENT_APP_KEY',
  'SKILL_BRIDGE_TOKEN',
  'FIRE_PLAN_API_TOKEN',
  'PLAN_TEMPLATE_KB_TOKEN',
  'X_APP_KEY',
  'NEXT_PUBLIC_X_APP_KEY',
];
const CONFIG_TEMPLATES = {
  'fire.env': [
    '# 消防指挥台运行配置。请在此填写客户自己的值；空值会保留本地界面，但远端能力会明确失败。',
    'AGENT_RUNTIME_MODE=remote',
    'AGENT_GATEWAY=',
    'AGENT_APP_KEY=',
    'AGENT_COMPETITION_APP_ID=',
    'AGENT_STREAM_TIMEOUT_MS=90000',
    'AGENT_GATEWAY_TIMEOUT_MS=12000',
    'SCENE_CONTROL_URL=',
    'RESPONSE_LEVEL_URL=',
    'ROUTE_WATER_URL=',
    'RESCUE_PLAN_URL=',
    'COMPETITION_ORCHESTRATOR_URL=',
    'FIRE_RESOURCE_PLATFORM_URL=',
    'SKILL_BRIDGE_TOKEN=',
    'FIRE_PLAN_API_TOKEN=',
    'PLAN_TEMPLATE_KB_TOKEN=',
    'FIRE_PLAN_STORAGE_PATH=',
    'FIRE_PLAN_TEMPLATE_PATH=',
    'FIRE_PLAN_EXPORT_DIR=',
    '',
  ].join('\n'),
  'scene.env': [
    '# 三维场景运行配置。请在此填写客户自己的值；不要把密钥写入安装包或启动参数。',
    'X_APP_KEY=',
    'USTUDIO_GATEWAY=https://fc.xwbuilders.com',
    'AGENT_GATEWAY=',
    '',
  ].join('\n'),
};

let mainWindow;
const children = [];
let quitting = false;

function runtimeRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'apps')
    : path.join(__dirname, 'runtime');
}

function configurationDirectory() {
  const override = process.env[CONFIG_DIRECTORY_ENV]?.trim();
  return override ? path.resolve(override) : path.join(app.getPath('userData'), 'config');
}

function configurationFile(name) {
  return path.join(configurationDirectory(), name);
}

function ensureConfigurationTemplates() {
  const directory = configurationDirectory();
  try {
    fs.mkdirSync(directory, { recursive: true });
    for (const [name, content] of Object.entries(CONFIG_TEMPLATES)) {
      try {
        // wx is intentional: a customer's existing configuration is never overwritten.
        fs.writeFileSync(path.join(directory, name), content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
  } catch (error) {
    appendLog('desktop', `无法创建外部运行配置模板；本地界面仍会尝试启动，远端能力可能不可用。${error?.code ? `（${error.code}）` : ''}\n`);
  }
  return directory;
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const values = {};
    for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
    return values;
  } catch {
    // An unreadable configuration must not prevent the local UI from opening.
    return {};
  }
}

function mergedEnv(filePath, port) {
  const configured = readEnvFile(filePath);
  const inherited = { ...process.env };
  // Credentials are accepted only from the external file, never from the
  // launcher environment inherited by the packaged desktop process.
  for (const key of RUNTIME_SECRET_KEYS) delete inherited[key];
  return {
    ...inherited,
    ...configured,
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
    ELECTRON_RUN_AS_NODE: '1',
  };
}

function logPath() {
  return path.join(app.getPath('userData'), 'logs');
}

function appendLog(name, text) {
  try {
    fs.mkdirSync(logPath(), { recursive: true });
    fs.appendFileSync(path.join(logPath(), `${name}.log`), text, 'utf8');
  } catch {
    // Logging must never prevent the command center from starting.
  }
}

async function waitForService(url, expectedService, child) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const health = await inspectServiceHealth(url, expectedService);
    if (health.state === 'expected') return true;
    if (child && child.exitCode !== null) return false;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function startService(name, directory, envFile, port, healthUrl, expectedService) {
  const initialHealth = await inspectServiceHealth(healthUrl, expectedService);
  if (initialHealth.state === 'expected') return { owned: false, child: null };
  if (initialHealth.state === 'occupied') {
    throw new Error(`端口 ${port} 已被非预期服务占用；为避免连接错误进程，${name} 未启动。`);
  }
  const serverPath = path.join(directory, 'server.js');
  if (!fs.existsSync(serverPath)) throw new Error(`缺少 ${name} 生产服务文件：${serverPath}`);
  const child = spawn(process.execPath, [serverPath], {
    cwd: directory,
    env: mergedEnv(envFile, port),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => appendLog(name, chunk.toString()));
  child.stderr.on('data', (chunk) => appendLog(name, chunk.toString()));
  child.on('error', (error) => appendLog(name, `${error.stack || error}\n`));
  children.push(child);
  if (!(await waitForService(healthUrl, expectedService, child))) {
    throw new Error(`${name} 服务未能在 60 秒内启动，请查看 ${logPath()}。`);
  }
  return { owned: true, child };
}

function stopServices() {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {});
    } else {
      child.kill('SIGTERM');
    }
  }
}

async function createWindow() {
  const configDirectory = ensureConfigurationTemplates();
  const fireConfig = readEnvFile(path.join(configDirectory, 'fire.env'));
  const sceneConfig = readEnvFile(path.join(configDirectory, 'scene.env'));
  const missing = [];
  if (!fireConfig.AGENT_APP_KEY?.trim()) missing.push('消防远端凭据');
  if (!(sceneConfig.X_APP_KEY || sceneConfig.NEXT_PUBLIC_X_APP_KEY)?.trim()) missing.push('三维平台凭据');
  if (missing.length > 0) {
    appendLog('desktop', `外部运行配置未完成（${missing.join('、')}）；本地界面仍会启动，相关远端操作将返回未配置或不可用。\n`);
  }
  const root = runtimeRoot();
  await startService(
    '三维场景',
    path.join(root, 'scene'),
    configurationFile('scene.env'),
    SCENE_PORT,
    `${SCENE_URL}/health`,
    'fire-scene-command-bridge',
  );
  await startService(
    '消防指挥台',
    path.join(root, 'fire'),
    configurationFile('fire.env'),
    FIRE_PORT,
    `${FIRE_URL}/health`,
    'fire-command-agent',
  );
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 1000,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#0d1418',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(FIRE_URL);
}

app.setAppUserModelId('com.xwbuilders.fire-command-agent');
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(async () => {
    try {
      await createWindow();
    } catch (error) {
      appendLog('desktop', `${error.stack || error}\n`);
      await dialog.showMessageBox({
        type: 'error',
        title: '消防指挥智能体启动失败',
        message: error instanceof Error ? error.message : String(error),
        detail: `日志目录：${logPath()}`,
      });
      app.quit();
    }
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(() => app.quit());
  });
  app.on('before-quit', () => {
    if (quitting) return;
    quitting = true;
    stopServices();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
