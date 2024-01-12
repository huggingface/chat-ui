/* eslint-disable no-shadow */
export enum PdfUploadStatus {
	Ready = "Ready",
	Uploading = "Uploading",
	Uploaded = "Uploaded",
}

export interface PdfUpload {
	status: PdfUploadStatus;
	name: string;
}
