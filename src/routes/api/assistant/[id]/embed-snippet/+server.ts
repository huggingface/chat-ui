export async function GET({ params }) {
	const { id } = params;

	const script = `(function() {
	function resizeIframeToContentSize(iframe) {
		if (iframe.contentWindow) {
			const maxHeight = window.innerHeight * 0.8; // 80% of window height
			const chatContainerEl = iframe.contentWindow.document.getElementById('chat-container');
			if(chatContainerEl){
				const contentHeight = chatContainerEl.scrollHeight;
				iframe.style.height = Math.max(400, Math.min(contentHeight, maxHeight)) + "px";
			}
		}
	}

	document.addEventListener('DOMContentLoaded', function() {
		const button = document.createElement('button');
		button.className = 'fixed z-[1002] bottom-5 right-5 z-50 px-4 gap-1 py-1 bg-black rounded-full text-white rounded cursor-pointer hover:bg-gray-800 border border-gray-200/30 transition-colors flex items-center focus:outline-none';

		const img = document.createElement('img');
		img.src = 'https://huggingface.co/chat/huggingchat/logo.svg';
		img.alt = 'HuggingChat Logo';
		img.className = 'size-5 mr-0.5 flex-none';

		const text = document.createTextNode('Chat');

		button.appendChild(img);
		button.appendChild(text);

		const modal = document.createElement('div');
		modal.className = 'hidden fixed inset-0 z-[1001] overflow-auto bg-black bg-opacity-50';

		const modalContent = document.createElement('div');
		modalContent.className = 'bg-white  max-w-2xl rounded-xl overflow-hidden bottom-16 right-5 absolute max-sm:left-5 sm:w-[460px] shadow-2xl';

		const iframe = document.createElement('iframe');
		iframe.className = 'w-full';
		iframe.style.height = '400px'; // Set an initial height
		iframe.src = \`http://localhost:5173/chat/?embeddedAssistantId=${id}\`;
		
		iframe.onload = function() {
			const iframeWindow = this.contentWindow;
			const iframeDocument = iframeWindow.document;
			
			let lastHeight = 0;
			
			function checkSize() {
				const chatContainer = iframeDocument.getElementById('chat-container');
				if (chatContainer) {
					const newHeight = chatContainer.scrollHeight;
					if (newHeight !== lastHeight) {
						resizeIframeToContentSize(iframe);
						lastHeight = newHeight;
					}
				}
				requestAnimationFrame(checkSize);
			}

			// Start continuous size checking
			checkSize();

			// Set up MutationObserver as a backup
			const observer = new MutationObserver(() => {
				resizeIframeToContentSize(iframe);
			});

			function initMutationObserver() {
				const chatContainer = iframeDocument.getElementById('chat-container');
				if (chatContainer) {
					console.error('Chat container found, setting up MutationObserver');
					observer.observe(chatContainer, { childList: true, subtree: true, attributes: true, characterData: true });
				} else {
					console.error('Chat container not found, retrying...');
					setTimeout(initMutationObserver, 500); // Retry after 500ms
				}
			}

			// Start trying to initialize the MutationObserver
			initMutationObserver();

			// Resize on load
			resizeIframeToContentSize(iframe);

			// Add event listener for Escape key in iframe
			iframeDocument.addEventListener('keydown', function(event) {
				if (event.key === 'Escape') {
					closeModal();
				}
			});
		};

		modalContent.appendChild(iframe);
		modal.appendChild(modalContent);

		// Store the original overflow style
		let originalOverflow;

		function toggleModal() {
			if (modal.classList.contains('hidden')) {
				modal.classList.remove('hidden');
				resizeIframeToContentSize(iframe);
				// Store the original overflow and prevent scrolling
				originalOverflow = document.body.style.overflow;
				document.body.style.overflow = 'hidden';
			} else {
				modal.classList.add('hidden');
				// Restore the original overflow
				document.body.style.overflow = originalOverflow;
			}
		}

		button.onclick = toggleModal;

		window.onclick = function(event) {
			if (event.target == modal) {
				toggleModal();
			}
		};

		document.addEventListener('keydown', function(event) {
			if (event.key === 'Escape') {
				closeModal();
			}
		});

		// Prevent default scrolling when modal is open
		document.addEventListener('scroll', function(event) {
			if (!modal.classList.contains('hidden')) {
				event.preventDefault();
				return false;
			}
		}, { passive: false });

		// Add resize event listener to adjust iframe height when window is resized
		window.addEventListener('resize', function() {
			if (!modal.classList.contains('hidden')) {
				resizeIframeToContentSize(iframe);
			}
		});

		document.body.appendChild(button);
		document.body.appendChild(modal);
	});
})();
`;

	return new Response(script, {
		headers: {
			"Content-Type": "application/javascript",
			"Access-Control-Allow-Origin": "*",
		},
	});
}
