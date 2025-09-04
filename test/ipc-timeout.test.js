/* eslint-env mocha */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-undef */
const assert = require('assert');
const net = require('net');
const path = require('path');

// Use compiled PipeClient from out/ipc.js
const { PipeClient } = require(path.resolve(__dirname, '..', 'out', 'ipc.js'));

function startSilentPipeServer(pipeName) {
    // Create a server that accepts a connection but never replies (to trigger client timeout)
    const pipePath = `\\\\.\\pipe\\${pipeName}`;
    const server = net.createServer((socket) => {
        // Intentionally do nothing; keep connection open for a bit
        socket.on('data', () => { /* ignore */ });
    });
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(pipePath, () => resolve(server));
    });
}

function closeServer(server) {
    return new Promise((resolve) => server.close(() => resolve()));
}

describe('PipeClient timeout behavior', function () {
    this.timeout(10000);

    const pipeName = 'AutoShutdownService_TestTimeout';
    let server;

    before(async () => {
        server = await startSilentPipeServer(pipeName);
    });

    after(async () => {
        if (server) await closeServer(server);
    });

    it('times out when server does not respond', async () => {
        const client = new PipeClient({ pipeName, timeoutMs: 500, maxRetries: 0 });
        try {
            await client.send('PING');
            assert.fail('Expected timeout');
        } catch (e) {
            assert.ok(/timeout/i.test(String(e.message)), 'Should throw timeout error');
        }
    });
});
