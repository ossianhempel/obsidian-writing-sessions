import { mkdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await mkdir('release/writing-sessions', { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) await copyFile(file, `release/writing-sessions/${file}`);
execFileSync('zip', ['-j', '-q', 'release/writing-sessions.zip', 'release/writing-sessions/main.js', 'release/writing-sessions/manifest.json', 'release/writing-sessions/styles.css']);
console.log('Built release/writing-sessions.zip');
