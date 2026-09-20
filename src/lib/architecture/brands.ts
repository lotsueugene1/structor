import {
  siAlgolia,
  siAnthropic,
  siApachekafka,
  siApollographql,
  siAstro,
  siAuth0,
  siBetterauth,
  siClerk,
  siCloudflare,
  siDatadog,
  siDjango,
  siDocker,
  siDrizzle,
  siElasticsearch,
  siExpress,
  siFastapi,
  siFastify,
  siFirebase,
  siFlask,
  siGithub,
  siGraphql,
  siHono,
  siKubernetes,
  siLinear,
  siMailgun,
  siMixpanel,
  siMongodb,
  siMysql,
  siNeon,
  siNestjs,
  siNetlify,
  siNextdotjs,
  siNotion,
  siNuxt,
  siOkta,
  siPaypal,
  siPlanetscale,
  siPostgresql,
  siPosthog,
  siPrisma,
  siRabbitmq,
  siRailway,
  siReact,
  siRedis,
  siRemix,
  siRender,
  siResend,
  siRubyonrails,
  siSentry,
  siSequelize,
  siShopify,
  siSqlite,
  siStripe,
  siSupabase,
  siSvelte,
  siTurso,
  siTypeorm,
  siUpstash,
  siVercel,
  siVuedotjs,
} from "simple-icons";

export type BrandMark = {
  title: string;
  path: string;
  hex: string;
};

type BrandEntry = {
  icon: BrandMark;
  match: RegExp;
};

const dark = new Set(["000000", "0a0a0a", "181717", "191919", "0b0d0e"]);

function brand(icon: BrandMark, match: RegExp): BrandEntry {
  return { icon, match };
}

// Brand marks come from Simple Icons (CC0). Marks that are not redistributable
// there, such as AWS, Twilio, and OpenAI, fall back to the architecture kind icon.
const brands: BrandEntry[] = [
  brand(siStripe, /\bstripe\b/),
  brand(siResend, /\bresend\b/),
  brand(siAuth0, /\bauth0\b/),
  brand(siBetterauth, /\bbetter[- ]?auth\b/),
  brand(siClerk, /\bclerk\b/),
  brand(siOkta, /\bokta\b/),
  brand(siPostgresql, /\bpostgres(?:ql)?\b/),
  brand(siRedis, /\bredis\b/),
  brand(siMongodb, /\bmongo(?:db)?\b/),
  brand(siMysql, /\bmysql\b/),
  brand(siSqlite, /\bsqlite\b/),
  brand(siPrisma, /\bprisma\b/),
  brand(siDrizzle, /\bdrizzle\b/),
  brand(siTypeorm, /\btypeorm\b/),
  brand(siSequelize, /\bsequelize\b/),
  brand(siSupabase, /\bsupabase\b/),
  brand(siFirebase, /\bfirebase\b/),
  brand(siNeon, /\bneon\b/),
  brand(siPlanetscale, /\bplanetscale\b/),
  brand(siTurso, /\bturso\b/),
  brand(siUpstash, /\bupstash\b/),
  brand(siVercel, /\bvercel\b/),
  brand(siNetlify, /\bnetlify\b/),
  brand(siRailway, /\brailway\b/),
  brand(siRender, /\brender\.com\b|\brender platform\b/),
  brand(siCloudflare, /\bcloudflare\b/),
  brand(siDocker, /\bdocker\b/),
  brand(siKubernetes, /\bkubernetes\b|\bk8s\b/),
  brand(siNextdotjs, /\bnext(?:\.js)?\b/),
  brand(siReact, /\breact\b/),
  brand(siRemix, /\bremix\b/),
  brand(siSvelte, /\bsvelte(?:kit)?\b/),
  brand(siNuxt, /\bnuxt\b/),
  brand(siVuedotjs, /\bvue(?:\.js)?\b/),
  brand(siAstro, /\bastro\b/),
  brand(siNestjs, /\bnest(?:js)?\b/),
  brand(siExpress, /\bexpress\b/),
  brand(siFastify, /\bfastify\b/),
  brand(siHono, /\bhono\b/),
  brand(siDjango, /\bdjango\b/),
  brand(siFastapi, /\bfastapi\b/),
  brand(siFlask, /\bflask\b/),
  brand(siRubyonrails, /\brails\b/),
  brand(siGraphql, /\bgraphql\b/),
  brand(siApollographql, /\bapollo\b/),
  brand(siApachekafka, /\bkafka\b/),
  brand(siRabbitmq, /\brabbitmq\b/),
  brand(siElasticsearch, /\belasticsearch\b/),
  brand(siAlgolia, /\balgolia\b/),
  brand(siSentry, /\bsentry\b/),
  brand(siPosthog, /\bposthog\b/),
  brand(siDatadog, /\bdatadog\b/),
  brand(siMixpanel, /\bmixpanel\b/),
  brand(siMailgun, /\bmailgun\b/),
  brand(siAnthropic, /\banthropic\b|\bclaude\b/),
  brand(siGithub, /\bgithub\b/),
  brand(siPaypal, /\bpaypal\b/),
  brand(siShopify, /\bshopify\b/),
  brand(siNotion, /\bnotion\b/),
  brand(siLinear, /\blinear\b/),
];

export function findBrandMark(name: string): BrandMark | null {
  const normalized = name.toLowerCase();
  return brands.find((entry) => entry.match.test(normalized))?.icon ?? null;
}

export function brandColor(mark: BrandMark) {
  const hex = mark.hex.toLowerCase();
  return dark.has(hex) || hex === "ffffff" ? "currentColor" : `#${mark.hex}`;
}
