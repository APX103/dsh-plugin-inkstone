/**
 * Remote owner of the `scpHub` namespace over the host SCP Hub service:
 * catalog search, detail reads, and the execution API key. The API key never
 * crosses to the browser in listings — only `apiKeyHeaders` for MCP mounts,
 * which the host itself performs.
 *
 * @module dsh-plugin-inkstone/scphub/remote
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
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { loadBuiltinSkills } from '../skills/builtin';
import { installLocalSkill, uninstallLocalSkill } from './mirror';
/** Project one catalog hit onto its wire view. */
function itemView(item) {
    return {
        id: item.id,
        type: item.type,
        name: item.name,
        description: item.description,
        publisher: item.publisher,
        tags: item.tags,
        official: item.official,
        viewCount: item.viewCount,
        downloadCount: item.downloadCount,
        invocationCount: item.invocationCount,
        toolsCount: item.toolsCount ?? null,
    };
}
/** Project one page onto its wire view. */
function pageView(page) {
    return { total: page.total, page: page.page, pageSize: page.pageSize, items: page.items.map(itemView) };
}
/** Project one SCP detail onto its wire view. */
function scpView(detail) {
    return {
        id: detail.id,
        name: detail.name,
        description: detail.description,
        publisher: detail.publisher,
        endpoint: detail.endpoint,
        offline: detail.offline,
        tools: detail.tools.map((tool) => ({ name: tool.name, description: tool.description })),
    };
}
/** Project one skill detail onto its wire view. */
function skillView(detail) {
    return {
        id: detail.id,
        name: detail.name,
        description: detail.description,
        publisher: detail.publisher,
        offline: detail.offline,
        hasToolkit: detail.toolkitUrl !== undefined,
    };
}
/** Classify one service failure as a Remote failure. */
function remoteFailure(error) {
    if (error instanceof RemoteError) {
        return error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    return new RemoteError('scphub/unavailable', reason, { reason });
}
let ScpHubController = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _search_decorators;
    let _scpDetail_decorators;
    let _skillDetail_decorators;
    let _addScp_decorators;
    let _installSkill_decorators;
    let _removeSkill_decorators;
    let _builtinSkills_decorators;
    return class ScpHubController extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _search_decorators = [Remote];
            _scpDetail_decorators = [Remote];
            _skillDetail_decorators = [Remote];
            _addScp_decorators = [Remote];
            _installSkill_decorators = [Remote];
            _removeSkill_decorators = [Remote];
            _builtinSkills_decorators = [Remote];
            __esDecorate(this, null, _search_decorators, { kind: "method", name: "search", static: false, private: false, access: { has: obj => "search" in obj, get: obj => obj.search }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _scpDetail_decorators, { kind: "method", name: "scpDetail", static: false, private: false, access: { has: obj => "scpDetail" in obj, get: obj => obj.scpDetail }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _skillDetail_decorators, { kind: "method", name: "skillDetail", static: false, private: false, access: { has: obj => "skillDetail" in obj, get: obj => obj.skillDetail }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _addScp_decorators, { kind: "method", name: "addScp", static: false, private: false, access: { has: obj => "addScp" in obj, get: obj => obj.addScp }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _installSkill_decorators, { kind: "method", name: "installSkill", static: false, private: false, access: { has: obj => "installSkill" in obj, get: obj => obj.installSkill }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _removeSkill_decorators, { kind: "method", name: "removeSkill", static: false, private: false, access: { has: obj => "removeSkill" in obj, get: obj => obj.removeSkill }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _builtinSkills_decorators, { kind: "method", name: "builtinSkills", static: false, private: false, access: { has: obj => "builtinSkills" in obj, get: obj => obj.builtinSkills }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static inject = ['scpHub'];
        /** Install options; public because Remote dispatch invokes through the
         * context's tracing proxy, where private members are inaccessible. */
        options = __runInitializers(this, _instanceExtraInitializers);
        /**
         * @param ctx - Host context where the SCP Hub service is mounted.
         * @param options - install root and unpack bounds.
         */
        constructor(ctx, options) {
            super(ctx, 'scpHubController', { namespace: 'scpHub' });
            this.options = options;
        }
        /**
         * Search the catalog for SCP services or skills.
         * @param type - resource kind.
         * @param keyword - optional search text.
         * @param page - zero-based page index.
         * @param signal - client cancellation.
         * @returns one catalog page.
         */
        async search(type, keyword, page, signal) {
            try {
                signal.throwIfAborted();
                const options = { page };
                if (keyword !== null && keyword !== '')
                    options.keyword = keyword;
                return pageView(await this.ctx.scpHub.search(type, options));
            }
            catch (error) {
                throw remoteFailure(error);
            }
        }
        /**
         * Full detail for one SCP server.
         * @param id - catalog server id.
         * @param signal - client cancellation.
         * @returns the detail with its tool inventory.
         */
        async scpDetail(id, signal) {
            try {
                signal.throwIfAborted();
                return scpView(await this.ctx.scpHub.scpDetail(id));
            }
            catch (error) {
                throw remoteFailure(error);
            }
        }
        /**
         * Full detail for one skill.
         * @param id - catalog skill id.
         * @param signal - client cancellation.
         * @returns the detail (without signed URLs).
         */
        async skillDetail(id, signal) {
            try {
                signal.throwIfAborted();
                return skillView(await this.ctx.scpHub.skillDetail(id));
            }
            catch (error) {
                throw remoteFailure(error);
            }
        }
        /**
         * Resolve one SCP server's detail for local addition; the caller persists
         * the returned facts into its own config.
         * @param id - catalog server id.
         * @param signal - client cancellation.
         * @returns the detail with its tool inventory.
         */
        async addScp(id, signal) {
            try {
                signal.throwIfAborted();
                return scpView(await this.ctx.scpHub.scpDetail(id));
            }
            catch (error) {
                throw remoteFailure(error);
            }
        }
        /**
         * Download, unpack, and install one skill; the caller persists the returned
         * entry into its own config.
         * @param id - catalog skill id.
         * @param signal - client cancellation.
         * @returns the installed local-entry facts.
         */
        async installSkill(id, signal) {
            try {
                signal.throwIfAborted();
                const archive = await this.ctx.scpHub.skillArchive(id, this.options.maxToolkitBytes);
                const local = await installLocalSkill(this.options.skillsRoot, id, archive.name, archive.description, archive.content, archive.toolkit, {
                    maxEntries: this.options.maxToolkitEntries,
                    maxTotalBytes: this.options.maxToolkitBytes,
                });
                return { id: local.id, skillName: local.skillName, name: local.name, description: local.description };
            }
            catch (error) {
                throw remoteFailure(error);
            }
        }
        /**
         * Remove one installed skill's directory; the caller removes its config row.
         * @param id - catalog skill id.
         * @param signal - client cancellation.
         */
        async removeSkill(id, signal) {
            try {
                signal.throwIfAborted();
                await uninstallLocalSkill(this.options.skillsRoot, id);
            }
            catch (error) {
                throw remoteFailure(error);
            }
        }
        /**
         * List the bundled scientific skills shipped with the plugin; enable state
         * is config-owned and rendered client-side from the settings form.
         * @param signal - client cancellation.
         * @returns the shipped skill catalog facts.
         */
        async builtinSkills(signal) {
            try {
                signal.throwIfAborted();
                const skills = await loadBuiltinSkills(this.options.builtinSkillsRoot);
                return skills.map(skill => ({ name: skill.name, description: skill.description }));
            }
            catch (error) {
                throw remoteFailure(error);
            }
        }
    };
})();
/**
 * Remote owner of the `scpHub` namespace.
 */
export default ScpHubController;
