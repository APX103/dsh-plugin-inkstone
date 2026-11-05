import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useId, useState } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './A2aCard.module.css';
/** Labels for the bundled sources. */
function sourceLabel(t, id) {
    switch (id) {
        case 'arxiv': return t('sourceArxiv');
        case 'crossref': return t('sourceCrossref');
        case 'openalex': return t('sourceOpenalex');
        case 'pubmed': return t('sourcePubmed');
        case 'europepmc': return t('sourceEuropepmc');
        default: return t('sourceBiorxiv');
    }
}
/**
 * Render the academic search configuration card.
 * @param props - Locale, state hooks, and actions.
 * @returns The section content.
 */
export function AcadSearchCard(props) {
    const { t } = props;
    const state = props.useAcadSearch(snapshot => snapshot);
    const headingId = useId();
    const [saved, setSaved] = useState(false);
    useEffect(() => {
        if (!saved)
            return;
        const timer = window.setTimeout(() => { setSaved(false); }, 2500);
        return () => { window.clearTimeout(timer); };
    }, [saved]);
    const errorText = state.error === 'rejected'
        ? t('acadRejected')
        : state.error === 'readonly'
            ? t('acadReadonly')
            : state.error;
    return (_jsxs("div", { className: css.section, children: [errorText !== null ? _jsxs("p", { className: css.error, role: "alert", children: [t('errorPrefix'), ": ", errorText] }) : null, _jsxs("section", { className: css.card, "aria-labelledby": headingId, children: [_jsx("h3", { className: css.cardTitle, id: headingId, children: t('acadSources') }), _jsx("p", { className: css.hint, children: t('acadSummary') }), state.status !== 'ready'
                        ? _jsx("p", { children: state.status === 'loading' ? '…' : t('acadUnavailable') })
                        : (_jsxs(_Fragment, { children: [_jsx("div", { className: css.rows, children: state.sources.map(row => (_jsxs("label", { className: css.row, children: [_jsx("input", { type: "checkbox", checked: row.enabled, disabled: state.busy, onChange: event => { void props.toggleSource(row.id, event.target.checked); } }), _jsx("span", { className: css.rowName, children: sourceLabel(t, row.id) })] }, row.id))) }), _jsxs("form", { className: css.fields, onSubmit: event => {
                                        event.preventDefault();
                                        void props.saveAcad().then(ok => { setSaved(ok); });
                                    }, children: [_jsxs("label", { className: css.field, children: [_jsx("span", { children: t('acadMailto') }), _jsx(Input, { value: state.mailto, onChange: (event) => { props.setMailto(event.target.value); }, placeholder: t('acadMailtoHint'), autoComplete: "off", type: "email" })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('acadOpenAlexKey') }), _jsx(Input, { value: state.openalexApiKey, onChange: (event) => { props.setOpenAlexKey(event.target.value); }, placeholder: t('acadOpenAlexKeyHint'), autoComplete: "off", type: "password" })] }), _jsxs("label", { className: css.field, children: [_jsx("span", { children: t('acadNcbiKey') }), _jsx(Input, { value: state.ncbiApiKey, onChange: (event) => { props.setNcbiKey(event.target.value); }, placeholder: t('acadNcbiKeyHint'), autoComplete: "off", type: "password" })] }), _jsxs("div", { className: css.fieldActions, children: [_jsx(Button, { size: "sm", variant: "primary", type: "submit", disabled: state.busy, children: t('acadSave') }), saved ? _jsx("span", { className: css.hint, children: t('acadSaved') }) : null] })] })] }))] })] }));
}
