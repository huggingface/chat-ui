import createDOMPurify from 'dompurify';
import { browser } from '$app/environment';

export const CONTENT_TRUSTED_ORGS = ['huggingface'];
export const CONTENT_TRUSTED_USERS: string[] = ['madlag'];

const FORBIDDEN_TAGS = ['form', 'textarea'];
const FORBIDDEN_ATTRS = ['contenteditable'];
const FORBIDDEN_CSS_PROPERTIES = {
	position: ['fixed', 'sticky']
};
const FORBIDDEN_CSS_CLASSES = ['fixed', 'sticky'];

export async function sanitize(
	content: string,
	sanitizeConfig?: createDOMPurify.Config & {
		RETURN_DOM_FRAGMENT?: false | undefined;
		RETURN_DOM?: false | undefined;
	}
): Promise<string> {
	await loadDOMPurify();
	let sanitizedContent = content;

	sanitizedContent = purify.sanitize(sanitizedContent, {
		...sanitizeConfig,
		FORBID_TAGS: [...(sanitizeConfig?.FORBID_TAGS ?? []), ...FORBIDDEN_TAGS],
		FORBID_ATTR: [...(sanitizeConfig?.FORBID_ATTR ?? []), ...FORBIDDEN_ATTRS]
	});

	return sanitizedContent;
}

let purify: createDOMPurify.DOMPurifyI;

async function loadDOMPurify() {
	if (purify) {
		return;
	}
	if (!browser) {
		/// To avoid needing the dependency on the frontend, we load it dynamically on the backend
		// eslint-disable-next-line @typescript-eslint/no-shadow
		const { JSDOM } = await import('jsdom');
		purify = createDOMPurify(new JSDOM().window as unknown as Window);
	} else {
		purify = createDOMPurify(window);
	}

	purify.addHook('afterSanitizeAttributes', (node: any) => {
		const htmlNode = node as HTMLElement;
		if (htmlNode.hasAttribute('style') && 'style') {
			if (FORBIDDEN_CSS_PROPERTIES['position'].includes(htmlNode.style.position)) {
				htmlNode.style.position = '';
			}
		}
		if (htmlNode.hasAttribute('class')) {
			htmlNode.classList.remove(...FORBIDDEN_CSS_CLASSES);
		}
	});
}
