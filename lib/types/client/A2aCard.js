import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useId, useState } from 'react';
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './A2aCard.module.css';
/** Format one token expiry instant as a short locale string. */
function expiryText(expiresAtMs) {
    return new Date(expiresAtMs).toLocaleTimeString();
}
/**
 * Render the registry sign-in, the directory, and the delegation roster.
 * @param props - Locale, the section snapshot, and the section actions.
 * @returns The section content.
 */
export function A2aCard(props) {
    const { t } = props;
    const state = props.useA2aCard(snapshot => snapshot);
    const headingId = useId();
    const [ak, setAk] = useState('');
    const [sk, setSk] = useState('');
    const [editing, setEditing] = useState(false);
    const busy = state.busy !== null || state.rosterBusy;
    const directoryBusy = busy || state.directoryLoading;
    return (_jsxs("div", { className: css.section, children: [state.error !== null ? _jsxs("p", { className: css.error, role: "alert", children: [t('errorPrefix'), ": ", state.error] }) : null, _jsxs("section", { className: css.card, "aria-labelledby": `${headingId}-sso`, children: [_jsx("h3", { className: css.cardTitle, id: `${headingId}-sso`, children: t('ssoTitle') }), _jsx(SsoFacts, { t: t, state: state }), state.login?.configured === true && !editing
                        ? (_jsxs("div", { className: css.fields, children: [_jsxs("label", { className: css.field, children: [_jsx("span", { children: t('akLabel') }), _jsx(Input, { value: "\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7", readOnly: true, disabled: true })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('skLabel') }), _jsx(Input, { value: "\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7", readOnly: true, disabled: true })] }), _jsxs("div", { className: css.fieldActions, children: [_jsx(Button, { size: "sm", variant: "outline", disabled: busy, onClick: () => { setEditing(true); }, children: t('ssoModify') }), _jsx(Button, { size: "sm", variant: "ghost", disabled: busy, onClick: () => { void props.signOut(); }, children: t('signOut') })] })] }))
                        : state.login?.configured === true && editing
                            ? (_jsxs("form", { className: css.fields, onSubmit: (event) => {
                                    event.preventDefault();
                                    void props.signIn(ak, sk).then((ok) => {
                                        if (!ok)
                                            return;
                                        setAk('');
                                        setSk('');
                                        setEditing(false);
                                    });
                                }, children: [_jsxs("label", { className: css.field, children: [_jsx("span", { children: t('akLabel') }), _jsx(Input, { value: ak, onChange: (event) => { setAk(event.target.value); }, autoComplete: "off" })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('skLabel') }), _jsx(Input, { value: sk, onChange: (event) => { setSk(event.target.value); }, type: "password", autoComplete: "off" })] }), _jsxs("div", { className: css.fieldActions, children: [_jsx(Button, { size: "sm", variant: "primary", type: "submit", disabled: busy || ak === '' || sk === '', children: t('ssoSave') }), _jsx(Button, { size: "sm", variant: "ghost", type: "button", disabled: busy, onClick: () => { setEditing(false); }, children: t('ssoCancel') })] })] }))
                            : (_jsxs("form", { className: css.fields, onSubmit: (event) => {
                                    event.preventDefault();
                                    void props.signIn(ak, sk);
                                }, children: [_jsxs("label", { className: css.field, children: [_jsx("span", { children: t('akLabel') }), _jsx(Input, { value: ak, onChange: (event) => { setAk(event.target.value); }, autoComplete: "off" })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('skLabel') }), _jsx(Input, { value: sk, onChange: (event) => { setSk(event.target.value); }, type: "password", autoComplete: "off" })] }), _jsx("div", { className: css.fieldActions, children: _jsx(Button, { size: "sm", variant: "primary", type: "submit", disabled: busy || ak === '' || sk === '', children: t('signIn') }) })] }))] }), _jsxs("section", { className: css.card, "aria-labelledby": `${headingId}-directory`, children: [_jsxs("div", { className: css.cardHead, children: [_jsx("h3", { className: css.cardTitle, id: `${headingId}-directory`, children: t('directoryTitle') }), _jsx(Button, { size: "sm", variant: "outline", disabled: directoryBusy || state.login?.configured !== true, onClick: () => { void props.loadDirectory(); }, children: t('directoryRefresh') })] }), state.directory.length === 0
                        ? _jsx("p", { className: css.hint, children: state.directoryLoading ? t('loading') : t('directoryEmpty') })
                        : _jsx("ul", { className: css.rows, children: state.directory.map(row => (_jsx(AgentRow, { name: row.name, scheme: row.authScheme, description: row.description, added: state.roster.some(entry => entry.name === row.name), actions: added => added
                                    ? _jsx(Tag, { tone: "neutral", children: t('inRoster') })
                                    : (_jsx(Button, { size: "sm", variant: "outline", disabled: busy || state.rosterStatus !== 'ready', onClick: () => { void props.addToRoster(row); }, children: t('addToRoster') })) }, row.name))) })] }), _jsxs("section", { className: css.card, "aria-labelledby": `${headingId}-roster`, children: [_jsx("h3", { className: css.cardTitle, id: `${headingId}-roster`, children: t('rosterTitle') }), state.rosterStatus !== 'ready'
                        ? _jsx("p", { className: css.hint, children: state.rosterStatus === 'loading' ? t('loading') : t('rosterUnavailable') })
                        : state.roster.length === 0
                            ? _jsx("p", { className: css.hint, children: t('rosterEmpty') })
                            : _jsx("ul", { className: css.rows, children: state.roster.map(row => (_jsx(AgentRow, { name: row.name, scheme: row.authScheme, description: row.description, added: false, actions: () => (_jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", variant: "ghost", disabled: busy, onClick: () => { void props.setRosterEnabled(row.name, !row.enabled); }, children: row.enabled ? t('rosterDisable') : t('rosterEnable') }), _jsx(Button, { size: "sm", variant: "ghost", disabled: busy, onClick: () => { void props.removeFromRoster(row.name); }, children: t('rosterRemove') })] })) }, row.name))) })] })] }));
}
/**
 * One directory or roster agent row: identity, scheme tag, description, and
 * the caller-supplied trailing action.
 * @param props - row identity facts and the trailing action renderer.
 * @returns one list row.
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
