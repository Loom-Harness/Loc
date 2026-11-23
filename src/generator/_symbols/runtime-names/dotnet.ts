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
  /** The Dapper repositories' and stores' private static mapping a read row to
   *  its domain object.  The model's types are spelled bare inside that class,
   *  so in an expression (`Status.Open`, `Map.From(…)`) a type of the member's
   *  name would resolve to the method (CS0119); `Create` is a name no domain
   *  type may take (`loom.reserved-type-name`), so the two never meet. */
  rowMapper: "Create",
} as const;
