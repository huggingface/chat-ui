import type { Conversation } from "./Conversation";
import type { Timestamps } from "./Timestamps";

/**
 * The dev Space a PaperPage conversation builds its page in, one per conversation. Its own
 * collection so the sbx token never rides along with the conversation document, which routes
 * serialize to the browser.
 */
export interface PaperPageWorkshop extends Timestamps {
	/** the conversation id */
	_id: Conversation["_id"];
	/** `owner/<slug>-dev`, a Docker Space holding a copy of PAPERPAGE_TEMPLATE_SPACE */
	spaceId: string;
	/** `<subdomain>.hf.space`, what the preview frames and the tools call */
	host: string;
	/** the Space's SBX_TOKEN secret, sent as X-Sandbox-Token to its sbx-server */
	sbxToken: string;
	/** false until the template files were committed, so a failed creation can be resumed */
	templated?: boolean;
	/** `owner/<slug>`, the static Space the page was published to, once it was */
	publishedSpaceId?: string;
}
