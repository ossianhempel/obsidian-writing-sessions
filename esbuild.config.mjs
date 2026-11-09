import * as esbuild from 'esbuild';
const context = await esbuild.context({
  entryPoints: ['src/main.ts'], bundle: true, outfile: 'main.js', format: 'cjs',
  target: 'es2022', platform: 'browser', sourcemap: process.argv.includes('--watch') ? 'inline' : false,
  external: ['obsidian', '@codemirror/state', '@codemirror/view', '@codemirror/commands'],
  banner: { js: '/* Writing Sessions | MIT License | https://github.com/ossianhempel/obsidian-writing-sessions */' }
});
if (process.argv.includes('--watch')) await context.watch();
else { await context.rebuild(); await context.dispose(); }
