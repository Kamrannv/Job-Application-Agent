/**
 * "Remote" is not one thing. A job posted as "Remote - United States" or
 * "Remote, Germany" is closed to a candidate in Azerbaijan, and is worse than
 * useless — it costs a cover letter and your attention on an application that
 * cannot succeed.
 *
 * The rule here is positive evidence, not blacklisting: a posting must show
 * that it hires beyond a single country. Naming any one country or city is
 * treated as a restriction, because that is what it almost always is.
 */

// Regions that plausibly include Azerbaijan, or impose no limit at all.
const OPEN_REGION = /\b(worldwide|world\s?wide|anywhere|globally|global|international|emea|europe|european|eu\b|cee|eastern\s+europe|central\s+europe|caucasus|middle\s+east|central\s+asia|cis\b|apac\s*\+\s*emea|any\s+(?:country|location|time\s?zone)|fully\s+distributed|location\s*[-:]?\s*independent|no\s+location\s+requirement)\b/i;

const AZERBAIJAN = /\bazerbaijan|baku\b/i;

/**
 * Naming a single country or city means the role is scoped to it. Not
 * exhaustive — it does not need to be. Anything it misses falls through to
 * "unrestricted", which is surfaced to you flagged rather than dropped.
 */
/**
 * Countries far enough away that a remote contract from Azerbaijan is not
 * realistic — timezone, payroll, and work-authorization all bite. Hard reject.
 */
const FAR_COUNTRY = /\b(united\s+states|u\.?s\.?a?\.?|america|canada|canadian|mexico|brazil|argentina|colombia|chile|peru|india|pakistan|china|japan|korea|singapore|malaysia|thailand|vietnam|indonesia|philippines|australia|new\s+zealand)\b/i;

/**
 * Europe, the CIS, the Caucasus and the Middle East. A role scoped to one of
 * these is not a guaranteed fit, but it is plausible — these employers
 * routinely engage remote contractors across the region, and the timezone
 * works. Surfaced to you flagged rather than discarded.
 */
const NEARBY_COUNTRY = /\b(united\s+kingdom|uk|england|scotland|wales|ireland|germany|france|spain|italy|netherlands|holland|belgium|luxembourg|poland|portugal|sweden|norway|denmark|finland|iceland|austria|switzerland|czech(?:ia)?|slovakia|slovenia|hungary|romania|bulgaria|greece|croatia|serbia|bosnia|albania|estonia|latvia|lithuania|ukraine|moldova|belarus|georgia|armenia|turkey|t(?:ü|u)rkiye|israel|uae|united\s+arab\s+emirates|dubai|saudi|qatar|kuwait|cyprus|malta|kazakhstan|uzbekistan)\b/i;

const SPECIFIC_CITY = /\b(new\s+york|san\s+francisco|los\s+angeles|chicago|boston|seattle|austin|denver|atlanta|miami|dallas|houston|philadelphia|phoenix|portland|san\s+diego|san\s+jose|menlo\s+park|palo\s+alto|mountain\s+view|sunnyvale|cupertino|bellevue|brooklyn|pittsburgh|nashville|charlotte|minneapolis|toronto|vancouver|montreal|ottawa|calgary|london|berlin|munich|cologne|hamburg|paris|madrid|barcelona|lisbon|amsterdam|rotterdam|brussels|dublin|stockholm|oslo|copenhagen|helsinki|zurich|geneva|vienna|prague|warsaw|krakow|budapest|bucharest|milan|rome|athens|tel\s+aviv|dubai|bangalore|bengaluru|mumbai|delhi|singapore|tokyo|sydney|melbourne|sao\s+paulo|mexico\s+city)\b/i;

// "City, ST" — the code only counts after a comma, so it cannot collide with
// ordinary words like "OR" or "IN".
const US_STATE_CODE = /,\s*(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;

const US_STATES = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new\s+hampshire|new\s+jersey|new\s+mexico|new\s+york|north\s+carolina|north\s+dakota|ohio|oklahoma|oregon|pennsylvania|rhode\s+island|south\s+carolina|south\s+dakota|tennessee|texas|utah|vermont|virginia|washington|west\s+virginia|wisconsin|wyoming)\b/i;

// Hard work-authorization gates stated in the body.
const AUTH_WALL = [
  { name: 'US work authorization required', re: /\b(authoriz|eligib)\w*\s+to\s+work\s+in\s+(the\s+)?(us|u\.s\.|united\s+states)|\bus\s+work\s+authoriz|\bmust\s+be\s+(a\s+)?(us|u\.s\.)\s+(citizen|resident)|\brequires?\s+us\s+citizenship|\bgreen\s+card\b/i },
  { name: 'Canada work authorization required', re: /\b(authoriz|eligib)\w*\s+to\s+work\s+in\s+canada|\bmust\s+be\s+(a\s+)?canadian\s+(citizen|resident)/i },
  { name: 'UK work authorization required', re: /\bright\s+to\s+work\s+in\s+the\s+uk|\buk\s+work\s+authoriz/i },
  { name: 'EU work authorization required', re: /\b(must\s+(?:have|possess)\s+(?:the\s+)?(?:legal\s+)?right\s+to\s+work\s+in\s+the\s+(?:eu|european\s+union)|eu\s+work\s+permit\s+required)/i },
  { name: 'security clearance required', re: /\b(security\s+clearance|ts\/sci|public\s+trust\s+clearance)\b/i },
];

const FAR_CITY = /\b(new\s+york|san\s+francisco|los\s+angeles|chicago|boston|seattle|austin|denver|atlanta|miami|dallas|houston|philadelphia|phoenix|portland|san\s+diego|san\s+jose|menlo\s+park|palo\s+alto|mountain\s+view|sunnyvale|cupertino|bellevue|brooklyn|pittsburgh|nashville|charlotte|minneapolis|toronto|vancouver|montreal|ottawa|calgary|bangalore|bengaluru|mumbai|delhi|singapore|tokyo|sydney|melbourne|sao\s+paulo|mexico\s+city)\b/i;

/**
 * @returns {{tier:'far'|'nearby', label:string}|null}
 */
function namedPlace(text) {
  if (US_STATE_CODE.test(text) || US_STATES.test(text)) return { tier: 'far', label: 'US location' };

  const far = text.match(FAR_COUNTRY) || text.match(FAR_CITY);
  if (far) return { tier: 'far', label: `${far[0]} only` };

  const near = text.match(NEARBY_COUNTRY) || text.match(SPECIFIC_CITY);
  if (near) return { tier: 'nearby', label: `${near[0]}-scoped` };

  return null;
}

/**
 * @returns {{ok: boolean, reason?: string, confidence?: 'high'|'medium'}}
 */
export function geoCheck(job) {
  const location = String(job.location || '').trim();
  const body = String(job.description || '');

  // Your own country named outright always wins.
  if (AZERBAIJAN.test(`${location} ${body}`)) return { ok: true, confidence: 'high' };

  // A hard authorization wall disqualifies regardless of how the location reads.
  for (const { name, re } of AUTH_WALL) {
    if (re.test(body)) return { ok: false, reason: name };
  }

  const openRegion = OPEN_REGION.test(location);
  const place = namedPlace(location);

  // "Remote - Europe" or "Worldwide" — open enough to include you.
  // A named place alongside an open region ("EMEA, remote from Berlin") still
  // counts as open, because the wider region is the hiring boundary.
  if (openRegion) return { ok: true, confidence: 'high' };

  // A single country or city with no wider region is a restriction. How hard a
  // restriction depends on which country.
  if (place) {
    if (place.tier === 'far') return { ok: false, reason: place.label };
    // Nearby: plausible but unconfirmed — you decide from the card.
    return { ok: true, confidence: 'medium', note: place.label };
  }

  // No location signal at all. On remote-only boards that means genuinely
  // open; elsewhere it is unknown. Either way, surface it flagged.
  if (OPEN_REGION.test(body)) return { ok: true, confidence: 'high' };
  return { ok: true, confidence: 'medium' };
}
