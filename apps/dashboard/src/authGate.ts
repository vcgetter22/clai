/** Tiny pub/sub so any API call, anywhere, can tell App.tsx "show the token prompt" without prop drilling. */
type Listener = () => void;
let listeners: Listener[] = [];

export function onUnauthorized(cb: Listener): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

export function triggerUnauthorized(): void {
  for (const l of listeners) l();
}
