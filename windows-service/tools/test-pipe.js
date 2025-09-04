const net = require('net');

function send(pipeName, command, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const path = `\\\\.\\pipe\\${pipeName}`;
        const socket = net.createConnection({ path });
        let data = '';
        let timer;
        let gotResponse = false;

        const cleanup = (err) => {
            clearTimeout(timer);
            socket.removeAllListeners();
            try { socket.end(); } catch { }
            try { socket.destroy(); } catch { }
            if (err) reject(err); else resolve(data.trim());
        };

        socket.on('connect', () => {
            console.error('[client] connected');
            socket.write(command + '\n');
        });
        socket.on('data', (chunk) => {
            const s = chunk.toString('utf8');
            console.error('[client] data:', JSON.stringify(s));
            data += s;
            if (data.includes('\n') && !gotResponse) {
                gotResponse = true;
                cleanup();
            }
        });
        socket.on('end', () => {
            console.error('[client] end');
            cleanup();
        });
        socket.on('close', (hadError) => {
            console.error('[client] close hadError=', hadError);
        });
        socket.on('error', (err) => {
            console.error('[client] error:', err && err.code, err && err.message);
            if (gotResponse && (err.code === 'EPIPE' || err.code === 'ECONNRESET')) {
                // treat as graceful close after response
                cleanup();
            } else {
                cleanup(err);
            }
        });
        timer = setTimeout(() => cleanup(new Error('timeout')), timeoutMs);
    });
}

async function main() {
    const [, , command = 'PING', pipeName = 'AutoShutdownService'] = process.argv;
    try {
        const resp = await send(pipeName, command);
        console.log(resp);
    } catch (e) {
        console.error('ERROR:', e.message);
        process.exit(1);
    }
}

main();
