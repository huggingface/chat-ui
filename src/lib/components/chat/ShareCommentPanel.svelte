<script lang="ts">
    import { page } from "$app/stores";
    import type { createEventDispatcher } from "svelte";

    import type { DisplayCommentThread, DisplayComment } from "$lib/types/Comment";

	import * as TextQuote from 'dom-anchor-text-quote';
  	import * as TextPosition from 'dom-anchor-text-position';
	import wrapRangeText from 'wrap-range-text';

    import CarbonEdit from "~icons/carbon/edit";
    import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonClose from "~icons/carbon/close";
	import CarbonSend from "~icons/carbon/send";
    import CarbonReply from "~icons/carbon/reply";


    export let shared: boolean;
    export let displayCommentThreads: DisplayCommentThread[] = [];
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
                const commentThreads: DisplayCommentThread[] = await response.json();
                
                displayCommentThreads = commentThreads.map((thread) => ({
                    ...thread,
                    comments: thread.comments.map(comment => ({
                        ...comment,
                        originalContent: comment.content,
                        isPending: false
                    })),
                    isPending: false,
                    wrapperObject: undefined
                }));
            } catch (error) {
                console.error("Error fetching comments:", error);
            }
        } else {
            // Clear comment threads if not shared or no conversation ID
            displayCommentThreads = [];
        }
	}


    function highlightComments() {
        displayCommentThreads.forEach(commentThread => {
            if (commentThread.textQuoteSelector) {
                const range = TextQuote.toRange(chatContainer, commentThread.textQuoteSelector);
                if (range) {
                    console.log(range);
                    const wrapper = document.createElement('mark');
                    wrapper.dataset.commentThreadId = commentThread._id?.toString() || '';
                    const wrappedRange = wrapRangeText(wrapper, range);
                    commentThread.wrapperObject = wrappedRange;
                }
            }
        });

        // Add a single event listener to the chatContainer
        chatContainer.addEventListener('click', handleMarkClick);
    }

    function handleMarkClick(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (target.tagName === 'MARK') {
            const commentThreadId = target.dataset.commentThreadId;
            console.log(commentThreadId);
            if (commentThreadId) {
                const commentElement = document.querySelector(`li[data-comment-thread-id="${commentThreadId}"]`);
                if (commentElement) {
                    commentElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    
                    // Find the textarea within the comment element
                    const textarea = commentElement.querySelector('textarea') as HTMLTextAreaElement | null;
                    if (textarea) {
                        textarea.focus();
                        // Optional: Move cursor to the end of the text
                        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
                    }
                }
            }
        }
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
			let quoteSelector = TextQuote.fromRange(chatContainer, range);
			let positionSelector = TextPosition.fromRange(chatContainer, range);

			
			// Create a new range from the quoteSelector
			const newRange = TextQuote.toRange(chatContainer, {
				exact: quoteSelector.exact,
				prefix: quoteSelector.prefix,
				suffix: quoteSelector.suffix
			});

			if (newRange) {
				console.log("New range created successfully");
                console.log($page.data.user);
				const wrapper = document.createElement('mark');
				const wrappedRange = wrapRangeText(wrapper, newRange);
				console.log('Wrapped nodes:', wrappedRange.nodes);

				
				// Create a new DisplayCommentThead object
				const newDisplayCommentThread: DisplayCommentThread = {
                    _id: null,
                    comments: [{
                        _id: null,
                        content: "",
                        originalContent: "",
                        username: $page.data.user?.name || $page.data.user?.email || 'Anonymous',
                        isPending: true,
                        updatedAt: new Date(),
						createdAt: new Date(),
                    }],
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
                    updatedAt: new Date(),
					createdAt: new Date(),
				
				};

			// Add the newDisplayComment to the array and sort
			displayCommentThreads = [...displayCommentThreads, newDisplayCommentThread]
            .sort((a, b) => {
                const aStart = a.textPositionSelector?.start ?? 0;
                const bStart = b.textPositionSelector?.start ?? 0;
                return aStart - bStart;
            });

			console.log("New comment added:", newDisplayCommentThread);

			} else {
				console.log("Failed to create new range");
			}
			

		}
	}

	// Handles posting a newly created comment or an update to an existing comment
	async function handlePostComment(displayCommentThread: DisplayCommentThread) {
		try {
			let response;
            const commentThreadData = {
                comments: displayCommentThread.comments.map(comment => ({
                    content: comment.content
                })),
                textQuoteSelector: displayCommentThread.textQuoteSelector,
                textPositionSelector: displayCommentThread.textPositionSelector
            };

			if ('_id' in displayCommentThread && displayCommentThread._id) {
				// Update existing comment
				response = await fetch(`/conversation/${$page.params.id}/comments`, {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						...commentThreadData,
						commentThreadId: displayCommentThread._id,
					}),
				});
			} else {
				// Create new comment
				response = await fetch(`/conversation/${$page.params.id}/comments`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(commentThreadData),
				});
			}

			if (!response.ok) {
				throw new Error('Failed to save comment');
			}

			const result = await response.json();

			// Update the displayCommentThreads array
            displayCommentThreads = displayCommentThreads.map(commentThread => 
                commentThread === displayCommentThread 
                    ? { 
                        ...commentThread,
                        _id: result.id || commentThread._id,
                        userId: result.userId || commentThread.userId,
                        comments: commentThread.comments.map(comment => ({
                            ...comment,
                            content: comment.content,
                            originalContent: comment.content,
                            isPending: false,
                            updatedAt: new Date()
                        })),
                        textQuoteSelector: commentThread.textQuoteSelector,
                        textPositionSelector: commentThread.textPositionSelector,
                        isPending: false,
                        updatedAt: new Date(),
                        createdAt: commentThread.createdAt || new Date(),
                    } 
                    : commentThread
            );

            // Update the comment wrapper mark with the comment thread id now that we have it
            if (displayCommentThread.wrapperObject && result.id) {
                const markElement = displayCommentThread.wrapperObject.nodes[0] as HTMLElement;
                if (markElement && markElement.tagName === 'MARK') {
                    markElement.dataset.commentThreadId = result.id.toString();
                }
            }

			console.log("Comment saved successfully:", result);
		} catch (error) {
			console.error("Error saving comment:", error);
			alert("Failed to save comment. Please try again.");
		}
	}

	// Handles deleting a comment. Should only be called on a persisted comment, but just returns if it is.
	async function handleDeleteComment(displayCommentThread: DisplayCommentThread) {
		// Unwrap the highlighted text associated with this comment
		if (displayCommentThread.wrapperObject) {
			displayCommentThread.wrapperObject.unwrap();
		}
		
		// Remove the comment from the displayComments array
		displayCommentThreads = displayCommentThreads.filter(commentThread => commentThread !== displayCommentThread);

		// Check if the comment is persisted (has a non-empty _id), and if so delete it from the DB
		if ('_id' in displayCommentThread && displayCommentThread._id) {
			try {
				const response = await fetch(`/conversation/${$page.params.id}/comments/${displayCommentThread._id}`, {
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
	function handleEditComment(displayCommentThread: DisplayCommentThread) {
		// Sets isPending to true
		// Sets originalContent to the content
		displayCommentThreads = displayCommentThreads.map(dct => {
            if (dct === displayCommentThread) {
                return {
                    ...dct,
                    isPending: true,
                    comments: dct.comments.map((comment, index) => 
                        index === 0 
                            ? { ...comment, originalContent: comment.content }
                            : comment
                    )
                };
            }
            return dct;
        });

		// No database update needed. That will happen when the comment is posted (handlePostComment)
	}

	function handleCancelEditComment(displayCommentThread: DisplayCommentThread) {
		if (!('_id' in displayCommentThread) || !displayCommentThread._id) {
			// If the DisplayComment was never persisted, delete it
			handleDeleteComment(displayCommentThread);
		} else {
			// Revert the pending edit
            displayCommentThreads = displayCommentThreads.map(dct => {
                if (dct === displayCommentThread) {
                    return {
                        ...dct,
                        isPending: false,
                        comments: dct.comments.map((comment, index) => 
                            index === 0 
                                ? { ...comment, content: comment.originalContent || "" }
                                : comment
                        )
                    };
                }
                return dct;
            });
		}
		// No database updates needed
	}

    async function handleReplyComment(displayCommentThread: DisplayCommentThread) {
        if (!displayCommentThread._id || !displayCommentThread.replyText) return;

        try {
            const response = await fetch(`/conversation/${$page.params.id}/comments/${displayCommentThread._id}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: displayCommentThread.replyText
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to post reply');
            }

            const result = await response.json();

            // Update the displayCommentThreads array
            displayCommentThreads = displayCommentThreads.map(thread => 
                thread === displayCommentThread 
                    ? {
                        ...thread,
                        comments: [...thread.comments, {
                            _id: result.id,
                            content: displayCommentThread.replyText || '', // Ensure content is always a string
                            username: $page.data.user?.name || $page.data.user?.email || 'Anonymous',
                            isPending: false,
                            updatedAt: new Date(),
                            createdAt: new Date(),
                            originalContent: displayCommentThread.replyText || '', // Add this if it's part of DisplayComment
                        } as DisplayComment], // Type assertion
                        replyText: '',
                        showReplyButton: false
                    }
                    : thread
            ) as DisplayCommentThread[];

            console.log("Reply posted successfully:", result);
        } catch (error) {
            console.error("Error posting reply:", error);
            alert("Failed to post reply. Please try again.");
        }
    }


</script>

<div class="col-start-3 col-end-4 flex flex-col h-full overflow-y-auto">
    <div class="flex flex-col items-center p-4">
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
        <!--Display the list of Comment Threads-->
        <div class="mt-4 w-full max-w-md">
            <h3 class="text-lg font-semibold mb-2">Comments</h3>
            {#if displayCommentThreads.length > 0}
                <ul class="space-y-2">
                    {#each displayCommentThreads as dct, index}
                    <li class="bg-gray-100 p-3 rounded-lg" data-comment-thread-id={dct._id || ''}>
                        {#if !dct.isPending}
                            <p>{"> " + dct.textQuoteSelector?.exact}</p>
                            
                            {#each dct.comments as comment}
                                <div class="mt-2 p-2 bg-white rounded">
                                    <div class="flex items-center justify-between">
                                        <p class="text-sm text-gray-600 font-semibold">{comment.username || 'Anonymous'}</p>
                                        <p class="text-xs text-gray-500">
                                            {new Date(comment.updatedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                                        </p>
                                    </div>
                                    <p>{comment.content}</p>
                                </div>
                            {/each}

                            <div class="mt-2">
                                <textarea
                                    class="w-full p-2 border rounded-md text-sm"
                                    rows="1"
                                    placeholder="Reply to this comment..."
                                    bind:value={dct.replyText}
                                    on:focus={() => dct.showReplyButton = true}
                                    on:blur={() => dct.showReplyButton = !!dct.replyText && dct.replyText.trim() !== ''}
                                ></textarea>
                            </div>


                
                            <div class="flex justify-end mt-2">
                                {#if dct.showReplyButton || (dct.replyText && dct.replyText.trim() !== '')}
                                    <button
                                        class="mr-2 p-1 bg-blue-500 text-white rounded-full"
                                        on:click={() => handleReplyComment(dct)}
                                        aria-label="Reply to Comment"
                                    >
                                        <CarbonReply />
                                    </button>
                                {/if}

                                {#if $page.data.user && dct.userId === $page.data.user.id}
                                    <button
                                        class="mr-2 p-1 bg-green-500 text-white rounded-full"
                                        on:click={() => handleEditComment(dct)}
                                        aria-label="Edit Comment"
                                    >
                                        <CarbonEdit />
                                    </button>
                                    <button
                                        class="p-1 bg-red-500 text-white rounded-full"
                                        on:click={() => {
                                            if (confirm('Are you sure you want to delete this comment?')) {
                                                handleDeleteComment(dct);
                                            }
                                        }}
                                        aria-label="Delete Comment"
                                    >
                                        <CarbonTrashCan />
                                    </button>
                                {/if}
                            </div>
                        {:else}
                            <p>{"> " + dct.textQuoteSelector?.exact}</p>
                            <textarea
                                bind:value={dct.comments[0].content}
                                class="w-full p-2 border rounded-md"
                                rows="3"
                            ></textarea>
                            <div class="flex justify-end mt-2">
                                <button
                                    class="mr-2 p-1 bg-green-500 text-white rounded-full"
                                    on:click={() => handlePostComment(dct)}
                                    aria-label="Save Comment"
                                >
                                    <CarbonSend />
                                </button>
                                <button
                                    class="p-1 bg-red-500 text-white rounded-full"
                                    on:click={() => handleCancelEditComment(dct)}
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
    </div>
</div>