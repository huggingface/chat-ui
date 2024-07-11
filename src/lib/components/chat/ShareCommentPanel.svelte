<script lang="ts">
    import { page } from "$app/stores";
    import type { createEventDispatcher } from "svelte";

    import type { DisplayComment } from "$lib/types/Comment";

	import * as TextQuote from 'dom-anchor-text-quote';
  	import * as TextPosition from 'dom-anchor-text-position';
	import wrapRangeText from 'wrap-range-text';

    import CarbonEdit from "~icons/carbon/edit";
    import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonClose from "~icons/carbon/close";
	import CarbonSend from "~icons/carbon/send";


    export let shared: boolean;
    export let displayComments: DisplayComment[] = [];
    export let conversationStarted: boolean;
	export let currentConversationId: string | null = null;
    export let chatContainer: HTMLElement;
    export let dispatch: ReturnType<typeof createEventDispatcher>;
    export let loginModalOpen: boolean;
	

    // Should cause a re-render if the conversation gets shared or if the user navs to a new conversation
	$: {
        if (shared && currentConversationId) {
            fetchComments().then(() => {
                highlightComments();
            });
        }
	}

	function onShare() {
		dispatch("share");
	}

	async function fetchComments() {
		if (shared && currentConversationId) {
		try {
			const response = await fetch(`/conversation/${currentConversationId}/comments`);
			if (!response.ok) {
				throw new Error('Failed to fetch comments');
			}
			const comments: DisplayComment[] = await response.json();
			
			displayComments = comments.map((comment) => ({
				...comment,
				originalContent: comment.content,
				isPending: false
			}));
		} catch (error) {
			console.error("Error fetching comments:", error);
		}
		} else {
			// Clear comments if not shared or no conversation ID
			displayComments = [];
		}
	}


	function highlightComments() {
		displayComments.forEach(comment => {
		if (comment.textQuoteSelector) {
			const range = TextQuote.toRange(chatContainer, comment.textQuoteSelector);
			if (range) {
                const wrapper = document.createElement('mark');
                const wrappedRange = wrapRangeText(wrapper, range);
                comment.wrapperObject = wrappedRange;
			}
		}
		});
	}	


    function handleCommentClick() {
        if (!$page.data.user) {
            loginModalOpen = true;
            $page.data.loginRequired = true;
        } else {
            addComment();
        }
    }

	// Adds a new DisplayComment to the array, ready for authoring, but doesn't persist it yet
	function addComment() {
		console.log("Comment button clicked - addComment function called");
		
		const selection = window.getSelection();
		
		if (!selection || selection.rangeCount === 0) {
			alert("No Selection");
			return;
		}
		
		const range = selection.getRangeAt(0);
		const selectedText = range.toString().trim();
		
		if (selectedText === "") {
			alert("No Selection");
		} else {
			let quoteSelector = TextQuote.fromRange(document.body, range);
			let positionSelector = TextPosition.fromRange(document.body, range);

			
			// Create a new range from the quoteSelector
			const newRange = TextQuote.toRange(document.body, {
				exact: quoteSelector.exact,
				prefix: quoteSelector.prefix,
				suffix: quoteSelector.suffix
			});

			if (newRange) {
				console.log("New range created successfully");
				const wrapper = document.createElement('mark');
				const wrappedRange = wrapRangeText(wrapper, newRange);
				console.log('Wrapped nodes:', wrappedRange.nodes);

				
				// Create a new DisplayComment object
				const newDisplayComment: DisplayComment = {

					content: "",

					textQuoteSelector: {
						exact: quoteSelector.exact,
						prefix: quoteSelector.prefix,
						suffix: quoteSelector.suffix
					},
					textPositionSelector: {
						start: positionSelector.start,
						end: positionSelector.end
					},
					isPending: true,
					wrapperObject: wrappedRange,
					originalContent: "",
				
				};

			// Add the newDisplayComment to the array and sort
			displayComments = [...displayComments, newDisplayComment]
            .sort((a, b) => {
                const aStart = a.textPositionSelector?.start ?? 0;
                const bStart = b.textPositionSelector?.start ?? 0;
                return aStart - bStart;
            });

			console.log("New comment added:", newDisplayComment);

			} else {
				console.log("Failed to create new range");
			}
			

		}
	}

	// Handles posting a newly created comment or an update to an existing comment
	async function handlePostComment(displayComment: DisplayComment) {
		try {
			let response;
			const commentData = {
				content: displayComment.content,
				textQuoteSelector: displayComment.textQuoteSelector,
				textPositionSelector: displayComment.textPositionSelector,
			};

			if ('_id' in displayComment && displayComment._id) {
				// Update existing comment
				response = await fetch(`/conversation/${$page.params.id}/comments`, {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						...commentData,
						commentId: displayComment._id,
					}),
				});
			} else {
				// Create new comment
				response = await fetch(`/conversation/${$page.params.id}/comments`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(commentData),
				});
			}

			if (!response.ok) {
				throw new Error('Failed to save comment');
			}

			const result = await response.json();

			// Update the displayComments array
			displayComments = displayComments.map(comment => 
				comment === displayComment 
					? { 
						...comment, 
						...commentData, 
						_id: result.id || displayComment._id, 
						isPending: false,
						updatedAt: new Date(),
						createdAt: comment.createdAt || new Date(),
					} 
					: comment
			);

			console.log("Comment saved successfully:", result);
		} catch (error) {
			console.error("Error saving comment:", error);
			alert("Failed to save comment. Please try again.");
		}
	}

	// Handles deleting a comment. Should only be called on a persisted comment, but just returns if it is.
	async function handleDeleteComment(displayComment: DisplayComment) {
		// Unwrap the highlighted text associated with this comment
		if (displayComment.wrapperObject) {
			displayComment.wrapperObject.unwrap();
		}
		
		// Remove the comment from the displayComments array
		displayComments = displayComments.filter(comment => comment !== displayComment);

		// Check if the comment is persisted (has a non-empty _id), and if so delete it from the DB
		if ('_id' in displayComment && displayComment._id) {
			try {
				const response = await fetch(`/conversation/${$page.params.id}/comments/${displayComment._id}`, {
					method: 'DELETE',
				});

				if (!response.ok) {
					throw new Error('Failed to delete comment');
				}

				console.log("Comment deleted successfully from the database");
			} catch (error) {
				console.error("Error deleting comment:", error);
				alert("Failed to delete comment. Please try again.");
				// Optionally, you could add the comment back to the displayComments array here
			}
		}
	}

	// Handles editing an existing DisplayComment. 
	function handleEditComment(displayComment: DisplayComment) {
		// Sets isPending to true
		// Sets originalContent to the content
		displayComments = displayComments.map(dc => {
			if (dc === displayComment) {
				return {
					...dc,
					isPending: true,
					originalContent: dc.content
				};
			}
			return dc;
		});

		// No database update needed. That will happen when the comment is posted (handlePostComment)
	}

	function handleCancelEditComment(displayComment: DisplayComment) {
		if (!('_id' in displayComment) || !displayComment._id) {
			// If the DisplayComment was never persisted, delete it
			handleDeleteComment(displayComment);
		} else {
			// Revert the pending edit
			displayComments = displayComments.map(dc => {
				if (dc === displayComment) {
					return {
						...dc,
						isPending: false,
						content: dc.originalContent || ""
					};
				}
				return dc;
			});
		}
		// No database updates needed
	}


</script>


{#if conversationStarted && !shared}
<button
    class="flex items-center justify-center p-2 rounded-lg bg-white shadow-md hover:shadow-lg transition-shadow duration-300 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-blue-300"
    type="button"
    on:click={onShare}
>
    <img src="/chatui/lifesaver-500x500.png" alt="Ask for Help" class="w-20 h-20" />
    <span class="ml-4 mr-4 text-xl font-semibold text-gray-800">Share & Get Help</span>
</button>
<p class="mt-4 text-sm text-gray-600 text-center max-w-xs">
    Click to comment on this chat and get help from the community.
</p>
{:else if conversationStarted}
<!--Display the list of Comments-->
<div class="mt-4 w-full max-w-md">
	<h3 class="text-lg font-semibold mb-2">Comments</h3>
	{#if displayComments.length > 0}
		<ul class="space-y-2">
		{#each displayComments as dc, index}
			<li class="bg-gray-100 p-3 rounded-lg">
				{#if !dc.isPending}
					<p class="text-sm text-gray-600">
						{#if dc.username}
							<span class="font-semibold">{dc.username}</span><br/>
						{/if}
						{#if dc.textPositionSelector && dc.textPositionSelector.start !== undefined}
							Position: {dc.textPositionSelector.start}<br/>
						{/if}
						{#if 'updatedAt' in dc && dc.updatedAt}
							Last Updated: {new Date(dc.updatedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
							<br/>
						{/if}
					</p>
					<p>{"> " + dc.textQuoteSelector?.exact}</p>
					<p>{dc.content}</p>
					<div class="flex justify-end mt-2">
						<button
						class="mr-2 p-1 bg-green-500 text-white rounded-full"
						on:click={() => handleEditComment(dc)}
						aria-label="Edit Comment"
						>
							<CarbonEdit />
						</button>
						<button
							class="p-1 bg-red-500 text-white rounded-full"
							on:click={() => {
								if (confirm('Are you sure you want to delete this comment?')) {
									handleDeleteComment(dc);
								}
							}}
							aria-label="Delete Comment"
						>
							<CarbonTrashCan />
						</button>
					</div>
				{:else}
					<p>{"> " + dc.textQuoteSelector?.exact}</p>
					<textarea
						bind:value={dc.content}
						class="w-full p-2 border rounded-md"
						rows="3"
					></textarea>
					<div class="flex justify-end mt-2">
						<button
							class="mr-2 p-1 bg-green-500 text-white rounded-full"
							on:click={() => handlePostComment(dc)}
							aria-label="Save Comment"
						>
							<CarbonSend />
						</button>
						<button
							class="p-1 bg-red-500 text-white rounded-full"
							on:click={() => handleCancelEditComment(dc)}
							aria-label="Cancel"
						>
							<CarbonClose />
						</button>
					</div>
				{/if}

			</li>
		{/each}
		</ul>
	{:else}
		<p class="text-gray-600">No comments yet.</p>
	{/if}
</div>
<button
class="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-300"
on:click={handleCommentClick}
>
	Comment
</button>
{/if}