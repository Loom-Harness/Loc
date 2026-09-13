docker run --rm -v "$PWD/out-java/api:/w" -w /w --network host \
  -e HTTPS_PROXY -e HTTP_PROXY \
  -e JAVA_TOOL_OPTIONS="-Djavax.net.ssl.trustStore=/root/.ccr/java-truststore.p12 -Djavax.net.ssl.trustStorePassword=changeit" \
  -v /root/.ccr:/root/.ccr:ro -v /tmp/gradle-home:/gh \
  eclipse-temurin:25-jdk bash -lc '
    cp /root/.ccr/ca-bundle.crt /usr/local/share/ca-certificates/proxy.crt 2>/dev/null
    update-ca-certificates >/dev/null 2>&1
    apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq unzip curl >/dev/null 2>&1
    cd /tmp && curl -sSL --cacert /root/.ccr/ca-bundle.crt -o g.zip https://services.gradle.org/distributions/gradle-9.1.0-bin.zip && unzip -q g.zip
    export PATH=/tmp/gradle-9.1.0/bin:$PATH GRADLE_USER_HOME=/gh
    cd /w && gradle --no-daemon testClasses 2>&1 | tail -35
  '
