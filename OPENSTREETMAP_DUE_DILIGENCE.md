# OpenStreetMap Tile Service Due-Diligence Review

**Application:** Homey Tracks (`com.ady.homeytrack`)
**Application version reviewed:** 1.0.11
**Repository:** <https://github.com/AdyRock/com.ady.homeytrack>
**Commit reviewed:** [`1b626d1ee68d18b177d4e5aa8f0aea6952c763d9`](https://github.com/AdyRock/com.ady.homeytrack/tree/1b626d1ee68d18b177d4e5aa8f0aea6952c763d9)
**Review date:** 16 September 2026
**Reviewer:** Repository review assisted by OpenAI Codex; conclusions should not be treated as legal advice.

## 1. Purpose and scope

This document records a technical due-diligence review of Homey Tracks' use of the OpenStreetMap Foundation (OSMF) Standard raster tile service at `tile.openstreetmap.org`.

The review covers:

- OSMF Tile Usage Policy requirements;
- OpenStreetMap attribution and Open Database Licence (ODbL) guidance;
- request identification;
- caching and conditional revalidation;
- bulk-download and offline-use restrictions;
- the privacy implications of displaying private location data over OSM base maps; and
- operational risks associated with relying on a community-operated service.

This is a source-code review of the stated commit. It is not a legal opinion, penetration test, runtime packet capture, or guarantee that a future version of the app or OSMF policy will remain unchanged.

## 2. Executive conclusion

At the reviewed commit, Homey Tracks is **substantially aligned with the mandatory technical requirements of the OSMF Tile Usage Policy** and demonstrates a reasonable, low-volume use of the community tile service.

The previously identified caching weaknesses have been addressed. The app now uses a persistent 256-tile cache, a minimum seven-day lifetime, `ETag` and `Last-Modified` metadata, and conditional requests for expired entries. Interactive maps and generated static images display OpenStreetMap attribution, requests use the canonical HTTPS endpoint and an identifiable application-specific User-Agent, and no bulk download or offline-map feature was found.

No code path was found that sends a person's name, raw GPS report, complete track, zone name, device identifier, avatar, or other application record to OSMF. OSM receives only ordinary tile requests containing zoom/X/Y tile coordinates, together with normal network metadata such as the Homey connection's IP address and the Homey Tracks User-Agent. Tile coordinates necessarily reveal the approximate area of the map being displayed; this is the remaining privacy consideration described in section 6.

There are two non-blocking recommendations:

1. add a short privacy disclosure explaining the external tile requests; and
2. make the tile endpoint replaceable without a full app release if practical.

Neither item is evidence of abusive tile use in the reviewed version. The second is explicitly a recommendation in OSMF's policy, not a mandatory requirement.

## 3. Evidence reviewed

The main implementation evidence is:

- [`lib/mapImage.js`](https://github.com/AdyRock/com.ady.homeytrack/blob/1b626d1ee68d18b177d4e5aa8f0aea6952c763d9/lib/mapImage.js): upstream tile URL, User-Agent, cache, conditional requests, generated-map rendering, and static attribution;
- [`widgets/map/public/index.html`](https://github.com/AdyRock/com.ady.homeytrack/blob/1b626d1ee68d18b177d4e5aa8f0aea6952c763d9/widgets/map/public/index.html): dashboard map tile requests and visible attribution;
- [`settings/settings.js`](https://github.com/AdyRock/com.ady.homeytrack/blob/1b626d1ee68d18b177d4e5aa8f0aea6952c763d9/settings/settings.js): settings and track maps, visible attribution, and initial map location;
- [`api.js`](https://github.com/AdyRock/com.ady.homeytrack/blob/1b626d1ee68d18b177d4e5aa8f0aea6952c763d9/api.js) and [`widgets/map/api.js`](https://github.com/AdyRock/com.ady.homeytrack/blob/1b626d1ee68d18b177d4e5aa8f0aea6952c763d9/widgets/map/api.js): private Homey tile endpoints and input validation;
- [`app.js`](https://github.com/AdyRock/com.ady.homeytrack/blob/1b626d1ee68d18b177d4e5aa8f0aea6952c763d9/app.js): persistent cache initialisation; and
- [`app.json`](https://github.com/AdyRock/com.ady.homeytrack/blob/1b626d1ee68d18b177d4e5aa8f0aea6952c763d9/app.json): API visibility, contact email, support URL, and app metadata.

The external requirements checked were:

- [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/);
- [OSMF Licence/Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines);
- [OpenStreetMap copyright and licence page](https://www.openstreetmap.org/copyright);
- [OSMF Privacy Policy](https://osmfoundation.org/wiki/Privacy_Policy); and
- [OSMF Services Terms of Use](https://osmfoundation.org/wiki/Terms_of_Use).

These sources were accessed on 16 September 2026.

## 4. Compliance assessment

| OSMF requirement or recommendation | Status | Evidence and assessment |
| --- | --- | --- |
| Use the canonical HTTPS raster URL | **Pass** | `TILE_URL_TEMPLATE` is exactly `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. |
| Send a distinct, stable User-Agent | **Pass** | The upstream client sends `HomeyTracks/1.0 (Homey app; https://github.com/AdyRock/com.ady.homeytrack)`, which identifies the app and provides a contact route. It does not use a generic Node or library identity. |
| Send a Referer for web-page traffic | **Not applicable / documented interpretation** | The browser does not contact OSMF. Tiles are requested by the installed Homey app's server-side client, which is identified by its User-Agent. OSMF states that native apps commonly have no Referer and that this is acceptable. The Homey UI is not acting as a conventional public website directly embedding OSM tiles. |
| Visible attribution on interactive maps | **Pass** | Both Leaflet tile-layer implementations display `© OpenStreetMap contributors`, with `OpenStreetMap` linked to the OSM copyright/licence page. |
| Attribution on generated static images | **Pass** | Generated PNG maps visibly include `© OpenStreetMap`. OSMF's attribution guideline accepts this historical form. |
| Do not conceal attribution | **Pass** | Attribution is supplied through the Leaflet attribution control or drawn directly onto generated images. No code was found that intentionally removes or hides it. |
| Cache tiles locally | **Pass** | Compressed tile buffers are cached and the cache is persisted through Homey settings. |
| Honour caching headers or cache for at least seven days | **Pass using the policy fallback** | Entries have a seven-day lifetime. The implementation records validators but deliberately uses the policy's minimum seven-day fallback rather than interpreting upstream `Cache-Control` or `Expires` values. |
| Use conditional requests after expiry | **Pass** | `If-None-Match` and `If-Modified-Since` are sent when the corresponding stored validator exists; HTTP `304` reuses the cached tile. |
| Keep a sufficient cache to avoid unnecessary repeat downloads | **Pass for the observed usage model** | The persistent limit is 256 compressed tiles. This is substantially better than the former 64-entry memory-only cache and is proportionate to 600×600 generated images and small interactive Homey maps. |
| Do not send cache-bypass headers | **Pass** | No default `Cache-Control: no-cache`, `Pragma: no-cache`, or equivalent bypass was found in the tile client. |
| No bulk download, scraping, or offline prefetch | **Pass** | Interactive maps request only tiles Leaflet needs for the displayed viewport. Static maps request only tiles required to render the requested image. No regional pre-seeding, multi-zoom download, tile archive, or offline-map feature was found. |
| Identified caching proxy | **Pass** | OSM-facing requests use a clear, contactable Homey Tracks User-Agent and the proxy cache applies the minimum seven-day rule. The app's tile API routes are private to the Homey UI. |
| Avoid submitting personal or confidential data | **Pass with residual privacy consideration** | No names, exact GPS payloads, tracks, zones, account data, or identifiers are included in OSM requests. Requested tile coordinates disclose the approximate displayed area, as is inherent in any slippy-map tile request. See section 6. |
| Avoid hard-coding the provider URL | **Advisory item open** | The URL remains a source constant. OSMF marks switchability as recommended, not mandatory. |
| Provide a contact route | **Pass** | The User-Agent links to the public repository; `app.json` also contains a maintainer email and GitHub Issues support URL. |
| Add a “Report a map issue” link | **Advisory item open** | No such link was found. OSMF lists this as recommended rather than mandatory. |
| HTTP/2 or HTTP/3 support | **Not verified; advisory only** | Protocol negotiation depends on the Homey Node runtime and network stack. OSMF lists multiplexed protocols as recommended. |

## 5. Caching and service-load assessment

The reviewed implementation has the following controls:

- a shared cache for interactive and generated-map tile requests;
- 256 compressed PNG entries rather than decoded 256×256 pixel buffers;
- persistence across app restarts using Homey settings;
- least-recently-used ordering while the app is running;
- a seven-day freshness period;
- saved `ETag` and `Last-Modified` validators;
- conditional revalidation and reuse on HTTP `304`;
- an eight-second upstream timeout;
- validated tile coordinates; and
- diagnostic counters for cache hits, misses, revalidations, upstream fetches, and failures.

The app's map behaviour is demand-driven. Dashboard location refreshes update markers and tracks without automatically rebuilding the Leaflet tile layer. Generated device images are rendered when Homey requests the image stream, rather than on every incoming OwnTracks location update. Small movements also tend to reuse the same tile set.

Earlier estimates placed normal use at approximately 300–1,500 upstream tile requests per installation per month, with light use below this and unusually heavy interactive use above it. This estimate is not a policy threshold and has not been established by telemetry, but it supports the conclusion that the current access pattern is modest. OSMF publishes no guaranteed permissible request count.

The diagnostic statistics endpoint makes it possible to verify the estimate in practice. If adoption or usage grows materially, aggregate observations should be used to decide whether a dedicated provider or self-hosted tiles have become more appropriate.

## 6. Privacy and personal-location analysis

### Data sent to OSMF

An upstream request contains the following relevant information:

- the standard tile path `/{zoom}/{x}/{y}.png`;
- the source network IP address visible to OSMF;
- the Homey Tracks User-Agent; and
- ordinary HTTP/TLS metadata.

The OSMF Privacy Policy expressly states that its services automatically receive network information including IP address, application/browser information, date/time, referring page where applicable, and pages accessed. It also specifically refers to IP addresses and request details associated with tile requests and explains that tiles are delivered through a global cache network.

Homey Tracks does **not** add a user name, family-member identity, Homey ID, OwnTracks ID, zone name, latitude/longitude query parameter, GPS report, or track history to the request. However, the tile X/Y/Z path allows the requested geographic area to be inferred. At zoom 16 or 17, the inferred area may be relatively small. Repeated requested areas could therefore reveal where the map is being viewed.

### Interpretation

The OSMF Tile Usage Policy says not to submit personal or confidential data. Ordinary tile coordinates are also essential to the service and are explicitly contemplated by OSMF's privacy policy as request details. On that basis, the reviewed implementation's ordinary, identified tile requests are not treated in this assessment as prohibited submission of personal data.

Nevertheless, because Homey Tracks handles private family-location information, transparency is prudent. A user should know that displaying a map causes an external map provider to receive the requested tile areas and normal network metadata. The proxy reduces disclosure because it does not expose application records or user names, but it cannot hide the geographic tile area from the provider that must return the map.

For users requiring stronger location confidentiality, the technical alternatives are a tile service selected under suitable contractual privacy terms, self-hosted tiles, or an option to disable external base-map tiles. All providers must receive the requested area unless the necessary tiles are already stored locally.

## 7. Remaining recommendations

### Priority 1 — Define review triggers

Repeat the review if any of the following occurs:

- OSMF changes the Tile Usage Policy, attribution guidance, privacy policy, or service URL;
- the app adds background map generation, prefetching, offline maps, geocoding, routing, or another OSMF API;
- measured upstream tile traffic rises materially;
- the app becomes commercial, requests donations, or receives large-scale adoption;
- the tile cache size, persistence, or seven-day lifetime is reduced; or
- the tile provider changes.

### Priority 2 — Provider switchability

If practical, read the tile template from a controlled app setting or other remotely changeable configuration with a safe built-in default. Attribution and provider-specific terms must change with the provider. This would reduce operational risk if OSMF withdraws access, but is not necessary to satisfy the current mandatory tile-policy requirements.

### Priority 3 — Optional map-issue link

Consider adding a link to <https://www.openstreetmap.org/fixthemap>. This is an OSMF recommendation and would help users report errors to the appropriate place.

## 8. Operational limitations and acceptance

OSMF states that its Standard tile service is community-funded, best-effort, has no service-level agreement, and may block access without notice if use harms the service. Passing this review therefore does not guarantee continued availability.

Continued use is reasonable while:

- traffic remains modest and demand-driven;
- the identifying User-Agent remains present and contactable;
- attribution remains visible;
- the persistent cache and conditional revalidation remain enabled;
- no bulk, offline, or speculative download feature is introduced; and
- service usage and policy changes are reviewed periodically.

If these conditions cease to hold, the maintainer should move to a suitable hosted provider or self-hosted tiles.

## 9. Verification record

The following checks were completed for this review:

- cloned and inspected the public `main` branch at commit `1b626d1ee68d18b177d4e5aa8f0aea6952c763d9`;
- searched the repository for all OpenStreetMap URLs, attribution strings, tile endpoints, caching headers, validators, User-Agent values, and map initialisation paths;
- confirmed that the only OSMF upstream tile URL is the canonical HTTPS Standard raster endpoint;
- confirmed that interactive tile requests flow through the identified cached client;
- confirmed that tile API routes used by the Homey UI are not public routes;
- confirmed persistent cache initialisation during app startup;
- checked JavaScript syntax for `lib/mapImage.js`, `api.js`, `widgets/map/api.js`, `settings/settings.js`, and `app.js`; and
- compared the implementation with the OSMF policy and guidance pages listed in section 3.

The repository does not define an automated `npm test` script, so no project test suite was available to run. Runtime validation of HTTP headers, negotiated protocol, cache persistence limits, and real request volume remains an optional follow-up check.

## 10. Maintainer sign-off

This section may be completed when the report is committed.

- **Reviewed/accepted by:** ______________________________
- **Role:** ______________________________________________
- **Date:** ______________________________________________
- **Repository commit containing this report:** ___________
- **Next review date or trigger:** _________________________

