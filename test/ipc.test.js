/* eslint-env mocha */
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

function send(pipeName, command, timeoutMs = 1500, maxRetries = 3) {
    const p = `\\\\.\\pipe\\${pipeName}`;
    return new Promise((resolve, reject) => {
        let attempt = 0;
        let socket;
        let data = '';
        let got = false;
        let timer;

        const cleanup = (err) => {
            if (timer) clearTimeout(timer);
            if (socket) {
                socket.removeAllListeners();
                try { socket.end(); } catch { /* ignore */ }
                try { socket.destroy(); } catch { /* ignore */ }
            }
            if (err) reject(err); else resolve(data.trim());
        };

        const start = () => {
            data = '';
            got = false;
            socket = net.createConnection({ path: p });
            timer = setTimeout(() => cleanup(new Error('timeout')), timeoutMs);

            socket.on('connect', () => socket.write(command + '\n'));
            socket.on('data', (chunk) => {
                data += chunk.toString('utf8');
                if (!got && data.includes('\n')) { got = true; cleanup(); }
            });
            socket.on('error', (err) => {
                const code = err && err.code;
                if (got && (code === 'EPIPE' || code === 'ECONNRESET')) {
                    cleanup();
                    return;
                }
                // Retry for transient connect errors
                if ((code === 'ENOENT' || code === 'ECONNREFUSED') && attempt < maxRetries) {
                    attempt++;
                    const backoff = 100 * Math.pow(2, attempt - 1);
                    try { socket.destroy(); } catch { /* ignore */ }
                    setTimeout(start, backoff);
                    return;
                }
                cleanup(err);
            });
            socket.on('end', () => { if (!got) cleanup(); });
        };

        start();
    });
}

describe('IPC client basic', function () {
    this.timeout(10000);

    let child;
    const exe = path.resolve(__dirname, '..', 'windows-service', 'src', 'AutoShutdownService', 'bin', 'Debug', 'net8.0-windows', 'AutoShutdownService.exe');
    // const logDir = path.resolve(__dirname, '..', 'windows-service', 'logs');

    before((done) => {
        // Start service if available; ignore if missing
        child = spawn(exe, [], { stdio: 'ignore', windowsHide: true });
        setTimeout(done, 1000);
    });

    after((done) => {
        if (child && !child.killed) {
            try { process.kill(child.pid); } catch { /* ignore */ }
        }
        setTimeout(done, 500);
    });

    it('responds to PING', async () => {
        const resp = await send('AutoShutdownService', 'PING', 2000);
        assert.strictEqual(resp, 'PONG');
    });

    it('times out for unknown command (server replies err)', async () => {
        const resp = await send('AutoShutdownService', 'UNKNOWN', 2000);
        assert.ok(resp.startsWith('ERR'));
    });
});
