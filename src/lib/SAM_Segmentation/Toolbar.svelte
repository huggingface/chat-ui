<script>
	import CarbonAdd from "~icons/carbon/add-alt";
	import CarbonSubtract from "~icons/carbon/subtract-alt";
	import CarbonSaveAnnotation from "~icons/carbon/save-annotation";
	import CarbonDelete from "~icons/carbon/delete";
	import CarbonUndo from "~icons/carbon/undo";
	import CarbonDownload from "~icons/carbon/download";
	import CarbonUpload from "~icons/carbon/upload";

	// You can define functions to handle button clicks here
	export let handleAdd = () => {
		console.log("Add clicked");
	};

	export let handleMinus = () => {
		console.log("Minus clicked");
	};

	export let handleRemove = () => {
		console.log("Remove clicked");
	};

	export let handleSave = () => {
		console.log("Save clicked");
	};

	export let handleDelete = () => {
		console.log("Delete clicked");
	};

	export let handleDownload = () => {
		console.log("Download clicked");
	};
	export let handleUpload = () => {
		console.log("Upload clicked");
	};
</script>

<div>
	<div class="toolbar">
		<div class="button-group">
			<button on:click={handleAdd} class="flex items-center justify-center bg-blue-500">
				<CarbonAdd />
			</button>
			Add
		</div>
		<div class="button-group">
			<button on:click={handleMinus} class="flex items-center justify-center bg-red-500">
				<CarbonSubtract />
			</button>
			Minus
		</div>
		<div class="button-group">
			<button on:click={handleRemove} class="flex items-center justify-center bg-yellow-500">
				<CarbonUndo />
			</button>
			Undo
		</div>
		<div class="button-group">
			<button on:click={handleSave} class="flex items-center justify-center bg-green-500">
				<CarbonSaveAnnotation />
			</button>
			Save
		</div>

		<div class="button-group">
			<button on:click={handleDelete} class="flex items-center justify-center bg-red-500">
				<CarbonDelete />
			</button>
			Delete
		</div>

		<!-- <br class="border" /> -->
		<div class="button-group">
			<button on:click={handleDownload} class="flex items-center justify-center bg-green-500">
				<CarbonDownload />
			</button>
			Download
		</div>

		<div class="button-group">
			<button on:click={handleUpload} class="flex items-center justify-center bg-yellow-500">
				<CarbonUpload />
			</button>
			Upload
		</div>
	</div>
	<div />
</div>

<style>
	.toolbar {
		display: flex;
		flex-direction: column;
		justify-content: space-around;
		background-color: transparent;
		padding: 10px;
		border: 1px solid #ccc;
		border-radius: 10px;
		margin: 10px;
	}

	.toolbar button {
		color: white;
		width: 30px;
		height: 30px;
		margin: 5px;
		border-radius: 10px;
		cursor: pointer;
		border-radius: 5px;
		font-size: 16px;
	}

	.button-group {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
	}
	/* .toolbar button:hover {
		background-color: #45a049;
	} */
</style>
