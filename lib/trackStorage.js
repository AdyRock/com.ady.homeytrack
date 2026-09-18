'use strict';

function sanitizePoint(point)
{
	if (!point || typeof point !== 'object') return null;
	const { raw, ...storedPoint } = point;
	return storedPoint;
}

function readTrack(activeTrack, archivedTrack)
{
	let archived = [];
	if (typeof archivedTrack === 'string' && archivedTrack)
	{
		try
		{
			const parsed = JSON.parse(archivedTrack);
			if (Array.isArray(parsed)) archived = parsed;
		}
		catch (err)
		{
			// Keep the active journey usable if an archive is corrupt.
		}
	}

	const points = [...archived, ...(Array.isArray(activeTrack) ? activeTrack : [])]
		.map(sanitizePoint)
		.filter(Boolean)
		.sort((first, second) => (first.timestamp || 0) - (second.timestamp || 0));
	const seen = new Set();
	return points.filter((point) =>
	{
		const key = `${point.timestamp}:${point.lat}:${point.lon}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function splitTrack(track, gapMilliseconds, maxPoints)
{
	const points = readTrack(track, '').slice(-Math.max(1, maxPoints));
	let activeStart = Math.max(0, points.length - 1);
	while (activeStart > 0
		&& (points[activeStart].timestamp || 0) - (points[activeStart - 1].timestamp || 0) <= gapMilliseconds)
	{
		activeStart -= 1;
	}

	return {
		active: points.slice(activeStart),
		archive: JSON.stringify(points.slice(0, activeStart)),
	};
}

module.exports = { readTrack, splitTrack };