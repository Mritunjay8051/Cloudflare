// Standard NPM import for GitHub Deployment
import { Client } from '@neondatabase/serverless';

// --- CONFIGURATION ---
const NEON_DB_URL = "postgresql://neondb_owner:npg_zOu3ifxHWF6J@ep-wild-term-a1x5g2w1-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const WP_SITE_DOMAIN = "pranavcea.wordpress.com";

const IGNORED_PATHS = ['/home', '/admin', '/login', '/signup', '/search', '/favicon.ico', '/sw.js'];
const STATIC_EXTENSIONS = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.json', '.woff2'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. Skip home/static files
    if (path === '/' || path === '/index.html' || IGNORED_PATHS.some(p => path.startsWith(p)) || STATIC_EXTENSIONS.some(ext => path.endsWith(ext))) {
      return fetch(request);
    }

    try {
      const cleanSlug = path.replace(/^\/|\/$/g, '');
      if (!cleanSlug) return fetch(request);

      let wpSlug = cleanSlug;

      // 2. Neon DB Check
      const client = new Client(NEON_DB_URL);
      try {
        await client.connect();
        const { rows } = await client.query('SELECT original_url FROM url_mappings WHERE short_slug = $1', [cleanSlug]);
        ctx.waitUntil(client.end());
        if (rows.length > 0) {
          const originalUrl = rows[0].original_url;
          const matches = originalUrl.match(/\/([^/]+)\/?$/);
          if (matches) {
            wpSlug = matches[1];
          }
        }
      } catch (dbErr) {
        console.error("DB Skip:", dbErr);
      }

      // 3. WordPress Fetch
      const wpRes = await fetch(`https://public-api.wordpress.com/rest/v1.1/sites/${WP_SITE_DOMAIN}/posts/slug:${wpSlug}`);
      if (!wpRes.ok) return fetch(request);

      const post = await wpRes.json();
      const originalResponse = await fetch(request);
      
      const previewImage = post.featured_image || 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?ixlib=rb-1.2.1&auto=format&fit=crop&w=1200&q=80';
      const cleanDesc = post.excerpt ? post.excerpt.replace(/<[^>]*>/g, '').substring(0, 160) + '...' : 'Read this article on To The Point.';

      // 4. Inject Meta Tags
      return new HTMLRewriter()
        .on('title', { element(e) { e.setInnerContent(post.title); } })
        .on('meta[property="og:title"]', { element(e) { e.setAttribute('content', post.title); } })
        .on('meta[property="og:image"]', { element(e) { e.setAttribute('content', previewImage); } })
        .on('meta[property="og:description"]', { element(e) { e.setAttribute('content', cleanDesc); } })
        .on('meta[name="twitter:card"]', { element(e) { e.setAttribute('content', 'summary_large_image'); } })
        .on('meta[name="twitter:title"]', { element(e) { e.setAttribute('content', post.title); } })
        .on('meta[name="twitter:image"]', { element(e) { e.setAttribute('content', previewImage); } })
        .transform(originalResponse);

    } catch (e) {
      return fetch(request);
    }
  }
};
