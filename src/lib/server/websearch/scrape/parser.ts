import type { SerializedHTMLElement } from "./types";

export function spatialParser() {
	/**
	 * Implementation for dbscan, inlined and migrated to typescript from https://github.com/cdxOo/dbscan (MIT License)
	 */
	const DBSCAN = <T>({
		dataset,
		epsilon,
		epsilonCompare,
		minimumPoints,
		distanceFunction,
	}: {
		dataset: T[];
		epsilon?: number;
		epsilonCompare?: (distance: number, epsilon: number) => boolean;
		minimumPoints?: number;
		distanceFunction: (a: T, b: T) => number;
	}) => {
		epsilon = epsilon || 1; // aka maxDistance
		epsilonCompare = epsilonCompare || ((dist, e) => dist < e);
		minimumPoints = minimumPoints || 2;

		const visitedIndices: Record<number, boolean> = {};
		const isVisited = (i: number) => visitedIndices[i];
		const markVisited = (i: number) => {
			visitedIndices[i] = true;
		};

		const clusteredIndices: Record<number, boolean> = {};
		const isClustered = (i: number) => clusteredIndices[i];
		const markClustered = (i: number) => {
			clusteredIndices[i] = true;
		};

		const uniqueMerge = <T>(targetArray: T[], sourceArray: T[]) => {
			for (let i = 0; i < sourceArray.length; i += 1) {
				const item = sourceArray[i];
				if (targetArray.indexOf(item) < 0) {
					targetArray.push(item);
				}
			}
		};

		const findNeighbors = (index: number) => {
			const neighbors = [];
			for (let other = 0; other < dataset.length; other += 1) {
				const distance = distanceFunction(dataset[index], dataset[other]);
				if (epsilonCompare(distance, epsilon)) {
					neighbors.push(other);
				}
			}
			return neighbors;
		};

		const noise: number[] = [];
		const addNoise = (i: number) => noise.push(i);

		const clusters: number[][] = [];
		const createCluster = () => clusters.push([]) - 1;
		const addIndexToCluster = (c: number, i: number) => {
			clusters[c].push(i);
			markClustered(i);
		};

		const expandCluster = (c: number, neighbors: number[]) => {
			for (let i = 0; i < neighbors.length; i += 1) {
				const neighborIndex = neighbors[i];
				if (!isVisited(neighborIndex)) {
					markVisited(neighborIndex);

					const secondaryNeighbors = findNeighbors(neighborIndex);
					if (secondaryNeighbors.length >= minimumPoints) {
						uniqueMerge(neighbors, secondaryNeighbors);
					}
				}

				if (!isClustered(neighborIndex)) {
					addIndexToCluster(c, neighborIndex);
				}
			}
		};

		dataset.forEach((unused, index) => {
			if (!isVisited(index)) {
				markVisited(index);

				const neighbors = findNeighbors(index);
				if (neighbors.length < minimumPoints) {
					addNoise(index);
				} else {
					const clusterIndex = createCluster();
					addIndexToCluster(clusterIndex, index);
					expandCluster(clusterIndex, neighbors);
				}
			}
		});

		return { clusters, noise };
	};

	// -----------
	// Scraping implementation

	const IgnoredTagsList = [
		"footer",
		"nav",
		"aside",
		"script",
		"style",
		"noscript",
		"form",
		"button",
	];
	const InlineTags = [
		"a",
		"abbrv",
		"span",
		"address",
		"time",
		"acronym",
		"strong",
		"b",
		"br",
		"sub",
		"sup",
		"tt",
		"var",
		"em",
		"i",
	];

	type ReadableNode = HTMLElement;
	type NodeWithRect = {
		node: ReadableNode;
		rect: DOMRect;
	};

	const isOnlyChild = (node: Node) => {
		if (!node.parentElement) return true;
		if (node.parentElement.nodeName === "body") return false;
		if (node.parentElement.childNodes.length === 1) return true;
		return false;
	};

	const hasValidInlineParent = (node: Node) => {
		return node.parentElement && !node.parentElement.matches("div, section, article, main, body ");
	};

	const hasValidParent = (node: Node) => {
		return node.parentElement && !node.parentElement.isSameNode(document.body);
	};

	/**
	 * We want to find the highest parent of text node in the cluster.
	 * For example in this case: <p><span>Text here</span></p>
	 * the P tag is highest parent.
	 */
	const findHighestDirectParentOfReadableNode = (node: Node): HTMLElement => {
		// go up the tree until the parent is no longer an only child
		let parent = node.parentElement;
		// if the parent is an inline tag, then go up one more level
		while (
			parent &&
			hasValidInlineParent(parent) &&
			InlineTags.includes(parent?.tagName.toLowerCase())
		) {
			parent = parent.parentElement;
		}

		while (parent && isOnlyChild(parent)) {
			if (!hasValidParent(parent)) break;
			parent = parent.parentElement;
		}

		if (!parent) {
			throw new Error(
				"disconnected node found, this should not really be possible when traversing through the dom"
			);
		}

		const possibleCodeParents = Array.from(document.querySelectorAll("pre, p"));
		const possibleTableParents = Array.from(document.querySelectorAll("table"));
		const possibleListParents = Array.from(document.querySelectorAll("ul, ol"));

		// if the parent is a span, code or div tag check if there is a pre tag or p tag above it
		if (["span", "code", "div"].includes(parent.nodeName.toLowerCase())) {
			const hasParent = possibleCodeParents.find((tag) => tag.contains(parent)) as HTMLElement;
			if (hasParent) {
				parent = hasParent;
			}
		}

		// if the parent is a li tag check if there is a ul or ol tag above it
		if (parent.nodeName.toLowerCase() === "li") {
			const hasParent = possibleListParents.find((tag) => tag.contains(parent)) as HTMLElement;
			if (hasParent) {
				parent = hasParent;
			}
		}

		// if the parent is a td, th, tr tag check if there is a table tag above it
		if (["td", "th", "tr"].includes(parent.nodeName.toLowerCase())) {
			const hasParent = possibleTableParents.find((tag) => tag.contains(parent)) as HTMLElement;
			if (hasParent) {
				parent = hasParent;
			}
		}

		return parent;
	};
	const barredNodes = Array.from(document.querySelectorAll(IgnoredTagsList.join(",")));

	const doesNodePassHeuristics = (node: Node) => {
		if ((node.textContent ?? "").trim().length < 10) {
			return false;
		}

		const parentNode = findHighestDirectParentOfReadableNode(node);

		if (parentNode && parentNode instanceof Element) {
			if (
				!parentNode.checkVisibility({
					checkOpacity: true,
					checkVisibilityCSS: true,
				})
			)
				return false;

			const rect = parentNode.getBoundingClientRect();
			// elements that are readable usually don't have really small height or width
			if (rect.width < 4 || rect.height < 4) {
				return false;
			}
		}

		if (parentNode && parentNode instanceof Element) {
			if (barredNodes.some((node) => node.contains(parentNode))) {
				return false;
			}
		}

		return true;
	};

	const getAllReadableNodes = (): NodeWithRect[] => {
		if (!document.body) throw new Error("Page failed to load");
		const treeWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				if (doesNodePassHeuristics(node)) {
					return NodeFilter.FILTER_ACCEPT;
				} else {
					return NodeFilter.FILTER_SKIP;
				}
			},
		});

		const readableNodes = [];

		while (treeWalker.nextNode()) {
			readableNodes.push(treeWalker.currentNode as ReadableNode);
		}

		/*
		 * <table><p>hello</p><p>world</p></table>
		 * table is already included in the parent of the first p tag
		 */

		const parentsForReadableNodes = readableNodes.map(findHighestDirectParentOfReadableNode);
		const listWithOnlyParents: HTMLElement[] = [];
		// find unique nodes in the parent list, a unique node is a node that is not a child of any other node in the list
		for (let i = 0; i < parentsForReadableNodes.length; i++) {
			const node = parentsForReadableNodes[i];
			const hasParentInList = parentsForReadableNodes.find((otherNode, idx) => {
				if (i === idx) return false;
				return otherNode.contains(node);
			});
			listWithOnlyParents.push(hasParentInList ? hasParentInList : node);
		}

		const uniqueParents = Array.from(new Set(listWithOnlyParents));

		return uniqueParents.map((node) => {
			return {
				node,
				rect: node.getBoundingClientRect(),
			};
		});
	};

	const distanceFunction = (a: NodeWithRect, b: NodeWithRect) => {
		// we make two assumptions here which are fine to make for rects returned from getBoundingClientRect
		// 1. rects are upright and not rotated
		// 2. If two rects intersect, we assume distance to be 0
		let dx = 0;
		let dy = 0;
		const rect1 = a.rect;
		const rect2 = b.rect;
		// Calculate the horizontal distance
		if (rect1.x + rect1.width < rect2.x) {
			dx = rect2.x - (rect1.x + rect1.width);
		} else if (rect2.x + rect2.width < rect1.x) {
			dx = rect1.x - (rect2.x + rect2.width);
		}

		// Calculate the vertical distance
		if (rect1.y + rect1.height < rect2.y) {
			dy = rect2.y - (rect1.y + rect1.height);
		} else if (rect2.y + rect2.height < rect1.y) {
			dy = rect1.y - (rect2.y + rect2.height);
		}

		const distance = Math.sqrt(dx * dx + dy * dy);
		// Return the Euclidean distance
		return distance;
	};
	/**
	 * Clusters nodes using dbscan
	 */
	const clusterReadableNodes = (nodes: NodeWithRect[]) => {
		const { clusters } = DBSCAN({
			dataset: nodes,
			epsilon: 28,
			minimumPoints: 1,
			distanceFunction,
		});

		return clusters;
	};

	const totalTextLength = (cluster: number[]) => {
		return cluster
			.map((t) => readableNodes[t].node.innerText?.replaceAll(/ {2}|\r\n|\n|\r/gm, ""))
			.join("").length;
	};

	const approximatelyEqual = (a: number, b: number, epsilon = 1) => {
		return Math.abs(a - b) < epsilon;
	};

	const getClusterBounds = (cluster: number[]) => {
		const leftMostPoint = Math.min(...cluster.map((c) => readableNodes[c].rect.x));
		const topMostPoint = Math.min(...cluster.map((c) => readableNodes[c].rect.y));
		const rightMostPoint = Math.max(
			...cluster.map((c) => readableNodes[c].rect.x + readableNodes[c].rect.width)
		);
		const bottomMostPoint = Math.max(
			...cluster.map((c) => readableNodes[c].rect.y + readableNodes[c].rect.height)
		);
		return {
			// left most element
			x: leftMostPoint,
			y: topMostPoint,
			width: rightMostPoint - leftMostPoint,
			height: bottomMostPoint - topMostPoint,
		};
	};

	const round = (num: number, decimalPlaces = 2) => {
		const factor = Math.pow(10, decimalPlaces);
		return Math.round(num * factor) / factor;
	};

	/** minimum distance to center of the screen */
	const clusterCentrality = (cluster: number[]) => {
		const bounds = getClusterBounds(cluster);
		const centerOfScreen = window.innerWidth / 2;
		// the cluster contains the center of the screen
		if (bounds.x < centerOfScreen && bounds.x + bounds.width > centerOfScreen) {
			return 0;
		}

		// the cluster is to the left of the screen
		if (bounds.x + bounds.width < centerOfScreen) {
			return centerOfScreen - (bounds.x + bounds.width);
		}

		// the cluster is to the right of the screen
		return bounds.x - centerOfScreen;
	};
	/** measure of text share that belong to the cluster */
	const percentageTextShare = (cluster: number[], totalLength: number) => {
		// apply an exponentially increasing penalty for centrality per 100 pixels distance from center

		return round((totalTextLength(cluster) / totalLength) * 100);
	};

	const shouldMergeClusters = (clusterA: number[], clusterB: number[]) => {
		const clusterABounds = getClusterBounds(clusterA);
		const clusterBBounds = getClusterBounds(clusterB);

		// A cluster is horizontally aligned if the x and width are roughly equal
		const isHorizontallyAligned =
			approximatelyEqual(clusterABounds.x, clusterBBounds.x, 40) &&
			approximatelyEqual(clusterABounds.width, clusterBBounds.width, 40);

		if (!isHorizontallyAligned) return false;

		// check the y gap between the clusters
		const higherCluster = clusterABounds.y < clusterBBounds.y ? clusterABounds : clusterBBounds;
		const lowerCluster = clusterABounds.y < clusterBBounds.y ? clusterBBounds : clusterABounds;
		const yGap = lowerCluster.y - (higherCluster.y + higherCluster.height);

		if (approximatelyEqual(yGap, 0, 100)) return true;
	};

	const findCriticalClusters = (clusters: number[][]) => {
		// merge the clusters that have similar widths and x position

		let i = 0;
		while (i < clusters.length) {
			const cluster = clusters[i];
			for (let j = i + 1; j < clusters.length; j++) {
				const otherCluster = clusters[j];
				if (shouldMergeClusters(cluster, otherCluster)) {
					cluster.push(...otherCluster);
					clusters.splice(j, 1);
					j -= 1;
				}
			}

			i++;
		}

		const totalText = totalTextLength(clusters.flat());

		// sort in descending order of text share
		const clusterWithMetrics = clusters.map((cluster) => {
			const centrality = clusterCentrality(cluster);
			return {
				cluster,
				centrality,
				percentageTextShare: percentageTextShare(cluster, totalText),
			};
		});

		// if there is a dominant cluster with more than 60% text share, return that
		const dominantCluster = clusterWithMetrics[0].percentageTextShare > 60;
		if (dominantCluster) return [clusterWithMetrics[0].cluster];

		// clusters are sorted by text share after applying a penalty for centrality
		const sortedClusters = clusterWithMetrics.sort((a, b) => {
			const penaltyForA = Math.pow(0.9, a.centrality / 100);
			const penaltyForB = Math.pow(0.9, b.centrality / 100);
			const adjustedTextShareA = a.percentageTextShare * penaltyForA;
			const adjustedTextShareB = b.percentageTextShare * penaltyForB;

			return adjustedTextShareB - adjustedTextShareA;
		});

		// find all clusters that are similar to the largest cluster in terms of text share
		// and see if they are enough to cover at least 60% of the text share
		const largeTextShareClusters = sortedClusters.filter((c) =>
			approximatelyEqual(c.percentageTextShare, sortedClusters[0].percentageTextShare, 10)
		);

		const totalTextShareOfLargeClusters = largeTextShareClusters.reduce(
			(acc, cluster) => acc + cluster.percentageTextShare,
			0
		);

		if (totalTextShareOfLargeClusters > 60) {
			return largeTextShareClusters.map((c) => c.cluster);
		}

		// choose clusters till the text share is greater than 60%
		let totalTextShare = 0;
		const criticalClusters = [];
		for (const cluster of sortedClusters) {
			/** Ignore clusters with less than 2%*/
			if (cluster.percentageTextShare < 2) continue;
			if (totalTextShare > 60) break;
			criticalClusters.push(cluster.cluster);
			totalTextShare += cluster.percentageTextShare;
		}

		// if the total text share is less than 60% then return an empty array
		// as this website should not be particularly useful for the web search anyways
		// this should almost never happen on structured website with a lot of text
		if (totalTextShare < 60) {
			return [];
		}

		return criticalClusters;
	};

	function serializeHTMLElement(node: Element): SerializedHTMLElement {
		return {
			tagName: node.tagName.toLowerCase(),
			attributes: Object.fromEntries(
				Array.from(node.attributes).map(({ name, value }) => [name, value])
			),
			content: Array.from(node.childNodes).map(serializeNode).filter(Boolean),
		};
	}

	function serializeNode(node: Node): SerializedHTMLElement | string {
		if (node.nodeType === 1) return serializeHTMLElement(node as Element);
		else if (node.nodeType === 3) return node.textContent ?? "";
		else return "";
	}

	function getPageMetadata(): {
		title: string;
		siteName?: string;
		author?: string;
		description?: string;
		createdAt?: string;
		updatedAt?: string;
	} {
		const title = document.title ?? "";
		const siteName =
			document.querySelector("meta[property='og:site_name']")?.getAttribute("content") ?? undefined;
		const author =
			document.querySelector("meta[name='author']")?.getAttribute("content") ?? undefined;
		const description =
			document.querySelector("meta[name='description']")?.getAttribute("content") ??
			document.querySelector("meta[property='og:description']")?.getAttribute("content") ??
			undefined;
		const createdAt =
			document.querySelector("meta[property='article:published_time']")?.getAttribute("content") ??
			document.querySelector("meta[name='date']")?.getAttribute("content") ??
			undefined;
		const updatedAt =
			document.querySelector("meta[property='article:modified_time']")?.getAttribute("content") ??
			undefined;

		return { title, siteName, author, description, createdAt, updatedAt };
	}

	const readableNodes = getAllReadableNodes();
	const clusters = clusterReadableNodes(readableNodes);

	const criticalClusters = findCriticalClusters(clusters);

	// filter readable nodes using the above information as well as heuristics
	const filteredNodes = readableNodes.filter((_, idx) => {
		return criticalClusters.some((cluster) => {
			return cluster.includes(idx);
		});
	});

	const elements = filteredNodes
		.filter(
			(node, idx, nodes) => !nodes.slice(idx + 1).some((otherNode) => node.node === otherNode.node)
		)
		.map<SerializedHTMLElement>(({ node }) => serializeHTMLElement(node));
	const metadata = getPageMetadata();
	return { ...metadata, elements };
}
