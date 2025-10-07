import type { APIRoute } from "astro";
import skus from "../data/skus.json";

const isProdDeploy = import.meta.env.PUBLIC_DEPLOY_TARGET === "prod";
const BASE_URL = import.meta.env.BASE_URL || "/";

function buildUrl(origin: string, path: string) {
  const siteBase = new URL(BASE_URL, origin);
  return new URL(path, siteBase).toString();
}

export const GET: APIRoute = ({ url }) => {
  if (!isProdDeploy) {
    return new Response(null, { status: 404 });
  }

  const staticPaths = [
    "",
    "calculators/",
    "deals/",
    "prices/",
    "about/affiliate/",
    "about/sources/",
  ];

  const skuPaths = Array.isArray(skus)
    ? skus
        .map(sku => sku?.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
        .map(id => `prices/${id}/`)
    : [];

  const allPaths = Array.from(new Set([...staticPaths, ...skuPaths]));
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${allPaths
    .map(path => `  <url><loc>${buildUrl(url.origin, path)}</loc></url>`)
    .join("\n")}\n</urlset>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
