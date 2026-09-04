'use strict';

const REQUIRED_CONFIRMATIONS = 3;

function normalizeZones(regions)
{
	return [...new Set((Array.isArray(regions) ? regions : [])
		.map((region) => String(region).trim().toLowerCase())
		.filter(Boolean))]
		.sort();
}

function zoneSignature(regions)
{
	return normalizeZones(regions).join('\n');
}

function confirmZoneChange(currentRegions, proposedRegions, pendingChange)
{
	const currentSignature = zoneSignature(currentRegions);
	const proposedSignature = zoneSignature(proposedRegions);

	if (proposedSignature === currentSignature)
	{
		return { shouldApply: false, pendingChange: null };
	}

	// Arriving somewhere is applied straight away, because a user who has just arrived usually
	// stops and their phone may not report again for a long time. Only leaving is debounced:
	// someone genuinely leaving keeps moving, so the confirming reports do keep coming.
	const currentZones = new Set(normalizeZones(currentRegions));
	if (normalizeZones(proposedRegions).some((zone) => !currentZones.has(zone)))
	{
		return { shouldApply: true, pendingChange: null };
	}

	const confirmationCount = pendingChange && pendingChange.signature === proposedSignature
		? pendingChange.confirmationCount + 1
		: 1;
	if (confirmationCount >= REQUIRED_CONFIRMATIONS)
	{
		return { shouldApply: true, pendingChange: null };
	}

	return {
		shouldApply: false,
		pendingChange: { signature: proposedSignature, confirmationCount },
	};
}

module.exports = { confirmZoneChange };