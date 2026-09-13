docker run --rm -v "$PWD/out-dotnet/api:/w" -w /w --network host \
  -e HTTPS_PROXY -e HTTP_PROXY \
  -v /root/.ccr/ca-bundle.crt:/usr/local/share/ca-certificates/proxy.crt:ro \
  mcr.microsoft.com/dotnet/sdk:10.0 bash -lc '
    update-ca-certificates >/dev/null 2>&1
    export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
    dotnet build -warnaserror 2>&1 | tail -40
  '
