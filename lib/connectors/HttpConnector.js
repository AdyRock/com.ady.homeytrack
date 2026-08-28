'use strict';

const BaseConnector = require('./BaseConnector');
const { parseLocationPayload, parseWaypointPayloads } = require('./parseLocation');

/**
 * Accepts OwnTracks HTTP mode payloads, forwarded from the app's api.js endpoint.
 */
class HttpConnector extends BaseConnector
{

	/**
	 * Handles a payload posted by an OwnTracks device.
	 * @param {object} body The parsed JSON body of the HTTP request.
	 * @param {{ user?: string, device?: string }} [context] Optional user/device hints from the request (e.g. query params).
	 */
	ingest(body, context = {})
	{
		const reports = Array.isArray(body) ? body : [body];

		for (const raw of reports)
		{
			const location = parseLocationPayload(raw, context);
			if (location)
			{
				this.emit('location', location);
			}

			for (const waypoint of parseWaypointPayloads(raw))
			{
				this.emit('waypoint', waypoint);
			}
		}
	}

}

module.exports = HttpConnector;
