import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { subStoreTransformPlugin } from '../vite.config.js';

const transform = subStoreTransformPlugin().transform;
const root = path.resolve('sub-store/backend');
const result = await build({
  entryPoints: [path.join(root, 'src/main.js')], bundle: true, write: false,
  platform: 'browser', format: 'iife', target: 'es2022', minifySyntax: true, external: ['node:*', ...builtinModules],
  alias: { '@': path.join(root, 'src') },
  plugins: [{name: 'worker-source-transform', setup(b) {
    b.onLoad({filter: /\.js$/}, async ({path: id}) => {
      if (!id.replaceAll('\\', '/').includes('sub-store/backend/src/')) return;
      const {readFile} = await import('node:fs/promises');
      const source = await readFile(id, 'utf8');
      return {contents: transform(source, id.replaceAll('\\', '/'))?.code ?? source, loader: 'js', resolveDir: path.dirname(id)};
    });
  }}],
});
await mkdir('src/generated', {recursive: true});
await writeFile('src/generated/substore-engine.js',
  '// Generated at build time. All engine initialization runs INSIDE the request handler.\n' +
  'import * as buffer from "node:buffer";\n' +
  'import * as crypto from "node:crypto";\n' +
  'import * as util from "node:util";\n' +
  'import * as events from "node:events";\n' +
  'export function runSubStoreEngine() {\n' +
  'const require = id => { const modules = {buffer, crypto, util, events}; const key = id.replace(/^node:/, ""); if (key in modules) return modules[key]; throw new Error("Unsupported Node module: " + id); };\n' +
  result.outputFiles[0].text + '\n}\n');
console.log('Request-scoped engine bundled:', result.outputFiles[0].text.length, 'bytes');
