'use strict';

/**
 * Parses a raw OwnTracks payload into a normalized location object.
 * Returns null when the payload is not a location report.
 * @param {object} raw The parsed JSON payload sent by OwnTracks.
 * @param {{ user?: string, device?: string }} [context] Fallback user/device, used when not present in the payload.
 */
function parseLocationPayload(raw, context = {})
{
	if (!raw || raw._type !== 'location')
	{
		return null;
	}

	return {
		// For HTTP mode, the URL's userId is authoritative (it's what the user paired the
		// device with); the payload's own "topic" is only used as a fallback, and for MQTT
		// mode where there is no per-request context.
		user: context.user || (raw.topic ? topicToUser(raw.topic) : 'unknown'),
		device: (raw.topic ? topicToDevice(raw.topic) : context.device) || 'unknown',
		// The exact MQTT topic this location came in on (null for HTTP mode), so we know where
		// to publish a retained "card" (avatar) message back for this same user/device.
		topic: raw.topic || null,
		trackerId: raw.tid || null,
		lat: raw.lat,
		lon: raw.lon,
		accuracy: raw.acc,
		altitude: raw.alt,
		battery: raw.batt,
		velocity: raw.vel,
		regions: Array.isArray(raw.inregions) ? raw.inregions : [],
		timestamp: raw.tst ? raw.tst * 1000 : Date.now(),
	};
}

// OwnTracks MQTT topics follow the pattern: owntracks/<user>/<device>
function topicToUser(topic)
{
	const parts = topic.split('/');
	return parts[1] || 'unknown';
}

function topicToDevice(topic)
{
	const parts = topic.split('/');
	return parts[2] || 'unknown';
}

/**
 * Parses a raw OwnTracks payload into zero or more normalized waypoints (regions/geofences).
 * Handles both a single "waypoint" report and a bulk "waypoints" sync payload.
 * @param {object} raw The parsed JSON payload sent by OwnTracks.
 * @returns {{ desc: string, lat: number, lon: number, rad: number, tst: number }[]}
 */
function parseWaypointPayloads(raw)
{
	if (!raw)
	{
		return [];
	}

	if (raw._type === 'waypoint')
	{
		return [normalizeWaypoint(raw)].filter(Boolean);
	}

	if (raw._type === 'waypoints' && Array.isArray(raw.waypoints))
	{
		return raw.waypoints.map(normalizeWaypoint).filter(Boolean);
	}

	return [];
}

function normalizeWaypoint(raw)
{
	if (!raw || !raw.desc || typeof raw.lat !== 'number' || typeof raw.lon !== 'number')
	{
		return null;
	}

	return {
		desc: raw.desc,
		lat: raw.lat,
		lon: raw.lon,
		rad: typeof raw.rad === 'number' ? raw.rad : 100,
		tst: raw.tst || Math.round(Date.now() / 1000),
	};
}

module.exports = { parseLocationPayload, parseWaypointPayloads };
