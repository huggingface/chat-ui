import sanitizeHtmlLib from "sanitize-html";

/**
 * Shared sanitizer configuration for HTML content.
 * This ensures consistent sanitization across the application.
 *
 * Security features:
 * - Allows safe HTML tags including SVG elements
 * - Forces target="_blank" and rel="noopener noreferrer" on links
 * - Supports data: URLs only for images
 * - Preserves SVG case-sensitive tags and attributes
 * - No inline styles allowed by default (see sanitizeWithStyles for code previews)
 */

const commonConfig: sanitizeHtmlLib.IOptions = {
	allowedTags: sanitizeHtmlLib.defaults.allowedTags.concat([
		// HTML elements
		"img",
		// SVG elements (case-sensitive names preserved by parser below)
		"svg",
		"g",
		"defs",
		"linearGradient",
		"radialGradient",
		"stop",
		"circle",
		"rect",
		"line",
		"polyline",
		"polygon",
		"ellipse",
		"use",
		"symbol",
		"text",
		"tspan",
		"clipPath",
		"mask",
		"pattern",
		"path",
		"image",
	]),
	allowedAttributes: {
		// Keep standard defaults
		...sanitizeHtmlLib.defaults.allowedAttributes,
		a: ["href", "target", "rel"],
		img: ["src", "alt", "title", "width", "height", "loading", "decoding", "referrerpolicy"],
		svg: [
			"xmlns",
			"viewBox",
			"width",
			"height",
			"preserveAspectRatio",
			"class",
			"id",
			"fill",
			"stroke",
		],
		// Needed for functional SVG
		use: ["href", "xlink:href"],
		image: ["href", "xlink:href", "width", "height", "x", "y"],
		"*": [
			"class",
			"id",
			"fill",
			"stroke",
			"stroke-width",
			"transform",
			"d",
			"cx",
			"cy",
			"r",
			"x",
			"y",
			"x1",
			"y1",
			"x2",
			"y2",
			"points",
		],
	},
	// Restrict URL schemes (drop ftp for security)
	allowedSchemes: ["http", "https", "mailto", "tel"],
	// Allow data: URLs only for images (for inline base64 images)
	allowedSchemesByTag: {
		img: ["http", "https", "data"],
	},
	// Disable protocol-relative URLs for security
	allowProtocolRelative: false,
	transformTags: {
		a: (tagName, attribs) => ({
			tagName,
			attribs: {
				...attribs,
				target: "_blank",
				// Both noopener & noreferrer for security and Lighthouse compliance
				rel: "noopener noreferrer",
			},
		}),
	},
	parser: {
		// Needed for SVG camelCase tags/attrs like linearGradient, viewBox
		lowerCaseTags: false,
		lowerCaseAttributeNames: false,
	},
};

/**
 * Standard sanitizer for markdown and general HTML content.
 * Does not allow inline styles.
 */
export function sanitizeHtml(html: string): string {
	return sanitizeHtmlLib(html, commonConfig);
}

/**
 * Sanitizer for code previews that allows limited inline styles.
 * Use this only for trusted code blocks where users expect to see styled HTML.
 *
 * Security note: Only allows a minimal subset of CSS properties with strict regex validation.
 */
export function sanitizeWithStyles(html: string): string {
	return sanitizeHtmlLib(html, {
		...commonConfig,
		allowedAttributes: {
			...commonConfig.allowedAttributes,
			"*": [
				...(commonConfig.allowedAttributes?.["*"] || []),
				"style", // Enable style attribute
			],
		},
		// Very conservative subset of CSS properties
		allowedStyles: {
			"*": {
				// Colors: hex and rgb only
				color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/],
				"background-color": [
					/^#[0-9a-f]{3,8}$/i,
					/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/,
				],
				// Text alignment
				"text-align": [/^(left|right|center)$/],
				// Font sizes
				"font-size": [/^\d+(px|em|rem|%)$/],
				// No url(...) patterns allowed to prevent style-based exfiltration
			},
		},
	});
}
