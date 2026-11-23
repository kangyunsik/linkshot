export function staticBasePath(value = '') {
  const basePath = value.replace(/\/$/, '');
  if (basePath && (!/^(?:\/[a-zA-Z0-9_.-]+)+$/.test(basePath) || /\/\.{1,2}(?:\/|$)/.test(basePath))) {
    throw new Error('APP_BASE_PATH must be a site path such as /linkshot.');
  }
  return basePath;
}

export function mountStaticSource(source, extension, basePath, flatPublic = false) {
  if (!basePath) return source;
  const prefix = `$1${basePath}/`;
  if (extension === '.html') {
    // Include the home links and the Three.js import map, as well as assets.
    return source.replace(/(\b(?:href|src)\s*=\s*["']|["'](?=\/vendor\/))\/(?!\/)/g, prefix);
  }
  if (extension === '.css') return source.replace(/(\burl\(\s*["']?)\/(?!\/)/g, prefix);
  if (extension !== '.js') return source;

  // Network endpoints stay at their original paths. Only static resources move.
  const mounted = source.replace(/(["'`])\/(?=(?:assets|shared|vendor)\/|favicon\.svg\b)/g, prefix);
  // public/ is copied flat to dist/, unlike the project layout used by Node tests.
  return flatPublic ? mounted.replace(/(\bfrom\s+["'])\.\.\/shared\//g, `${prefix}shared/`) : mounted;
}
