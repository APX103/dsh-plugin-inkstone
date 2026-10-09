/** The A2A agents settings section. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { A2aCardFace } from './a2a-card-controller';
/** Framework-derived props for the A2A agents settings section. */
export type A2aCardProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.a2a'> & InjectFace<A2aCardFace>;
/**
 * Render the registry sign-in, the directory, and the delegation roster.
 * @param props - Locale, the section snapshot, and the section actions.
 * @returns The section content.
 */
export declare function A2aCard(props: A2aCardProps): import("react").JSX.Element;
