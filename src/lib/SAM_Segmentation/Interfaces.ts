// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.

// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.

import type { TypedTensor } from "onnxruntime-web";

// The following interfaces are based on the input and output of the model
export interface ModelInput {
	image_embeddings: TypedTensor<"float32">;
	point_coords: TypedTensor<"float32">;
	point_labels: TypedTensor<"float32">;
	orig_im_size: TypedTensor<"float32">;
	mask_input: TypedTensor<"float32">;
	has_mask_input: TypedTensor<"float32">;
}

export interface ModelOutput {
	masks: TypedTensor<"float32">;
	low_res_logits: TypedTensor<"float32">;
}

// The following interfaces are based on the input and output of the users
export interface UserInput {
	clicks: {
		x: number;
		y: number;
		clickType: number;
	}[];
	tensor: TypedTensor<"float32">;
	modelScale: {
		samScale: number;
		height: number;
		width: number;
	};
}

export interface UserOutput {
	mask: number[][];
}
