import affiliateConfig from "../data/affiliate.json" assert { type: "json" };

const DEFAULT_TARGET = "_blank";
const DEFAULT_REL = "sponsored noopener";

const normalizedRules = Object.entries(affiliateConfig ?? {}).map(([domain, rule]) => ({
  domain: domain.toLowerCase(),
  rule: rule ?? {}
}));

function findRuleForHost(hostname) {
  const host = (hostname ?? "").toLowerCase();
  if (!host) {
    return null;
  }
  for (const { domain, rule } of normalizedRules) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      return rule;
    }
  }
  return null;
}

function applyAppendParams(url, params) {
  if (!params || typeof params !== "object") {
    return;
  }
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

export function buildAffiliateHref(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return rawUrl;
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const rule = findRuleForHost(url.hostname);
  if (!rule) {
    return url.toString();
  }

  if (rule.append) {
    applyAppendParams(url, rule.append);
  }

  if (rule.replaceHost) {
    url.hostname = rule.replaceHost;
  }

  if (rule.protocol) {
    url.protocol = rule.protocol;
  }

  return url.toString();
}

export function buildLink(rawUrl) {
  const href = buildAffiliateHref(rawUrl);
  return {
    href,
    target: DEFAULT_TARGET,
    rel: DEFAULT_REL
  };
}

export default buildLink;
