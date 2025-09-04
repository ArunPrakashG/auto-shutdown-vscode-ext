import * as vscode from 'vscode';
import { PipeClient } from './ipc';

function getConfig() {
    const cfg = vscode.workspace.getConfiguration();
    return {
        enabled: cfg.get<boolean>('autoShutdown.enabled', false),
        dryRun: cfg.get<boolean>('autoShutdown.dryRun', true),
        pipeName: cfg.get<string>('autoShutdown.pipeName', 'AutoShutdownService'),
        confirm: cfg.get<boolean>('autoShutdown.confirmBeforeShutdown', true),
        timeoutMs: cfg.get<number>('autoShutdown.timeoutMs', 3000)
    };
}

export function activate(context: vscode.ExtensionContext) {
    // Register toggle command
    context.subscriptions.push(
        vscode.commands.registerCommand('auto-shutdown.toggle', async () => {
            const cfg = vscode.workspace.getConfiguration();
            const current = cfg.get<boolean>('autoShutdown.enabled', false);
            await cfg.update('autoShutdown.enabled', !current, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Auto Shutdown ${!current ? 'enabled' : 'disabled'}.`);
        })
    );

    // Chat participant
    const participant = vscode.chat.createChatParticipant('auto-shutdown.participant', handler);
    context.subscriptions.push(participant);
}

export function deactivate() {
    // noop
}

type HandlerResult = { metadata: Record<string, unknown> };

const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
) => {
    const settings = getConfig();

    // If no model available, inform user
    if (!request.model) {
        stream.markdown('No language model available for this chat.');
        return { metadata: { status: 'no-model' } } as HandlerResult;
    }

    // Build a minimal prompt: pass-through user prompt
    const messages = [
        vscode.LanguageModelChatMessage.User(request.prompt)
    ];

    let chatResponse: vscode.LanguageModelChatResponse | undefined;
    try {
        chatResponse = await request.model.sendRequest(messages, {}, token);
    } catch (err: unknown) {
        if (err instanceof vscode.LanguageModelError) {
            const lmErr = err as vscode.LanguageModelError;
            stream.markdown(`Language model error: ${lmErr.message}`);
            return { metadata: { status: 'lm-error', code: lmErr.code } } as HandlerResult;
        }
        const e = err as Error;
        stream.markdown(`Language model error: ${e.message}`);
        return { metadata: { status: 'lm-error-unknown' } } as HandlerResult;
    }

    // Stream response back to chat
    try {
        for await (const fragment of chatResponse.text) {
            if (token.isCancellationRequested) {
                return { metadata: { status: 'canceled' } } as HandlerResult;
            }
            if (fragment) {
                stream.markdown(fragment);
            }
        }
    } catch (err: unknown) {
        const e = err as Error;
        stream.markdown(`Streaming error: ${e.message}`);
    }

    // End-of-stream reached: optionally trigger shutdown
    if (!settings.enabled) {
        stream.progress('Auto Shutdown is disabled. Skipping shutdown signal.');
        return { metadata: { status: 'done', shutdown: 'skipped-disabled' } } as HandlerResult;
    }

    if (settings.confirm) {
        const confirm = await vscode.window.showWarningMessage(
            settings.dryRun
                ? 'Send DRY RUN shutdown signal to AutoShutdownService?'
                : 'Send SHUTDOWN signal to AutoShutdownService? This will power off your PC.',
            { modal: true },
            settings.dryRun ? 'Send Dry Run' : 'Yes, shut down'
        );
        if (!confirm) {
            stream.progress('User canceled shutdown signal.');
            return { metadata: { status: 'done', shutdown: 'canceled' } } as HandlerResult;
        }
    }

    const client = new PipeClient({ pipeName: settings.pipeName, timeoutMs: settings.timeoutMs });
    const command = settings.dryRun ? 'DRYRUN' : 'SHUTDOWN';
    try {
        const response = await client.send(command);
        stream.progress(`Service response: ${response?.trim()}`);
    } catch (err: unknown) {
        const e = err as Error;
        // Escape backslashes for chat markdown
        const pipe = `\\\\.\\pipe\\${settings.pipeName}`;
        stream.progress(`Failed to contact service on ${pipe}: ${e.message}`);
        return { metadata: { status: 'done', shutdown: 'service-failed' } } as HandlerResult;
    }

    return { metadata: { status: 'done', shutdown: command } } as HandlerResult;
};
