/**
 * One remote A2A delegation turn: continuation lookup, ticket-refresh replay,
 * and stream-recovery snapshot. Pure orchestration over the A2A client with no
 * harness types, shared by the relay tool that now performs the delegation
 * inside the session-backed child agent.
 *
 * @module dsh-plugin-inkstone/subagent/remote-turn
 */
/**
 * Run one delegation turn with continuation ids: replay once on an
 * auth-required interruption after dropping cached tickets, recover the final
 * state of a stream that ended without one, and record the continuation.
 * @param inputs - client, identity, objective, cancellation, and bookkeeping.
 * @returns the consumed turn outcome.
 */
export async function performRemoteTurn(inputs) {
    const { client, agentName, parentSessionId, objective, signal, headers, continuations } = inputs;
    const continuation = continuations.get(parentSessionId, agentName);
    const first = await runTurn(client, objective, signal, continuation);
    let outcome = first;
    if (first.outcome === 'auth-required') {
        headers.invalidateTickets(agentName);
        outcome = await runTurn(client, objective, signal, continuation);
    }
    else if (first.outcome === 'stream-ended' && first.task !== undefined) {
        const snapshot = await client.getTask(first.task.id, { signal });
        outcome = { ...first, outcome: snapshot.task.state };
    }
    continuations.settle(parentSessionId, agentName, outcome);
    return outcome;
}
/**
 * Run one turn with continuation ids and cancellation.
 * @param client - the A2A client.
 * @param objective - the delegation text.
 * @param signal - cancellation.
 * @param continuation - the recorded continuation, when one exists.
 * @returns the consumed turn outcome.
 */
async function runTurn(client, objective, signal, continuation) {
    return await client.runTurn({
        text: objective,
        signal,
        ...(continuation !== undefined ? { contextId: continuation.contextId } : {}),
        ...(continuation?.taskId !== undefined ? { taskId: continuation.taskId } : {}),
    });
}
