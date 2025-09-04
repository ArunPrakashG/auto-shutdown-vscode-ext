import * as net from 'net';

export interface PipeClientOptions {
    pipeName: string;
    timeoutMs: number;
    maxRetries?: number;
    initialBackoffMs?: number;
}

export class PipeClient {
    private readonly path: string;
    private readonly timeoutMs: number;
    private readonly maxRetries: number;
    private readonly initialBackoffMs: number;

    constructor(opts: PipeClientOptions) {
        // Windows named pipe path: \\.\pipe\<name>
        this.path = `\\\\.\\pipe\\${opts.pipeName}`;
        this.timeoutMs = opts.timeoutMs;
        this.maxRetries = opts.maxRetries ?? 2; // small retry count
        this.initialBackoffMs = opts.initialBackoffMs ?? 200;
    }

    async send(command: string): Promise<string> {
        let lastErr: unknown;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                const resp = await this.sendOnce(command);
                return resp.trim();
            } catch (err: unknown) {
                lastErr = err;
                if (attempt === this.maxRetries || !this.isTransient(err)) {
                    break;
                }
                const delay = this.computeBackoff(attempt);
                await this.sleep(delay);
            }
        }
        throw lastErr;
    }

    private sendOnce(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({ path: this.path });
            const timer: NodeJS.Timeout = setTimeout(() => cleanup(new Error(`Pipe timeout after ${this.timeoutMs}ms`)), this.timeoutMs);
            let data = '';
            let gotResponse = false;

            const cleanup = (err?: Error) => {
                clearTimeout(timer);
                socket.removeAllListeners();
                try { socket.end(); } catch { /* noop */ }
                try { socket.destroy(); } catch { /* noop */ }
                if (err) reject(err); else resolve(data);
            };

            socket.on('connect', () => {
                socket.write(command + '\n');
            });

            socket.on('data', (chunk: Buffer) => {
                data += chunk.toString('utf8');
                if (!gotResponse && data.includes('\n')) {
                    gotResponse = true;
                    cleanup();
                }
            });

            socket.on('end', () => cleanup());
            socket.on('error', (err: NodeJS.ErrnoException) => {
                if (gotResponse && (err.code === 'EPIPE' || err.code === 'ECONNRESET')) {
                    cleanup();
                } else {
                    cleanup(err);
                }
            });

            // timer already created above
        });
    }

    private isTransient(err: unknown): boolean {
        const e = err as Partial<NodeJS.ErrnoException> & { message?: string };
        const code = e.code ?? '';
        // Treat connection/pipe-not-ready/timeouts as transient
        const codeTransient = code === 'ECONNREFUSED' || code === 'ENOENT' || code === 'EPIPE' || code === 'ECONNRESET';
        const msgTransient = typeof e.message === 'string' && e.message.toLowerCase().includes('timeout');
        return !!(codeTransient || msgTransient);
    }

    private computeBackoff(attempt: number): number {
        const base = this.initialBackoffMs * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 100);
        return base + jitter; // e.g., 200ms, 400ms, 800ms + jitter
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((res) => setTimeout(res, ms));
    }
}
