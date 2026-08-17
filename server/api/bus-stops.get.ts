import { BUS_STOPS_CACHE_TAG, readBusStops } from '../../lib/bus-stops/store'

export default defineEventHandler(async (event) => {
  const stops = await readBusStops()

  if (!stops) {
    // Nothing has been rebuilt yet on this site, so fall through to the copy committed
    // under public/data. Cached only briefly so the first real rebuild shows up quickly.
    setResponseHeader(event, 'cache-control', 'public, max-age=0, must-revalidate')
    setResponseHeader(event, 'netlify-cdn-cache-control', 'public, s-maxage=60')
    return await sendRedirect(event, '/data/bus-stops.json', 302)
  }

  // This payload is ~900 KB and changes only when an admin rebuilds it, so it is held in
  // the durable edge cache and served from there. The rebuild job purges the tag below,
  // which is what makes an update visible immediately.
  setResponseHeader(event, 'cache-control', 'public, max-age=0, must-revalidate')
  setResponseHeader(event, 'netlify-cdn-cache-control', 'public, durable, s-maxage=31536000, stale-while-revalidate=60')
  setResponseHeader(event, 'netlify-cache-tag', BUS_STOPS_CACHE_TAG)
  return stops
})
