// PostToolUse hook: formats each file Claude edits with the Prettier installed for it,
// so formatting never fails CI. Never blocks the edit; errors are reported only.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());

// The nearest folder with a package.json, so a package in a subfolder uses its own Prettier.
function packageDir(file) {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    if (dir === projectDir || dirname(dir) === dir) return null;
  }
}

try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const filePath = JSON.parse(input).tool_input?.file_path;
  if (!filePath) process.exit(0);

  const file = resolve(projectDir, filePath);
  const fromRoot = relative(projectDir, file);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) process.exit(0);

  const root = packageDir(file);
  if (!root) process.exit(0);
  const require = createRequire(join(root, 'package.json'));
  const prettierModule = await import(pathToFileURL(require.resolve('prettier')).href);
  const prettier = prettierModule.default ?? prettierModule;
  const { ignored, inferredParser } = await prettier.getFileInfo(file, {
    ignorePath: join(root, '.prettierignore'),
  });
  if (ignored || !inferredParser) process.exit(0);

  const source = await readFile(file, 'utf8');
  const options = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(source, { ...options, filepath: file });
  if (formatted !== source) await writeFile(file, formatted);
} catch (error) {
  console.error(`Prettier hook skipped: ${error instanceof Error ? error.message : error}`);
}
