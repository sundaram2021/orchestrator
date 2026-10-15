declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component;
  export default component;
}

interface Window {
  __ORCHESTRATOR_WS__?: string;
}
