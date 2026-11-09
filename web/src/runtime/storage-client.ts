// A deployable worker's connection to its storage: a `PGliteWorker` client on
// the channel the infra worker opened.
//
// `PGliteWorker` normally spawns its own worker to host PGlite and lets the
// clients elect a leader among those workers.  Here the database already
// runs in the storage host, so the client gets this stand-in for its
// `Worker` instead: it answers only the handshake (`here` → `init` →
// `ready{ id }`) with the host's channel, and never claims leadership.  From
// then on the client talks to the host over PGlite's own broadcast channel,
// with PGlite's own locking — so the same library runs both ends.

/** The `Worker` surface `PGliteWorker` touches. */
export class StorageHostHandle extends EventTarget {
  constructor(private readonly channel: string) {
    super();
    // After the constructor returns: `PGliteWorker` attaches its listener
    // synchronously once it holds the handle.
    setTimeout(() => this.emit({ type: "here" }), 0);
  }

  private emit(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  postMessage(message: unknown): void {
    if ((message as { type?: string })?.type === "init") {
      setTimeout(() => this.emit({ type: "ready", id: this.channel }), 0);
    }
  }

  /** The client "terminates its worker" on close; the host lives on. */
  terminate(): void {}
}
