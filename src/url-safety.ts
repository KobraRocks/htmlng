/**
 * URL scheme safety.
 *
 * The engine renders author-supplied URLs into href/src attributes. `text`
 * fields are HTML-whitelisted but their `<a href>` values, plus `link`/`image`
 * data, still need scheme checking — `javascript:` in an href is an XSS vector.
 */

/** Raster image types allowed in a data: URL. SVG is excluded (it can execute script). */
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|bmp)[;,]/i;
const DANGEROUS_SCHEME = /^(javascript|vbscript|file|blob)$/i;

/** Extract the scheme of a URL, normalizing away whitespace/control-char obfuscation. */
function schemeOf(url: string): string | null {
  const collapsed = url.replace(/[\u0000-\u0020\u00a0\u2028\u2029]+/g, '');
  const match = collapsed.match(/^([a-z][a-z0-9+.-]*):/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Return a human-readable reason when `url` is unsafe, or null when it is fine.
 *
 * Relative URLs, fragments, and non-dangerous schemes (http, https, mailto, tel,
 * …) are allowed. `data:` is rejected unless `allowDataImage` is set, in which
 * case only raster image data URLs pass.
 */
export function unsafeUrlReason(url: string, opts: { allowDataImage?: boolean } = {}): string | null {
  if (typeof url !== 'string') return null;

  const collapsed = url.replace(/[\u0000-\u0020\u00a0\u2028\u2029]+/g, '');
  const scheme = schemeOf(url);

  if (scheme && DANGEROUS_SCHEME.test(scheme)) {
    return `"${scheme}:" URLs are not allowed`;
  }

  if (/^data:/i.test(collapsed)) {
    if (!opts.allowDataImage) return '"data:" URLs are not allowed here';
    if (!SAFE_DATA_IMAGE.test(collapsed)) {
      return 'only raster "data:image/<type>" URLs are allowed (SVG is not)';
    }
  }

  return null;
}
