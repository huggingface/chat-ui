<script lang="ts">
	import { page } from "$app/stores";
	import PaginationArrow from "./PaginationArrow.svelte";

	interface PageLink {
		isActive: boolean;
		label: string;
		pageIndex: number;
	}

	/**
	 * The number of page links to show on either side of the current page link.
	 */
	const NUM_EXTRA_BUTTONS = 2;

	const ellipsis: PageLink = {
		isActive: false,
		label: "...",
		pageIndex: -1,
	};

	export let classNames = "";
	export let numItemsPerPage: number;
	export let numTotalItems: number;

	let pageLinks: PageLink[] = [];

	const numTotalPages = Math.ceil(numTotalItems / numItemsPerPage);
	const pageIndex = parseInt($page.url.searchParams.get("p") ?? "0");

	$: {
		let pageIndexes = [
			0,
			...new Array(NUM_EXTRA_BUTTONS).fill(0).map((_, i) => pageIndex + i - NUM_EXTRA_BUTTONS),
			pageIndex,
			...new Array(NUM_EXTRA_BUTTONS).fill(0).map((_, i) => pageIndex + i + 1),
			numTotalPages - 1,
		].filter((n) => n >= 0 && n < numTotalPages);

		pageIndexes = [...new Set(pageIndexes)];

		if (pageIndexes.length >= 2 && pageIndexes[1] !== pageIndexes[0] + 1) {
			pageIndexes = [pageIndexes[0], -1, ...pageIndexes.slice(1)];
		}

		const pageAtNegOne = pageIndexes.at(-1);
		const pageAtNegTwo = pageIndexes.at(-2);

		if (
			pageAtNegOne !== undefined &&
			pageAtNegTwo !== undefined &&
			pageIndexes.length >= 2 &&
			pageIndexes.at(-1) !== pageAtNegTwo + 1 &&
			pageIndexes.at(-2) !== -1
		) {
			pageIndexes = [...pageIndexes.slice(0, -1), -1, pageAtNegOne];
		}

		pageLinks = pageIndexes.map((index) => {
			if (index === -1) {
				return ellipsis;
			}

			return {
				isActive: index === pageIndex,
				label: `${(index + 1).toLocaleString("en-US")}`,
				pageIndex: index,
			};
		});
	}

	function getHref(pageIdx: number) {
		const newUrl = new URL($page.url);
		newUrl.searchParams.set("p", pageIdx.toString());
		return newUrl.toString();
	}
</script>

{#if numTotalPages > 1}
	<nav>
		<ul
			class="flex select-none items-center justify-between space-x-2 text-gray-700 sm:justify-center dark:text-gray-300 {classNames}"
		>
			<li>
				<PaginationArrow
					href={getHref(pageIndex - 1)}
					direction="previous"
					isDisabled={pageIndex - 1 < 0}
				/>
			</li>
			{#each pageLinks as pageLink}
				<li class="hidden sm:block">
					<a
						class="
							rounded-lg px-2.5 py-1
							{pageLink.isActive
							? 'bg-gray-50 font-semibold ring-1 ring-inset ring-gray-200 dark:bg-gray-800 dark:text-yellow-500 dark:ring-gray-700'
							: ''}
						"
						class:pointer-events-none={pageLink.label === ellipsis.label}
						href={getHref(pageLink.pageIndex)}
					>
						{pageLink.label}
					</a>
				</li>
			{/each}
			<li>
				<PaginationArrow
					href={getHref(pageIndex + 1)}
					direction="next"
					isDisabled={pageIndex + 1 >= numTotalPages}
				/>
			</li>
		</ul>
	</nav>
{/if}
