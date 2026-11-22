// The runtime stage of a self-hosted static bundle (Feliz, Flutter web): nginx
// serving the built files on :3000 with an SPA fallback.
//
// Under a base path (`/ops`, a gateway part) the bundle sits beneath it, so the
// files are copied there, the fallback is its `index.html`, and the bare base
// redirects to its slash form on the browser's own host.

/** The `COPY` + nginx config lines of the runtime stage. */
export function staticNginxRuntime(distDir: string, basePath?: string): string {
  if (!basePath) {
    return `COPY --from=build ${distDir} /usr/share/nginx/html
RUN printf 'server { listen 3000; root /usr/share/nginx/html; location / { try_files $uri /index.html; } }' \\
  > /etc/nginx/conf.d/default.conf`;
  }
  return `COPY --from=build ${distDir} /usr/share/nginx/html${basePath}
RUN printf 'server { listen 3000; root /usr/share/nginx/html; absolute_redirect off; location = ${basePath} { return 301 ${basePath}/; } location ${basePath}/ { try_files $uri $uri/ ${basePath}/index.html; } }' \\
  > /etc/nginx/conf.d/default.conf`;
}
