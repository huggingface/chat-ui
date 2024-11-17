<script lang="ts">
  export let classNames = "";
</script>

<div class={"transcription-animation " + classNames}>
  <div class="wave"></div>
  <div class="wave"></div>
  <div class="wave"></div>
</div>

<style>
  .transcription-animation {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
  }

  .wave {
    background: #000;
    width: 5px;
    height: 20px;
    margin: 0 2px;
    animation: wave 1.2s linear infinite;
  }

  .wave:nth-child(2) {
    animation-delay: -1.1s;
  }

  .wave:nth-child(3) {
    animation-delay: -1s;
  }

  @keyframes wave {
    0%, 40%, 100% {
      transform: scaleY(0.4);
    }
    20% {
      transform: scaleY(1);
    }
  }
</style>
