<script lang="ts">
	import '../styles.css';

	import { browser } from '$app/environment';

	if (browser) {
		console.log('browser');
	}
</script>

<slot />
