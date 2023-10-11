import type { MarkdownNode, MarkdownFlatNode, TextWithSource } from "../../types/WebSearch";

// Given a markdown string, parse it into nested markdown tree structure
// For example, `## My Heading 2` would be a child of `# My Heading 1`
export function parseMarkdown(markdownWithSource: TextWithSource) {
	const REGEX_MD_HEADING = /^((#{1,6}) .+)\n+/gm;
	const { text: markdown, source } = markdownWithSource;
	const sections = markdown.split(REGEX_MD_HEADING);
	let nodes: MarkdownNode[] = [];

	for (let i = 1; i < sections.length; i += 3) {
		const heading = sections[i + 0];
		const depth = sections[i + 1].length;
		const content = sections[i + 2];
		const node: MarkdownNode = { heading, depth, content, source, sections: [] };
		nodes = addToTree(nodes, node);
	}

	return nodes;
}

// Helper function to `parseMarkdown`
function addToTree(nodes: MarkdownNode[], node: MarkdownNode): MarkdownNode[] {
	if (nodes.length === 0 || nodes[nodes.length - 1].depth >= node.depth) {
		nodes.push(node);
	} else {
		const sections = nodes[nodes.length - 1].sections || [];
		nodes[nodes.length - 1].sections = addToTree(sections, node);
	}
	return nodes;
}

export function flattenNodes(nodes: MarkdownNode[]): MarkdownFlatNode[] {
	const flatNodes: MarkdownFlatNode[] = [];
	for (const node of nodes) {
		flattenNode(node, [], flatNodes);
	}
	return flatNodes;
}

// Helper function to `flattenNodes`
function flattenNode(node: MarkdownNode, suffix: string[], flatNodes: MarkdownFlatNode[]) {
	const newSuffix = [...suffix, node.heading];
	const { content, source } = node;
	const flatNode: MarkdownFlatNode = { heading: newSuffix.join("\n\n"), content, source };
	flatNodes.push(flatNode);
	for (const section of node.sections) {
		flattenNode(section, newSuffix, flatNodes);
	}
}

export function chunkSlidingWindow(
	flatNodes: MarkdownFlatNode[],
	opts: { windowWidth: number; paddingWidth: number }
) {
	const { windowWidth, paddingWidth } = opts;
	const results: TextWithSource[] = [];
	for (const node of flatNodes) {
		let i = 0;
		const { content, source } = node;
		let { heading } = node;
		heading = heading + "\n\n";
		const width = windowWidth - 2 * paddingWidth - heading.length;
		while (i <= content.length) {
			const startIdx = Math.max(0, i - paddingWidth);
			const endIdx = i + width + paddingWidth;
			const slice = content.slice(startIdx, endIdx);
			const textWithSource = { text: heading + slice, source } as TextWithSource;
			results.push(textWithSource);
			i = i + width;
		}
	}
	return results;
}
