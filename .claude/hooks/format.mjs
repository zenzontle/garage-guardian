// PostToolUse hook: formats each file Claude edits with the project's Prettier,
// so formatting never fails CI. Never blocks the edit; errors are reported only.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());

try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const filePath = JSON.parse(input).tool_input?.file_path;
  if (!filePath) process.exit(0);

  const file = resolve(projectDir, filePath);
  const fromRoot = relative(projectDir, file);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) process.exit(0);

  const require = createRequire(join(projectDir, 'package.json'));
  const prettierModule = await import(pathToFileURL(require.resolve('prettier')).href);
  const prettier = prettierModule.default ?? prettierModule;
  const { ignored, inferredParser } = await prettier.getFileInfo(file, {
    ignorePath: join(projectDir, '.prettierignore'),
  });
  if (ignored || !inferredParser) process.exit(0);

  const source = await readFile(file, 'utf8');
  const options = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(source, { ...options, filepath: file });
  if (formatted !== source) await writeFile(file, formatted);
} catch (error) {
  console.error(`Prettier hook skipped: ${error instanceof Error ? error.message : error}`);
}
