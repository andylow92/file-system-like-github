import type { PhrasingContent, Root, Text } from 'mdast';
import { SKIP, visit } from 'unist-util-visit';

/**
 * Remark plugin that turns trailing ` ^block-id` anchors in `text` nodes into a
 * small `link` node with a `block-anchor:<id>` URL. The renderer's `a`
 * component picks up the prefix and renders the marker unobtrusively (or
 * lets the host pin/scroll to the block). Code spans / fenced code are not
 * `text` nodes, so anchors inside them are untouched.
 *
 * Only end-of-text anchors (the Obsidian convention) are transformed, so an
 * accidental `^id` in the middle of a sentence does not turn into markup.
 */
const TRAILING_ANCHOR = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;

export function remarkBlockAnchors() {
  return (tree: Root): void => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) {
        return;
      }
      const value = node.value;
      const match = TRAILING_ANCHOR.exec(value);
      if (!match) {
        return;
      }
      const [full, id] = match;
      const head = value.slice(0, match.index);
      const replacement: PhrasingContent[] = [];
      if (head.length > 0) {
        replacement.push({ type: 'text', value: head });
      }
      replacement.push({
        type: 'link',
        url: `block-anchor:${encodeURIComponent(id)}`,
        title: `Block anchor ^${id}`,
        children: [{ type: 'text', value: `^${id}` }],
      });
      // Preserve any trailing whitespace from the matched suffix in case the
      // text is followed by more inline content.
      void full;
      parent.children.splice(index, 1, ...replacement);
      return [SKIP, index + replacement.length];
    });
  };
}

export const BLOCK_ANCHOR_PREFIX = 'block-anchor:';
