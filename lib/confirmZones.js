'use strict';

const REQUIRED_CONFIRMATIONS = 3;

function zoneSignature(regions)
{
	return [...new Set((Array.isArray(regions) ? regions : [])
		.map((region) => String(region).trim().toLowerCase())
		.filter(Boolean))]
		.sort()
		.join('\n');
}

function confirmZoneChange(currentRegions, proposedRegions, pendingChange)
{
	const currentSignature = zoneSignature(currentRegions);
	const proposedSignature = zoneSignature(proposedRegions);

	if (proposedSignature === currentSignature)
	{
		return { shouldApply: false, pendingChange: null };
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