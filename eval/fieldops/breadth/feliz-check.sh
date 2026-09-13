cd /home/user/Loc/eval/fieldops/breadth
docker run --rm -v "$PWD/out-fe-feliz/web:/w" -w /w --network host \
  -e HTTPS_PROXY -e HTTP_PROXY -e NODE_EXTRA_CA_CERTS=/ca.crt \
  -v /root/.ccr/ca-bundle.crt:/usr/local/share/ca-certificates/proxy.crt:ro \
  -v /root/.ccr/ca-bundle.crt:/ca.crt:ro \
  mcr.microsoft.com/dotnet/sdk:10.0 bash -lc '
    update-ca-certificates >/dev/null 2>&1
    export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
    dotnet build 2>&1 | tail -25
  '
