/** The names the generated java runtime declares for itself. */
export const JAVA_RUNTIME = {
  /** The SLF4J logger the catalog events log on (`CatalogLog`, `logback.xml`). */
  catalogLogger: "eventCatalog",
  /** The `@Bean` method that makes Jackson refuse number/bool → String coercion. */
  strictNumbersBean: "strictNumbers",
  /** The `@Configuration` class installing Hibernate's JSON format mapper. */
  jsonFormatMapperConfig: "JsonFormatMapperConfig",
  /** The `@Bean` method in that class. */
  jsonFormatMapperBean: "jsonFormatMapper",
  /** The CloudEvents envelope record component holding the channel name. */
  envelopeChannel: "channel",
  /** The envelope component holding kafka's partition key, and the local
   *  `ChannelEnvelopes.forData` computes it into. */
  envelopePartitionKey: "partitionKey",
} as const;
