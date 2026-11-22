// Accept the preview runner's --host/--strictPort flags as well as npm run dev.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || '3000';
if (!/^\d{1,5}$/.test(port) || +port < 1 || +port > 65535) throw new Error('Invalid port');
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '0.0.0.0', '--port', port], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
