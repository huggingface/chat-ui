/**
 * pdf.js for the paper reader, loaded on first use so it never weighs on the
 * main bundle. The legacy build: it carries the polyfills the modern build
 * leaves out, and the reader should open on any browser chat-ui supports.
 */
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let loading: Promise<PdfJs> | undefined;

export function loadPdfJs(): Promise<PdfJs> {
	loading ??= (async () => {
		const [pdfjs, worker] = await Promise.all([
			import("pdfjs-dist/legacy/build/pdf.mjs"),
			import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
		]);
		pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
		return pdfjs;
	})();
	return loading;
}

export type PdfDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
export type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;
