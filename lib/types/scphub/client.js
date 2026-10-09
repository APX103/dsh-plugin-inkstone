/**
 * Read-only SCP Hub directory client: catalog search, SCP detail with tool
 * inventory, and skill detail with signed download locations. Every response
 * is strictly validated; failures surface as {@link ScpHubError}.
 *
 * @module dsh-plugin-inkstone/scphub/client
 */
import { ScpHubError } from './error';
const DESCRIPTION_MAX_BYTES = 4096;
const NAME_MAX_BYTES = 256;
function boundedText(value, label, maxBytes) {
    if (typeof value !== 'string') {
        throw new ScpHubError('invalid-response', `SCP Hub ${label} is malformed`);
    }
    if (Buffer.byteLength(value, 'utf8') > maxBytes) {
        throw new ScpHubError('invalid-response', `SCP Hub ${label} exceeds its bound`);
    }
    return value;
}
function countOf(value) {
    return Number(value) || 0;
}
function stringId(value) {
    return String(value ?? '');
}
function tagNames(value) {
    if (!Array.isArray(value))
        return [];
    const names = [];
    for (const tag of value) {
        if (tag !== null && typeof tag === 'object') {
            const name = tag.name;
            if (typeof name === 'string' && name !== '')
                names.push(name);
        }
        else if (typeof tag === 'string' && tag !== '') {
            names.push(tag);
        }
    }
    return names.slice(0, 16);
}
/**
 * The SCP Hub directory client.
 */
export class ScpHubClient {
    #options;
    /**
     * @param options - API base, bearer supplier, and test fetch hook.
     */
    constructor(options) {
        this.#options = options;
    }
    /**
     * Search the catalog for SCP services or skills.
     * @param type - which resource kind to list.
     * @param options - keyword, tag filter, and pagination.
     * @returns one page of catalog hits.
     */
    async search(type, options = {}) {
        const params = new URLSearchParams({
            page: String(options.page ?? 0),
            page_size: String(options.pageSize ?? 20),
            types: type,
        });
        const keyword = options.keyword?.trim() ?? '';
        if (keyword !== '')
            params.set('keyword', keyword);
        const data = await this.#requestJson(`/scphub/v1/search/query?${params.toString()}`);
        const list = data.list;
        if (!Array.isArray(list)) {
            throw new ScpHubError('invalid-response', 'SCP Hub search response is malformed');
        }
        const items = list.map(item => this.#catalogItem(item, type));
        const total = countOf(type === 'skill' ? data.skill_total ?? data.total : data.scp_total ?? data.total);
        return { total, page: options.page ?? 0, pageSize: options.pageSize ?? 20, items };
    }
    /**
     * Full detail for one SCP server, including its tool inventory.
     * @param id - catalog server id.
     * @returns the validated detail.
     */
    async scpDetail(id) {
        const [detailData, toolsData] = await Promise.all([
            this.#requestJson(`/scphub/v1/scp/details?server_ids=${encodeURIComponent(id)}`),
            this.#requestJson(`/scphub/v1/scp/tools/list?server_id=${encodeURIComponent(id)}`),
        ]);
        const row = (Array.isArray(detailData.list) ? detailData.list : []).find(candidate => stringId(candidate?.id) === id);
        if (row === null || row === undefined) {
            throw new ScpHubError('invalid-response', `SCP Hub has no SCP ${id}`);
        }
        const record = row;
        const endpoint = typeof record.endpoint === 'string' ? record.endpoint.trim() : '';
        if (endpoint === '') {
            throw new ScpHubError('invalid-response', `SCP ${id} publishes no endpoint`);
        }
        const tools = (Array.isArray(toolsData.list) ? toolsData.list : []).map(tool => {
            const rowTool = tool;
            return {
                name: boundedText(rowTool.name, 'tool name', NAME_MAX_BYTES),
                description: boundedText(rowTool.description ?? rowTool.title ?? '', 'tool description', DESCRIPTION_MAX_BYTES),
            };
        });
        return {
            id,
            name: boundedText(record.server_name, 'SCP name', NAME_MAX_BYTES),
            description: boundedText(record.brief_description_zh ?? record.brief_description_en ?? record.brief_description ?? '', 'SCP description', DESCRIPTION_MAX_BYTES),
            publisher: typeof record.publisher === 'string' ? record.publisher : '',
            endpoint,
            offline: record.status === 'offline',
            tools,
        };
    }
    /**
     * Full detail for one skill, including its signed download locations.
     * @param id - catalog skill id.
     * @returns the validated detail.
     */
    async skillDetail(id) {
        const data = await this.#requestJson(`/scphub/v1/skill/details?server_ids=${encodeURIComponent(id)}`);
        const row = (Array.isArray(data.list) ? data.list : []).find(candidate => stringId(candidate?.id) === id);
        if (row === null || row === undefined) {
            throw new ScpHubError('invalid-response', `SCP Hub has no skill ${id}`);
        }
        const record = row;
        const bodyUrl = typeof record.skill_md_signed_url === 'string' ? record.skill_md_signed_url.trim() : '';
        if (bodyUrl === '') {
            throw new ScpHubError('skill-unavailable', `Skill ${id} publishes no body`);
        }
        const toolkitUrl = typeof record.toolkit_signed_url === 'string' && record.toolkit_signed_url.trim() !== ''
            ? record.toolkit_signed_url.trim()
            : undefined;
        return {
            id,
            name: boundedText(record.skill_name ?? record.name, 'skill name', NAME_MAX_BYTES),
            description: boundedText(record.brief_description_zh ?? record.brief_description_en ?? record.brief_description ?? '', 'skill description', DESCRIPTION_MAX_BYTES),
            publisher: typeof record.publisher === 'string' ? record.publisher : '',
            offline: record.status === 'offline',
            bodyUrl,
            toolkitUrl,
        };
    }
    /**
     * Download one signed resource (skill body or toolkit) without credentials.
     * @param url - the signed URL from a detail response.
     * @param maxBytes - response size bound.
     * @returns the raw bytes.
     */
    async download(url, maxBytes) {
        const baseFetch = this.#options.fetchImpl ?? fetch;
        let response;
        try {
            response = await baseFetch(url, {
                headers: { accept: 'application/octet-stream, application/zip, text/markdown' },
                redirect: 'error',
            });
        }
        catch (error) {
            throw new ScpHubError('hub-unreachable', `SCP Hub resource download failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!response.ok) {
            throw new ScpHubError('hub-rejected', `SCP Hub resource download returned HTTP ${response.status}`);
        }
        const buffer = new Uint8Array(await response.arrayBuffer());
        if (buffer.byteLength > maxBytes) {
            throw new ScpHubError('invalid-response', 'SCP Hub resource exceeds its size bound');
        }
        return buffer;
    }
    #catalogItem(value, type) {
        if (value === null || typeof value !== 'object') {
            throw new ScpHubError('invalid-response', 'SCP Hub catalog row is malformed');
        }
        const record = value;
        const scpExt = record.scp_ext;
        const skillExt = record.skill_ext;
        return {
            id: stringId(record.id),
            type,
            name: boundedText(record.name, 'catalog name', NAME_MAX_BYTES),
            description: boundedText(record.brief_description_zh ?? record.brief_description ?? '', 'catalog description', DESCRIPTION_MAX_BYTES),
            publisher: typeof record.publisher === 'string' ? record.publisher : '',
            tags: [...tagNames(record.tags), ...tagNames(record.custom_tags)],
            official: record.is_official === true,
            viewCount: countOf(record.stats?.view_count),
            downloadCount: countOf(skillExt?.download_count ?? record.download_count),
            invocationCount: countOf(scpExt?.invocation_count ?? record.invocation_count),
            toolsCount: scpExt?.tools_count !== undefined ? countOf(scpExt.tools_count) : undefined,
        };
    }
    async #requestJson(path) {
        const bearer = await this.#options.bearer();
        const baseFetch = this.#options.fetchImpl ?? fetch;
        let response;
        try {
            response = await baseFetch(`${this.#options.apiBaseUrl}${path}`, {
                headers: { accept: 'application/json', authorization: `Bearer ${bearer}` },
                redirect: 'error',
            });
        }
        catch (error) {
            throw new ScpHubError('hub-unreachable', `SCP Hub request failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (response.status === 401 || response.status === 403) {
            throw new ScpHubError('sso-rejected', 'SCP Hub rejected the SSO bearer');
        }
        if (!response.ok) {
            throw new ScpHubError('hub-rejected', `SCP Hub returned HTTP ${response.status}`);
        }
        const envelope = await response.json().catch(() => {
            throw new ScpHubError('invalid-response', 'SCP Hub returned a non-JSON body');
        });
        const code = String(envelope.code ?? '');
        const success = envelope.success === true
            || (envelope.success !== false && (code === '0' || code === '10000'));
        if (!success) {
            throw new ScpHubError('hub-rejected', envelope.msg ?? 'SCP Hub returned an error envelope');
        }
        return (envelope.data ?? Object.create(null));
    }
}
