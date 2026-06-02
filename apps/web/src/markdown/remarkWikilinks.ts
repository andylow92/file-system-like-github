import type { Link, PhrasingContent, Root, Text } from 'mdast';
import { SKIP, visit } from 'unist-util-visit';
import { parseWikilinkToken } from '@repo/shared';

const WIKILINK_PATTERN = /\[\[([^\]\n]+)\]\]/g;

/**
 * Remark plugin that turns `[[wikilinks]]` in plain text into mdast `link`
 * nodes with a `wikilink:<target>` URL. The renderer's `a` component resolves
 * that URL against the vault and wires up in-app navigation. Code spans and
 * code blocks are untouched because they are not `text` nodes.
 */
export function remarkWikilinks() {
  return (tree: Root): void => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined || parent.type === 'link') {
        return;
      }

      const value = node.value;
      if (!value.includes('[[')) {
        return;
      }

      const replacement: PhrasingContent[] = [];
      let lastIndex = 0;
      WIKILINK_PATTERN.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = WIKILINK_PATTERN.exec(value)) !== null) {
        const [full, inner] = match;
        if (match.index > lastIndex) {
          replacement.push({ type: 'text', value: value.slice(lastIndex, match.index) });
        }

        const { target, alias, heading } = parseWikilinkToken(inner);
        const display = alias || (heading ? `${target}#${heading}` : target);
        const link: Link = {
          type: 'link',
          url: `wikilink:${encodeURIComponent(target)}`,
          children: [{ type: 'text', value: display }],
        };
        replacement.push(link);
        lastIndex = match.index + full.length;
      }

      if (replacement.length === 0) {
        return;
      }

      if (lastIndex < value.length) {
        replacement.push({ type: 'text', value: value.slice(lastIndex) });
      }

      parent.children.splice(index, 1, ...replacement);
      return [SKIP, index + replacement.length];
    });
  };
}
