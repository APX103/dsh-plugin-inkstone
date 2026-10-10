import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useId, useState } from 'react';
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './A2aCard.module.css';
/** Format one token expiry instant as a short locale string. */
function expiryText(expiresAtMs) {
    return new Date(expiresAtMs).toLocaleTimeString();
}
/**
 * Render the registry sign-in, then the three panels: agent registry, SCP
 * services, and skills.
 * @param props - Locale, both panel snapshots, and both action sets.
 * @returns The section content.
 */
export function A2aCard(props) {
    const { t } = props;
    const state = props.useA2aCard(snapshot => snapshot);
    const panel = props.useScpHubPanel(snapshot => snapshot);
    const headingId = useId();
    const [ak, setAk] = useState('');
    const [sk, setSk] = useState('');
    const [editing, setEditing] = useState(false);
    const [active, setActive] = useState('agents');
    const busy = state.busy !== null || state.rosterBusy;
    const panelBusy = panel.mutating !== null || panel.searching !== null;
    return (_jsxs("div", { className: css.section, children: [state.error !== null ? _jsxs("p", { className: css.error, role: "alert", children: [t('errorPrefix'), ": ", state.error] }) : null, panel.error !== null ? _jsxs("p", { className: css.error, role: "alert", children: [t('errorPrefix'), ": ", panel.error] }) : null, _jsxs("section", { className: css.card, "aria-labelledby": `${headingId}-sso`, children: [_jsx("h3", { className: css.cardTitle, id: `${headingId}-sso`, children: t('ssoTitle') }), _jsx(SsoFacts, { t: t, state: state }), state.login?.configured === true && !editing
                        ? (_jsxs("div", { className: css.fields, children: [_jsxs("label", { className: css.field, children: [_jsx("span", { children: t('akLabel') }), _jsx(Input, { value: "\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7", readOnly: true, disabled: true })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('skLabel') }), _jsx(Input, { value: "\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7", readOnly: true, disabled: true })] }), _jsxs("div", { className: css.fieldActions, children: [_jsx(Button, { size: "sm", variant: "outline", disabled: busy, onClick: () => { setEditing(true); }, children: t('ssoModify') }), _jsx(Button, { size: "sm", variant: "ghost", disabled: busy, onClick: () => { void props.signOut(); }, children: t('signOut') })] })] }))
                        : state.login?.configured === true && editing
                            ? (_jsxs("form", { className: css.fields, onSubmit: event => {
                                    event.preventDefault();
                                    void props.signIn(ak, sk).then(ok => {
                                        if (!ok)
                                            return;
                                        setAk('');
                                        setSk('');
                                        setEditing(false);
                                    });
                                }, children: [_jsxs("label", { className: css.field, children: [_jsx("span", { children: t('akLabel') }), _jsx(Input, { value: ak, onChange: (event) => { setAk(event.target.value); }, autoComplete: "off" })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('skLabel') }), _jsx(Input, { value: sk, onChange: (event) => { setSk(event.target.value); }, type: "password", autoComplete: "off" })] }), _jsxs("div", { className: css.fieldActions, children: [_jsx(Button, { size: "sm", variant: "primary", type: "submit", disabled: busy || ak === '' || sk === '', children: t('ssoSave') }), _jsx(Button, { size: "sm", variant: "ghost", type: "button", disabled: busy, onClick: () => { setEditing(false); }, children: t('ssoCancel') })] })] }))
                            : (_jsxs("form", { className: css.fields, onSubmit: event => {
                                    event.preventDefault();
                                    void props.signIn(ak, sk);
                                }, children: [_jsxs("label", { className: css.field, children: [_jsx("span", { children: t('akLabel') }), _jsx(Input, { value: ak, onChange: (event) => { setAk(event.target.value); }, autoComplete: "off" })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('skLabel') }), _jsx(Input, { value: sk, onChange: (event) => { setSk(event.target.value); }, type: "password", autoComplete: "off" })] }), _jsx("div", { className: css.fieldActions, children: _jsx(Button, { size: "sm", variant: "primary", type: "submit", disabled: busy || ak === '' || sk === '', children: t('signIn') }) })] }))] }), _jsx("div", { className: css.tabs, role: "tablist", "aria-label": t('title'), children: ['agents', 'scps', 'skills', 'builtin'].map(id => (_jsx("button", { type: "button", role: "tab", className: css.tab, "aria-selected": active === id, onClick: () => { setActive(id); if (id === 'builtin') {
                        void props.loadBuiltinSkills();
                    } }, children: id === 'agents' ? t('tabAgents') : id === 'scps' ? t('tabScps') : id === 'skills' ? t('tabSkills') : t('tabBuiltin') }, id))) }), active === 'agents'
                ? _jsx(AgentsPanel, { t: t, face: props, state: state, busy: busy, headingId: headingId })
                : active === 'scps'
                    ? _jsx(ScpsPanel, { t: t, headingId: headingId, panel: panel, face: props, busy: panelBusy })
                    : active === 'skills'
                        ? _jsx(SkillsPanel, { t: t, headingId: headingId, panel: panel, face: props, busy: panelBusy })
                        : _jsx(BuiltinPanel, { t: t, panel: panel, face: props, busy: panelBusy, headingId: headingId })] }));
}
/**
 * The agent registry panel: the directory plus the delegation roster.
 */
function AgentsPanel({ t, face, state, busy, headingId }) {
    const directoryBusy = busy || state.directoryLoading;
    return (_jsxs(_Fragment, { children: [_jsxs("section", { className: css.card, "aria-labelledby": `${headingId}-directory`, children: [_jsxs("div", { className: css.cardHead, children: [_jsx("h3", { className: css.cardTitle, id: `${headingId}-directory`, children: t('directoryTitle') }), _jsx(Button, { size: "sm", variant: "outline", disabled: directoryBusy || state.login?.configured !== true, onClick: () => { void face.loadDirectory(); }, children: t('directoryRefresh') })] }), state.directory.length === 0
                        ? _jsx("p", { className: css.hint, children: state.directoryLoading ? t('loading') : t('directoryEmpty') })
                        : _jsx("ul", { className: css.rows, children: state.directory.map(row => (_jsx(AgentRow, { name: row.name, scheme: row.authScheme, description: row.description, added: state.roster.some(entry => entry.name === row.name), actions: added => added
                                    ? _jsx(Tag, { tone: "neutral", children: t('inRoster') })
                                    : (_jsx(Button, { size: "sm", variant: "outline", disabled: busy || state.rosterStatus !== 'ready', onClick: () => { void face.addToRoster(row); }, children: t('addToRoster') })) }, row.name))) })] }), _jsxs("section", { className: css.card, "aria-labelledby": `${headingId}-roster`, children: [_jsx("h3", { className: css.cardTitle, id: `${headingId}-roster`, children: t('rosterTitle') }), state.rosterStatus !== 'ready'
                        ? _jsx("p", { className: css.hint, children: state.rosterStatus === 'loading' ? t('loading') : t('rosterUnavailable') })
                        : state.roster.length === 0
                            ? _jsx("p", { className: css.hint, children: t('rosterEmpty') })
                            : _jsx("ul", { className: css.rows, children: state.roster.map(row => (_jsx(AgentRow, { name: row.name, scheme: row.authScheme, description: row.description, added: false, actions: () => (_jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", variant: "ghost", disabled: busy, onClick: () => { void face.setRosterEnabled(row.name, !row.enabled); }, children: row.enabled ? t('rosterDisable') : t('rosterEnable') }), _jsx(Button, { size: "sm", variant: "ghost", disabled: busy, onClick: () => { void face.removeFromRoster(row.name); }, children: t('rosterRemove') })] })) }, row.name))) })] })] }));
}
/**
 * The SCP services panel: catalog search plus the local add/remove list.
 */
function ScpsPanel({ t, headingId, panel, face, busy }) {
    return (_jsxs("section", { className: css.card, "aria-labelledby": `${headingId}-scps`, children: [_jsx("h3", { className: css.cardTitle, id: `${headingId}-scps`, children: t('scpTitle') }), _jsx(CatalogSearch, { t: t, searching: panel.searching === 'scp', keyword: panel.keyword, onSearch: keyword => { void face.searchCatalog('scp', keyword); } }), panel.pages.scp === undefined
                ? _jsx("p", { className: css.hint, children: panel.searching === 'scp' ? t('loading') : t('catalogHint') })
                : panel.pages.scp.items.length === 0
                    ? _jsx("p", { className: css.hint, children: t('catalogEmpty') })
                    : _jsx("ul", { className: css.rows, children: panel.pages.scp.items.map(row => (_jsxs("li", { className: css.row, children: [_jsxs("div", { className: css.rowIdentity, children: [_jsx("span", { className: css.rowName, children: row.name }), row.official ? _jsx(Tag, { tone: "solid", children: t('officialTag') }) : null] }), _jsx("p", { className: css.rowDescription, title: row.description, children: row.description }), _jsx("div", { className: css.rowActions, children: _jsx(Button, { size: "sm", variant: "outline", disabled: busy || panel.mutating !== null, onClick: () => { void face.addScp(row.id); }, children: t('catalogAdd') }) })] }, row.id))) }), _jsx("h4", { className: css.subTitle, children: t('localScpsTitle') }), panel.scps.length === 0
                ? _jsx("p", { className: css.hint, children: t('localScpsEmpty') })
                : _jsx("ul", { className: css.rows, children: panel.scps.map(row => (_jsxs("li", { className: css.row, children: [_jsxs("div", { className: css.rowIdentity, children: [_jsx("span", { className: css.rowName, children: row.name }), _jsx(Tag, { tone: "neutral", children: row.selectedTools.length > 0 ? `${row.selectedTools.length} ${t('toolsSelectedTag')}` : t('noToolsSelectedTag') })] }), _jsx("p", { className: css.rowDescription, title: row.description, children: row.description }), _jsxs("div", { className: css.rowActions, children: [_jsx(Button, { size: "sm", variant: "outline", disabled: panel.mutating !== null, onClick: () => { void face.openToolPicker(row.id); }, children: panel.picker?.scpId === row.id ? t('toolPickerClose') : t('toolPickerOpen') }), _jsx(Button, { size: "sm", variant: "ghost", disabled: panel.mutating !== null, onClick: () => { void face.setScpEnabled(row.id, !row.enabled); }, children: row.enabled ? t('localDisable') : t('localEnable') }), _jsx(Button, { size: "sm", variant: "ghost", disabled: panel.mutating !== null, onClick: () => { void face.removeScp(row.id); }, children: t('localRemove') })] }), row.selectedTools.length === 0
                                ? _jsx("p", { className: css.hint, children: t('scpParkedHint') })
                                : null, panel.picker?.scpId === row.id
                                ? _jsx(ToolPicker, { t: t, panel: panel, row: row, face: face })
                                : null] }, row.id))) })] }));
}
/** Tools per picker page. */
const PICKER_PAGE_SIZE = 50;
/**
 * The per-server tool picker: a paged, tickable inventory; only ticked tools
 * mount. No search — a plain paged list keeps selection deliberate.
 */
function ToolPicker({ t, panel, row, face }) {
    const picker = panel.picker;
    if (picker === null || picker.scpId !== row.id)
        return null;
    if (picker.loading) {
        return _jsx("p", { className: css.hint, children: t('loading') });
    }
    const last = Math.max(0, Math.ceil(picker.tools.length / PICKER_PAGE_SIZE) - 1);
    const page = picker.tools.slice(picker.page * PICKER_PAGE_SIZE, (picker.page + 1) * PICKER_PAGE_SIZE);
    const selected = new Set(row.selectedTools);
    return (_jsxs("div", { className: css.picker, children: [_jsx("p", { className: css.hint, children: t('toolPickerCount', { selected: String(row.selectedTools.length), total: String(picker.tools.length) }) }), _jsx("ul", { className: css.rows, children: page.map(tool => (_jsxs("li", { className: css.row, children: [_jsxs("label", { className: css.pick, children: [_jsx("input", { type: "checkbox", checked: selected.has(tool.name), disabled: panel.mutating !== null, onChange: event => { void face.toggleTool(row.id, tool.name, event.target.checked); } }), _jsx("span", { className: css.rowName, children: tool.name })] }), _jsx("p", { className: css.rowDescription, title: tool.description, children: tool.description })] }, tool.name))) }), _jsxs("div", { className: css.rowActions, children: [_jsx(Button, { size: "sm", variant: "ghost", disabled: picker.page === 0, onClick: () => { face.setToolPickerPage(picker.page - 1); }, children: t('toolPickerPrev') }), _jsx("span", { className: css.hint, children: t('toolPickerPage', { page: String(picker.page + 1), pages: String(last + 1) }) }), _jsx(Button, { size: "sm", variant: "ghost", disabled: picker.page >= last, onClick: () => { face.setToolPickerPage(picker.page + 1); }, children: t('toolPickerNext') })] })] }));
}
/**
 * The bundled scientific skills panel: the shipped catalog with per-skill
 * enable switches; everything is on by default.
 */
function BuiltinPanel({ t, headingId, panel, face, busy }) {
    const disabled = new Set(panel.builtinDisabled);
    return (_jsxs("section", { className: css.card, "aria-labelledby": `${headingId}-builtin`, children: [_jsx("h3", { className: css.cardTitle, id: `${headingId}-builtin`, children: t('builtinTitle') }), _jsx("p", { className: css.hint, children: t('builtinHint') }), panel.builtinLoading && panel.builtin.length === 0
                ? _jsx("p", { className: css.hint, children: t('loading') })
                : panel.builtin.length === 0
                    ? _jsx("p", { className: css.hint, children: t('builtinEmpty') })
                    : _jsx("ul", { className: css.rows, children: panel.builtin.map(row => (_jsxs("li", { className: css.row, children: [_jsxs("div", { className: css.rowIdentity, children: [_jsx("span", { className: css.rowName, children: row.name }), _jsx(Tag, { tone: disabled.has(row.name) ? 'neutral' : 'solid', children: disabled.has(row.name) ? t('builtinOff') : t('builtinOn') })] }), _jsx("p", { className: css.rowDescription, title: row.description, children: row.description }), _jsx("div", { className: css.rowActions, children: _jsx(Button, { size: "sm", variant: "ghost", disabled: busy || panel.mutating !== null, onClick: () => { void face.setBuiltinEnabled(row.name, disabled.has(row.name)); }, children: disabled.has(row.name) ? t('localEnable') : t('localDisable') }) })] }, row.name))) })] }));
}
/**
 * The skills panel: catalog search plus the installed list.
 */
function SkillsPanel({ t, headingId, panel, face, busy }) {
    return (_jsxs("section", { className: css.card, "aria-labelledby": `${headingId}-skills`, children: [_jsx("h3", { className: css.cardTitle, id: `${headingId}-skills`, children: t('skillsTitle') }), _jsx(CatalogSearch, { t: t, searching: panel.searching === 'skill', keyword: panel.keyword, onSearch: keyword => { void face.searchCatalog('skill', keyword); } }), panel.pages.skill === undefined
                ? _jsx("p", { className: css.hint, children: panel.searching === 'skill' ? t('loading') : t('catalogHint') })
                : panel.pages.skill.items.length === 0
                    ? _jsx("p", { className: css.hint, children: t('catalogEmpty') })
                    : _jsx("ul", { className: css.rows, children: panel.pages.skill.items.map(row => (_jsxs("li", { className: css.row, children: [_jsxs("div", { className: css.rowIdentity, children: [_jsx("span", { className: css.rowName, children: row.name }), row.official ? _jsx(Tag, { tone: "solid", children: t('officialTag') }) : null] }), _jsx("p", { className: css.rowDescription, title: row.description, children: row.description }), _jsx("div", { className: css.rowActions, children: _jsx(Button, { size: "sm", variant: "outline", disabled: busy || panel.mutating !== null, onClick: () => { void face.installSkill(row.id); }, children: t('catalogInstall') }) })] }, row.id))) }), _jsx("h4", { className: css.subTitle, children: t('localSkillsTitle') }), panel.skills.length === 0
                ? _jsx("p", { className: css.hint, children: t('localSkillsEmpty') })
                : _jsx("ul", { className: css.rows, children: panel.skills.map(row => (_jsxs("li", { className: css.row, children: [_jsxs("div", { className: css.rowIdentity, children: [_jsx("span", { className: css.rowName, children: row.name }), _jsx(Tag, { tone: "neutral", children: row.skillName })] }), _jsx("p", { className: css.rowDescription, title: row.description, children: row.description }), _jsxs("div", { className: css.rowActions, children: [_jsx(Button, { size: "sm", variant: "ghost", disabled: panel.mutating !== null, onClick: () => { void face.setSkillEnabled(row.id, !row.enabled); }, children: row.enabled ? t('localDisable') : t('localEnable') }), _jsx(Button, { size: "sm", variant: "ghost", disabled: panel.mutating !== null, onClick: () => { void face.removeSkill(row.id); }, children: t('localRemove') })] })] }, row.id))) })] }));
}
/**
 * One catalog search bar: keyword input plus the search button.
 */
function CatalogSearch({ t, searching, keyword, onSearch }) {
    const [text, setText] = useState(keyword);
    return (_jsxs("form", { className: css.search, onSubmit: event => {
            event.preventDefault();
            onSearch(text);
        }, children: [_jsx(Input, { value: text, onChange: (event) => { setText(event.target.value); }, placeholder: t('catalogSearchPlaceholder'), autoComplete: "off" }), _jsx(Button, { size: "sm", variant: "outline", type: "submit", disabled: searching, children: searching ? t('loading') : t('catalogSearch') })] }));
}
/**
 * One agent registry row: identity, scheme tag, description, and the trailing
 * action.
 */
function AgentRow({ name, scheme, description, added, actions }) {
    return (_jsxs("li", { className: css.row, children: [_jsxs("div", { className: css.rowIdentity, children: [_jsx("span", { className: css.rowName, children: name }), _jsx(Tag, { tone: "neutral", children: scheme })] }), _jsx("p", { className: css.rowDescription, title: description, children: description }), _jsx("div", { className: css.rowActions, children: actions(added) })] }));
}
/** One line of login facts. */
function SsoFacts({ t, state }) {
    if (state.login === undefined) {
        return _jsx("p", { className: css.hint, children: t('loading') });
    }
    const facts = [
        state.login.configured ? t('ssoConfigured') : t('ssoNotConfigured'),
        state.login.configured && state.login.authenticated ? t('ssoAuthenticated') : null,
        state.login.userId !== null ? `${t('ssoUserId')}: ${state.login.userId}` : null,
        state.login.expiresAtMs !== null ? `${t('ssoExpiresIn')}: ${expiryText(state.login.expiresAtMs)}` : null,
    ].filter((entry) => entry !== null);
    return _jsx("p", { className: css.facts, children: facts.join(' · ') });
}
