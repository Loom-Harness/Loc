/** The names the generated dotnet runtime declares for itself. */
export const DOTNET_RUNTIME = {
  /** Program.cs local holding the dev-only test-reset token. */
  testResetToken: "testResetToken",
  /** Program.cs local holding the port the server listens on. */
  listenPort: "listenPort",
  /** Program.cs local holding the hosting environment name. */
  appEnv: "appEnv",
  /** Program.cs local: whether Strict-Transport-Security is sent. */
  secureTransport: "secureTransport",
  /** Program.cs local function retrying the first database connect. */
  waitForDatabase: "WaitForDatabaseAsync",
  /** The `ConsoleFormatter` writing the shared JSON log envelope. */
  jsonLineFormatter: "JsonLineFormatter",
  /** The CloudEvents envelope record member holding the channel name. */
  envelopeChannel: "Channel",
  /** The envelope member holding kafka's partition key. */
  envelopePartitionKey: "PartitionKey",
  /** The local `ChannelEnvelopes.ForData` computes the partition key into. */
  partitionKeyLocal: "partitionKey",
} as const;
