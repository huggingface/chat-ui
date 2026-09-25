import { VIRTUAL_FILE_SCHEME } from "./refs";

/** kept away from the store so the prompt specs can measure this text without a database */

export const WRITE_FILE_TOOL_NAME = "write_file";
export const EDIT_FILE_TOOL_NAME = "edit_file";
export const READ_FILE_TOOL_NAME = "read_file";

export const VIRTUAL_FILE_REFERENCE_RULES =
	`Pass a file to a Hub tool as the reference ${VIRTUAL_FILE_SCHEME}<name> in place of the ` +
	`content, and the server sends the file's latest version; ${VIRTUAL_FILE_SCHEME}<name>@v3 pins ` +
	`version 3. It works in exactly three places: hf_jobs "script", hf_fs_write "content", and ` +
	`the token after --text in hf_sandbox_fs write. The reference must be the whole value, ` +
	`not part of a longer string.`;

/** sent with the tools, a run without them must not read about a reference nothing expands */
export const VIRTUAL_FILES_TOOL_PREPROMPT =
	`VIRTUAL FILES: every script you run is a virtual file. Write it once with ${WRITE_FILE_TOOL_NAME}, ` +
	`change it with ${EDIT_FILE_TOOL_NAME} (search-and-replace, not a rewrite), and find it again with ` +
	`${READ_FILE_TOOL_NAME}, which lists your files when called with no name. ${VIRTUAL_FILE_REFERENCE_RULES} ` +
	`Never paste a script you have already written into a tool call: fix the file and resubmit the ` +
	`reference. Tool results never echo file content back.`;
