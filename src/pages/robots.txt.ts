import type { APIRoute } from "astro";

const isProdDeploy = import.meta.env.PUBLIC_DEPLOY_TARGET === "prod";

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

  const sitemapUrl = new URL("sitemap.xml", url.origin).toString();
  const content = `User-agent: *\nAllow: /\nSitemap: ${sitemapUrl}`;
  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
