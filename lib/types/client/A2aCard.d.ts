/** The A2A agents settings section. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { A2aCardFace } from './a2a-card-controller';
import type { ScpHubPanelFace } from './scp-hub-panel-controller';
/** The merged inject face: registry panel plus SCP Hub panel. */
export interface InkstoneFace extends Omit<A2aCardFace, 'hooks'>, Omit<ScpHubPanelFace, 'hooks'> {
    hooks: A2aCardFace['hooks'] & ScpHubPanelFace['hooks'];
}
/** Framework-derived props for the A2A agents settings section. */
export type A2aCardProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.a2a'> & InjectFace<InkstoneFace>;
/**
 * Render the registry sign-in, then the three panels: agent registry, SCP
 * services, and skills.
 * @param props - Locale, both panel snapshots, and both action sets.
 * @returns The section content.
 */
export declare function A2aCard(props: A2aCardProps): import("react").JSX.Element;
