docker run --rm -v "$PWD/out-java/api:/w" -w /w --network host \
  -e HTTPS_PROXY -e HTTP_PROXY \
  -e JAVA_TOOL_OPTIONS="-Djavax.net.ssl.trustStore=/root/.ccr/java-truststore.p12 -Djavax.net.ssl.trustStorePassword=changeit" \
  -v /root/.ccr:/root/.ccr:ro \
  gradle:8-jdk21 bash -lc 'gradle --no-daemon testClasses 2>&1 | tail -40'
