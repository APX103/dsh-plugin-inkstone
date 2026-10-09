/**
 * Authenticated browser access to the experimental agent-registry client:
 * login state and sign-in for the OpenXLab SSO lifecycle, and A2A directory
 * discovery. Per-agent credential headers stay Host-side — no method here
 * returns a token or ticket.
 *
 * @module dsh-plugin-inkstone/remote
 */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Context } from '@deepseek-ai/cordis';
import { RegistryError } from '../registry/index';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/** Project the login state onto its wire view. */
function statusView(state) {
    return {
        configured: state.configured,
        authenticated: state.authenticated,
        registryBaseUrl: state.registryBaseUrl,
        expiresAtMs: state.expiresAtMs ?? null,
        userId: state.userId ?? null,
    };
}
/** Project one directory entry onto its wire view. */
function agentView(entry) {
    return {
        name: entry.name,
        uri: entry.uri ?? null,
        description: entry.description,
        endpointUrl: entry.endpointUrl,
        authScheme: entry.authScheme,
        probeStatus: entry.probeStatus,
    };
}
/**
 * Classify one registry-client failure as a Remote failure. The AK/SK pair
 * never appears in a reason string.
 */
function remoteFailure(error) {
    // Only the gateway wraps failures in RemoteError before this layer; keep
    // such a wrap intact instead of double-classifying it. The registry client
    // itself never throws one.
    /* v8 ignore next 3 -- unreachable from this controller's own services */
    if (error instanceof RemoteError) {
        return error;
    }
    let reason;
    // Registry-client failures are Error instances; anything else degrades to text.
    /* v8 ignore next 5 -- the registry client throws Error values only */
    if (error instanceof Error) {
        reason = error.message;
    }
    else {
        reason = String(error);
    }
    if (error instanceof RegistryError) {
        if (error.code.startsWith('sso-') || error.code === 'not-configured') {
            let code;
            if (error.code === 'not-configured') {
                code = 'a2a/not-configured';
            }
            else {
                code = 'a2a/sso-rejected';
            }
            return new RemoteError(code, reason, { reason });
        }
        return new RemoteError('a2a/discovery-unavailable', reason, { reason });
    }
    return new RemoteError('a2a/discovery-unavailable', reason, { reason });
}
let A2aRegistryController = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _status_decorators;
    let _login_decorators;
    let _logout_decorators;
    let _discover_decorators;
    return class A2aRegistryController extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _status_decorators = [Remote];
            _login_decorators = [Remote];
            _logout_decorators = [Remote];
            _discover_decorators = [Remote];
            __esDecorate(this, null, _status_decorators, { kind: "method", name: "status", static: false, private: false, access: { has: obj => "status" in obj, get: obj => obj.status }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _login_decorators, { kind: "method", name: "login", static: false, private: false, access: { has: obj => "login" in obj, get: obj => obj.login }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _logout_decorators, { kind: "method", name: "logout", static: false, private: false, access: { has: obj => "logout" in obj, get: obj => obj.logout }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _discover_decorators, { kind: "method", name: "discover", static: false, private: false, access: { has: obj => "discover" in obj, get: obj => obj.discover }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static inject = ['a2aRegistry'];
        /** @param ctx - Host context where the registry client service is mounted. */
        constructor(ctx) {
            super(ctx, 'a2aRegistryController', { namespace: 'a2aRegistry' });
            __runInitializers(this, _instanceExtraInitializers);
        }
        /**
         * Read the login state without network activity.
         * @returns whether credentials are stored and the cached token state.
         */
        async status() {
            return statusView(await this.ctx.a2aRegistry.status());
        }
        /**
         * Store an AK/SK pair and prime the SSO session, rejecting bad pairs. The
         * pair crosses the wire in this direction only; no read path returns it.
         * @param ak - the access key.
         * @param sk - the secret key.
         */
        async login(ak, sk) {
            try {
                await this.ctx.a2aRegistry.login(ak, sk);
            }
            catch (error) {
                throw remoteFailure(error);
            }
        }
        /**
         * Remove the stored AK/SK pair and every in-memory token.
         */
        async logout() {
            await this.ctx.a2aRegistry.logout();
        }
        /**
         * Discover the visible A2A agents from the registry directory.
         * @param signal - Client cancellation.
         * @returns the directory entries in registry order.
         */
        async discover(signal) {
            try {
                signal.throwIfAborted();
                const entries = await this.ctx.a2aRegistry.discover(signal);
                return entries.map(agentView);
            }
            catch (error) {
                throw remoteFailure(error);
            }
        }
    };
})();
/**
 * Remote owner of the `a2aRegistry` namespace over the Host registry client.
 */
export default A2aRegistryController;
