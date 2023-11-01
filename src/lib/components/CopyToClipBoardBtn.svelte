<script lang="ts">
	import { onDestroy } from "svelte";
    import Modal from './Modal.svelte'
	import IconCopy from "./icons/IconCopy.svelte";
	import Tooltip from "./Tooltip.svelte";
	import Toast from './Toast.svelte';
	export let classNames = "";
	export let value: string;
	let filePath='';
	let fileName='';
	let text='';
	let messageValue='';
    export let modal=false;
	let isSuccess = false;
	let timeout: ReturnType<typeof setTimeout>;
    let successPage=false;

	const handleClick = async () => {
		// writeText() can be unavailable or fail in some cases (iframe, etc) so we try/catch
		try {
			await navigator.clipboard.writeText(value);
            text=value
			isSuccess = true;
			if (timeout) {
				clearTimeout(timeout);
			}
			timeout = setTimeout(() => {
				isSuccess = false;
			}, 1000);
		} catch (err) {
			console.error(err);
		}
	};

	const getInput=(event:any)=>{
		filePath=event.target.value;
	}

	 const getFilePath=(e:any)=>{
filePath=e.target.value
	 }

const handleSave=async()=>{
	let header={
    method: 'POST',
    headers: {
    'Content-Type': 'application/json',
  },
  body:JSON.stringify({
	text:text,
	file_name:fileName,
	path_dir:filePath,
	
  })
}
try {
 const res=await fetch('http://localhost:8000/v1/save/',header )
 successPage=true;
let data=await res.json()
console.log(data)
	  if(data){
messageValue="Successfully saved Into file"
	  }
	  else{
		messageValue="Please Try Again"
	  }

} catch (error) {
 messageValue="Please Try Again"
}

  modal=false;

  setTimeout(()=>{
  successPage=false
  },3000)

}

	onDestroy(() => {
		if (timeout) {
			clearTimeout(timeout);
		}
	});


</script>

<button 
on:click={()=>{handleClick(); modal=true}}
class="btn rounded-lg absolute right-12 top-2  border border-gray-200 px-2 py-[6px] text-sm shadow-sm transition-all hover:border-gray-300 active:shadow-inner dark:border-gray-600 dark:hover:border-gray-400 invisible opacity-0 group-hover:visible group-hover:opacity-100  	{!isSuccess && 'text-gray-200 dark:text-gray-200'}
{isSuccess && 'text-green-500'}"> 
Save into file
</button>
<button
	class="btn rounded-lg border border-gray-200 px-2 py-2 text-sm shadow-sm transition-all hover:border-gray-300 active:shadow-inner dark:border-gray-600 dark:hover:border-gray-400 {classNames}
		{!isSuccess && 'text-gray-200 dark:text-gray-200'}
		{isSuccess && 'text-green-500'}"
	title={"Copy to clipboard"}
	type="button"
	on:click
	on:click={handleClick}
>
	<span class="relative">
		<IconCopy />
		<Tooltip classNames={isSuccess ? "opacity-100" : "opacity-0"} />
	</span>
</button>

{#if modal}
<Modal>
	<div class="w-[385px] p-5">
		<div class="flex  justify-end px-2 pb-2">
				<button on:click={()=>modal=false} class=' text-black'> <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="m8.4 17l3.6-3.6l3.6 3.6l1.4-1.4l-3.6-3.6L17 8.4L15.6 7L12 10.6L8.4 7L7 8.4l3.6 3.6L7 15.6L8.4 17Zm3.6 5q-2.075 0-3.9-.788t-3.175-2.137q-1.35-1.35-2.137-3.175T2 12q0-2.075.788-3.9t2.137-3.175q1.35-1.35 3.175-2.137T12 2q2.075 0 3.9.788t3.175 2.137q1.35 1.35 2.138 3.175T22 12q0 2.075-.788 3.9t-2.137 3.175q-1.35 1.35-3.175 2.138T12 22Z"/></svg></button>
		</div>

		<div class="w-full pl-2 flex gap-3 items-center">

	<span class="min-w-[100px]">File Name</span>
			<input  bind:value={fileName} on:change={getInput}  class=" font-[300] border border-gray-500 w-[250px] px-2 rounded outline-none py-1 text-sm" type='text' placeholder="Enter your path here..."/>
			
		</div>

		<div class="w-full pl-2 flex gap-3 mt-5 items-center">

	<span class="min-w-[100px]">File Path</span>
			<input  bind:value={filePath} on:change={getFilePath}  class="font-[300] text-sm border border-gray-500 w-[250px] px-2 rounded outline-none py-1" type='text' placeholder="Enter your path here..."/>
			
		</div>
		
<div class="flex justify-center mt-5">
<button 
on:click={handleSave}
class="btn mx-auto right-12 rounded-lg border border-gray-200 px-5 py-[6px] text-sm shadow-sm transition-all hover:border-gray-300 active:shadow-inner dark:border-gray-600 dark:hover:border-gray-400	
"> Submit</button>


</div>

	</div>

	
</Modal>
{/if}

{#if successPage}
<Toast  message={messageValue}/>
{/if}



