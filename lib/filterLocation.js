'use strict';

const { distanceMeters } = require('./geo');

const MAX_ACCURACY_METERS = 100;
const LARGE_JUMP_METERS = 75;
const MAX_IMPLIED_SPEED_KMH = 300;
const CONFIRMATION_RADIUS_METERS = 50;

function filterLocation(location, previousLocation, pendingLocation)
{
	if (typeof location.lat !== 'number' || typeof location.lon !== 'number')
	{
		return { accepted: true, pendingLocation: null };
	}

	if (Number.isFinite(location.accuracy) && location.accuracy > MAX_ACCURACY_METERS)
	{
		return { accepted: false, pendingLocation: null, reason: `accuracy ${location.accuracy}m` };
	}

	if (!previousLocation || typeof previousLocation.lat !== 'number' || typeof previousLocation.lon !== 'number')
	{
		return { accepted: true, pendingLocation: null };
	}

	const distance = distanceMeters(previousLocation.lat, previousLocation.lon, location.lat, location.lon);
	const elapsedMilliseconds = location.timestamp - previousLocation.timestamp;
	const impliedSpeedKmh = Number.isFinite(elapsedMilliseconds) && elapsedMilliseconds > 0
		? (distance / elapsedMilliseconds) * 3600
		: null;
	const isImpossibleJump = impliedSpeedKmh !== null && impliedSpeedKmh > MAX_IMPLIED_SPEED_KMH;
	if (distance <= LARGE_JUMP_METERS || !isImpossibleJump)
	{
		return { accepted: true, pendingLocation: null };
	}

	if (pendingLocation
		&& distanceMeters(pendingLocation.lat, pendingLocation.lon, location.lat, location.lon) <= CONFIRMATION_RADIUS_METERS)
	{
		return { accepted: true, pendingLocation: null };
	}

	return {
		accepted: false,
		pendingLocation: location,
		reason: isImpossibleJump
			? `unconfirmed ${Math.round(distance)}m jump at ${Math.round(impliedSpeedKmh)} km/h`
			: `unconfirmed ${Math.round(distance)}m stationary jump`,
	};
}

module.exports = { filterLocation };