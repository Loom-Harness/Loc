docker run --rm -v "$PWD/out-elixir2/api:/w" -w /w --network host \
  -e HTTPS_PROXY -e HTTP_PROXY -e HEX_UNSAFE_HTTPS=1 \
  -v /root/.ccr/ca-bundle.crt:/usr/local/share/ca-certificates/proxy.crt:ro \
  elixir:1.17-otp-27 bash -lc '
    update-ca-certificates >/dev/null 2>&1
    export ERL_FLAGS="-kernel inet_dist_use_interface" MIX_ENV=dev
    mix local.hex --force >/dev/null 2>&1 && mix local.rebar --force >/dev/null 2>&1
    mix deps.get 2>&1 | tail -8
    mix compile 2>&1 | tail -30
  '
