import type { APIRoute } from "astro";

const isProdDeploy = import.meta.env.PUBLIC_DEPLOY_TARGET === "prod";

const RAW_BASE_URL = import.meta.env.BASE_URL || "/";
const BASE_URL = RAW_BASE_URL.endsWith("/") ? RAW_BASE_URL : `${RAW_BASE_URL}/`;

export const GET: APIRoute = ({ url }) => {
  if (!isProdDeploy) {
    const disallowAll = "User-agent: *\nDisallow: /";
    return new Response(disallowAll, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const siteBase = new URL(BASE_URL, url.origin);
  const sitemapUrl = new URL("sitemap.xml", siteBase).toString();
  const content = `User-agent: *\nAllow: /\nSitemap: ${sitemapUrl}`;
  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
