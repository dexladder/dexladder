/** Everything the typed core contributes to the payload's CSS, in cascade order. */
import { tokenCSS } from './tokens';
import { componentCSS } from './components';
import { blogCSS } from './blog';
import { botsCSS } from './bots';

export function stylesheet(): string {
  return tokenCSS() + '\n' + componentCSS() + botsCSS() + blogCSS();
}

/** Static markup the build splices into the payload (so chrome paints complete before any script runs). */
export { navMarkup } from '../nav/ia';
