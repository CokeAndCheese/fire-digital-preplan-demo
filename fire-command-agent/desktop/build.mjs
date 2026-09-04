import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const fireDirectory = path.resolve(desktopDirectory, '..');
const runtimeDirectory = path.join(desktopDirectory, 'runtime');
const generatedReleaseDirectory = path.join(desktopDirectory, 'generated-release');
const SCENE_DIRECTORY_ENV = 'FIRE_COMMAND_SCENE_DIR';
const CONFIG_DIRECTORY_ENV = 'FIRE_COMMAND_CONFIG_DIR';
const SECRET_BUILD_KEYS = [
  'AGENT_APP_KEY',
  'SKILL_BRIDGE_TOKEN',
  'FIRE_PLAN_API_TOKEN',
  'PLAN_TEMPLATE_KB_TOKEN',
  'X_APP_KEY',
  'NEXT_PUBLIC_X_APP_KEY',
];

const ALLOWED_ENVIRONMENT_FILES = new Set(['.env.example']);
const FORBIDDEN_RUNTIME_SUFFIXES = new Set(['.exe', '.key', '.p12', '.pem', '.pfx', '.zip']);

function resolveSceneCandidates() {
  const override = process.env[SCENE_DIRECTORY_ENV]?.trim();
  if (override) return [path.resolve(fireDirectory, override)];
  // The checked-in four-directory layout is the primary location. `_parallel`
  // is retained only for older checkouts created by the delivery tooling.
  return [
    path.resolve(fireDirectory, '..', 'workbuddy-3d-simulation'),
    path.resolve(fireDirectory, '..', '_parallel', 'workbuddy-3d-simulation'),
  ];
}

function resolveSceneDirectory() {
  const candidates = resolveSceneCandidates();
  const resolved = candidates.find((candidate) => {
    try {
      return statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
  if (!resolved) {
    throw new Error(`未找到三维场景工程。请检查 ${SCENE_DIRECTORY_ENV}，或确认目录存在：${candidates.join('、')}`);
  }
  return resolved;
}

function isEnvironmentFile(filePath) {
  const name = path.basename(filePath);
  return name === '.env' || name.startsWith('.env.');
}

function isRuntimeSafePath(filePath) {
  if (isEnvironmentFile(filePath)) return false;
  return !FORBIDDEN_RUNTIME_SUFFIXES.has(path.extname(filePath).toLowerCase());
}

function buildEnvironment() {
  const env = { ...process.env };
  // Anything exposed through NEXT_PUBLIC_* is compiled into browser assets by
  // Next. Clear the whole namespace, not only the credential names known today.
  // Runtime values are supplied by the external desktop configuration instead.
  for (const key of Object.keys(env)) {
    if (key.startsWith('NEXT_PUBLIC_')) env[key] = '';
  }
  for (const key of SECRET_BUILD_KEYS) env[key] = '';
  return env;
}

async function sourceEnvironmentFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isEnvironmentFile(entry.name) && !ALLOWED_ENVIRONMENT_FILES.has(entry.name))
    .map((entry) => path.join(directory, entry.name));
}

async function assertPreflightSafety() {
  const sanitized = buildEnvironment();
  if (SECRET_BUILD_KEYS.some((key) => sanitized[key] !== '')) {
    throw new Error('构建预检失败：凭据变量未被清空。');
  }
  if (Object.entries(sanitized).some(([key, value]) => key.startsWith('NEXT_PUBLIC_') && value !== '')) {
    throw new Error('构建预检失败：NEXT_PUBLIC_* 变量未被清空。');
  }
  const environmentFileProbes = ['.env', `${'.env'}.local`, `${'.env'}.production`];
  if (environmentFileProbes.some((probe) => !isEnvironmentFile(probe))) {
    throw new Error('构建预检失败：环境文件过滤器未生效。');
  }
  const forbiddenRuntimeProbes = ['history.zip', 'credential.pem', 'certificate.p12'];
  if (forbiddenRuntimeProbes.some((probe) => isRuntimeSafePath(probe))) {
    throw new Error('构建预检失败：运行时敏感产物过滤器未生效。');
  }
  const unsafeFiles = [
    ...(await sourceEnvironmentFiles(fireDirectory)),
    ...(await sourceEnvironmentFiles(sceneDirectory)),
  ];
  if (unsafeFiles.length > 0) {
    throw new Error(`构建预检失败：源工程存在会被 Next 自动读取的环境文件：${unsafeFiles.join('、')}。请移至外部运行配置目录后重试。`);
  }
}

function run(command, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code}`)));
  });
}

async function copyStandalone(sourceDirectory, destinationDirectory) {
  const standalone = path.join(sourceDirectory, '.next', 'standalone');
  // Next may emit server.js at the standalone root or inside a project-name
  // directory when turbopack's root is above the app. Normalize both layouts
  // so the desktop launcher can always start <runtime>/<app>/server.js.
  let standaloneRoot = standalone;
  if (!existsSync(path.join(standaloneRoot, 'server.js'))) {
    const entries = await readdir(standaloneRoot, { withFileTypes: true });
    const nested = entries.find((entry) => entry.isDirectory() && existsSync(path.join(standaloneRoot, entry.name, 'server.js')));
    if (nested) standaloneRoot = path.join(standaloneRoot, nested.name);
  }
  if (!existsSync(path.join(standaloneRoot, 'server.js'))) {
    throw new Error(`未找到 Next standalone 输出：${standalone}`);
  }
  // 由于工程通过 ../../shared/scenario-registry 引用共享包，Next 会把 standalone 根
  // 提升到工程根，导致 standalone 目录混入整个项目源码与历史产物
  // （desktop/runtime、release、.data、output 等）。这里只复制运行所需条目，
  // 跳过这些历史/源码目录，避免每次打包体积翻倍（desktop/runtime 自带上一轮整包的 650MB+）。
  const SKIP_ENTRIES = new Set(['desktop', 'release', 'output', 'runtime-evidence', '.data', 'skills']);
  for (const entry of await readdir(standaloneRoot, { withFileTypes: true })) {
    if (SKIP_ENTRIES.has(entry.name)) continue;
    await cp(path.join(standaloneRoot, entry.name), path.join(destinationDirectory, entry.name), {
      recursive: true,
      force: true,
      dereference: true,
      filter: isRuntimeSafePath,
    });
  }
  const staticSource = path.join(sourceDirectory, '.next', 'static');
  if (existsSync(staticSource)) await cp(staticSource, path.join(destinationDirectory, '.next', 'static'), {
    recursive: true,
    force: true,
    dereference: true,
    filter: isRuntimeSafePath,
  });
  const publicSource = path.join(sourceDirectory, 'public');
  if (existsSync(publicSource)) await cp(publicSource, path.join(destinationDirectory, 'public'), {
    recursive: true,
    force: true,
    dereference: true,
    filter: isRuntimeSafePath,
  });
}

const mode = process.argv[2];
const sceneDirectory = resolveSceneDirectory();

if (mode === '--preflight') {
  await assertPreflightSafety();
  console.log(`桌面构建预检通过：三维场景目录=${sceneDirectory}`);
  console.log(`构建不会读取或复制源环境文件；运行时配置目录由 ${CONFIG_DIRECTORY_ENV} 覆盖，默认使用 Electron userData/config。`);
  process.exit(0);
}

await assertPreflightSafety();

// 仅清理本脚本专用的可再生产物目录。不得删除工程通用 release 目录，
// 其中可能包含用户手工保存或尚未归档的交付物。
await rm(generatedReleaseDirectory, { recursive: true, force: true });
await rm(runtimeDirectory, { recursive: true, force: true });

const sanitizedBuildEnv = buildEnvironment();
await run('npm run build', fireDirectory, sanitizedBuildEnv);
await run('npm run build', sceneDirectory, sanitizedBuildEnv);
await rm(runtimeDirectory, { recursive: true, force: true });
await mkdir(runtimeDirectory, { recursive: true });
await copyStandalone(fireDirectory, path.join(runtimeDirectory, 'fire'));
await copyStandalone(sceneDirectory, path.join(runtimeDirectory, 'scene'));

// runtime-binding.ts 改为运行时读取冻结绑定清单，不再静态 import：
// 源码/打包都必须带出该 manifest，否则绑定校验退化为空集诊断。这里单独把 4KB 清单拷进运行时。
{
  const manifestSource = path.join(fireDirectory, 'runtime-evidence', 'ustudio-competition-binding-manifest.json');
  if (existsSync(manifestSource)) {
    await mkdir(path.join(runtimeDirectory, 'fire', 'runtime-evidence'), { recursive: true });
    await cp(manifestSource, path.join(runtimeDirectory, 'fire', 'runtime-evidence', 'ustudio-competition-binding-manifest.json'));
  }
}

await writeFile(path.join(runtimeDirectory, 'BUILD-INFO.txt'), `消防指挥智能体\n构建时间：${new Date().toISOString()}\n消防服务：http://127.0.0.1:3100\n三维服务：http://127.0.0.1:3000\n`);

if (mode === '--pack' || mode === '--dist') {
  const builder = mode === '--pack' ? 'npx electron-builder --dir' : 'npx electron-builder --win nsis --x64';
  await run(builder, fireDirectory, sanitizedBuildEnv);
}
