import type { ObjectId } from "mongodb";
import type { Timestamps } from "./Timestamps";

export interface PdfSearch extends Timestamps {
	_id?: ObjectId;
	context: string;
}

/* eslint-disable no-shadow */
export enum PdfUploadStatus {
	Ready = "Ready",
	Uploading = "Uploading",
	Uploaded = "Uploaded",
}
