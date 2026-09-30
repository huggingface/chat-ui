import type { RouterExample } from "./routerExamples";

/** Copy for PaperPage Intern mode (see $lib/server/paperPage). */

/**
 * What the composer accepts on top of text and images while the mode is on. The model never reads
 * these files; the import tool copies them into the workshop (10 MB each, the upload limit).
 */
export const PAPERPAGE_UPLOAD_MIME = [
	"application/pdf",
	"application/zip",
	"application/x-zip-compressed",
	"application/gzip",
	"application/x-tar",
	"video/*",
	"audio/*",
	"model/*",
] as const;

/** The PaperPage tool names, shared by the server tools, the prompt and the preview pane. */
export const PAGE_TOOLS = {
	workshop: "page_workshop",
	exec: "page_exec",
	writeFile: "page_write_file",
	editFile: "page_edit_file",
	checkpoint: "page_checkpoint",
	publish: "page_publish",
	uploadMedia: "page_upload_media",
	importAttachments: "page_import_attachments",
	viewImage: "page_view_image",
} as const;

/** PaperPage tools whose output announces the workshop preview (see $lib/utils/spacePreview) */
export const PAPERPAGE_PREVIEW_TOOLS = [PAGE_TOOLS.workshop, PAGE_TOOLS.checkpoint];

/** Composer placeholder while the mode is on. */
export const PAPERPAGE_PLACEHOLDER =
	"Tell me about your paper and the page you want: attach the PDF, link the code, add videos";

/**
 * Starting points shown on an empty conversation. They seed the composer rather than send: each is
 * a brief to fill in, the way a researcher who knows their paper would ask, not a one-line request.
 */
export const paperPageExamples: RouterExample[] = [
	{
		title: "Full brief (template)",
		prompt: `Here is my paper [attach the PDF or paste the arXiv link], the code at [GitHub URL] and the model at [Hub id]. In one sentence: [what the method does and why it matters]. Published at [venue, or "not public yet"].

On the page I want first [the key results, e.g. before/after sliders against X and Y], then [the idea, e.g. an interactive figure of Z], the main results table and the BibTeX.

Full-resolution results (the paper's figures are too compressed for the page): [a Hub bucket, e.g. hf://buckets/you/project-media/, the repo's assets folder, or an existing project page]. Small files can be attached here; videos and anything over 10 MB go in the bucket. Style: [e.g. light, minimal, serif titles].`,
	},
	{
		title: "Marigold: assets in a bucket",
		prompt: `A project page for our CVPR 2024 paper Marigold: Repurposing Diffusion-Based Image Generators for Monocular Depth Estimation (ETH Zürich, oral). We take Stable Diffusion, keep the VAE frozen and fine-tune only the U-Net to denoise depth latents conditioned on the image, on synthetic data only (~74K samples, about 2.5 days on one RTX 4090), and it transfers zero-shot to real benchmarks.

Results first: a big before/after slider right under the title, then a gallery of sliders with a zoom lens, because what people notice is the fine detail (whiskers, dandelion seeds, thin structures). Then a compact "how it works" with our two method figures and a few equations (the depth normalization and the ensembling), then Table 1. Clean and confident, no hype, for a CV/ML audience.

Everything is in the bucket hf://buckets/blanchon/marigold-assets: the paper PDF (24 MB, too big to attach), full-resolution comparisons (input, Marigold, DPT) per scene, the in-the-wild gallery, method figures and videos; MANIFEST.md describes every file.

arXiv https://arxiv.org/abs/2312.02145 · code https://github.com/prs-eth/Marigold · demo https://huggingface.co/spaces/prs-eth/marigold · model https://huggingface.co/prs-eth/marigold-depth-v1-1`,
	},
	{
		title: "UniMate: 3D results",
		prompt: `A project page for our SIGGRAPH Asia 2026 paper UniMate: https://arxiv.org/abs/2609.05415, code https://github.com/Friedrich-M/UniMate. It should make people understand why one model can animate a dragon, a desk lamp and a Unitree G1.

Full-res media: our animated results are meshopt-compressed GLBs under https://linzhanmou.com/unimate/resources/glbs/ (prompts in resources/prompts.json next to it), videos under https://linzhanmou.com/unimate/assets/videos/, figures in the arXiv HTML. Please use those rather than screenshots.

What I'd love:
- a real 3D viewer of our generated animations: pick a rig, see its prompt, toggle mesh/skeleton, and a timeline to scrub and stop on a pose;
- an interactive explanation of the method: a skeleton as a graph, click a joint to see its graph distances and the Laplacian eigenvector coloring Spec-RoPE uses;
- "same prompt, different bodies": two or three clips side by side, played and scrubbed in sync;
- the key numbers of Tables 1–3, and our limitations (foot sliding, rare topologies), I'd rather be upfront.

For graphics and animation researchers, confident but precise. Skip training details and the appendix proofs, and keep a small "research use only" note near the viewer: several rigs are third-party characters.`,
	},
	{
		title: "SAD: an interactive toy",
		prompt: `A project page for our SIGGRAPH 2026 paper SAD: Soft Anisotropic Diagrams for Differentiable Image Representation. The PDF is attached (https://arxiv.org/abs/2604.21984, full-res figures are in its HTML version), code is at https://github.com/LuckyIYI/SAD, and our fitting videos are https://luckyiyi.github.io/SAD/static/videos/fit-1.mp4 to fit-4.mp4.

The idea people miss: each pixel is just a softmax over its top-8 sites under ‖x−p‖_G − r, and the per-site temperature is what turns a blurry blend into crisp Voronoi-like edges. So what I really want is a small toy SAD running in the browser: a few dozen sites you can drag, sliders for τ (soft → hard), radius and anisotropy, and a toggle between the RGB output and the cell view. A plain WebGL shader is fine. If there's room, a rate–distortion chart where you can switch datasets.

For graphics/vision people who know Gaussian splatting but not Apollonius diagrams; clean and technical, no hype. Keep the link to our in-browser WebGPU trainer. Skip the hash-reduction details and the appendix.`,
	},
];
