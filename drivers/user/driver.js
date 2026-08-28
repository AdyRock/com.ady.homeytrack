'use strict';

const Homey = require('homey');

module.exports = class UserDriver extends Homey.Driver
{

	async onInit()
	{
		const zoneChangedCard = this.homey.flow.getDeviceTriggerCard('zone_changed');
		const autocompleteZones = async (query) =>
		{
			const search = String(query || '').toLowerCase();
			return this.homey.app.listWaypoints()
				.filter((waypoint) => waypoint.desc.toLowerCase().includes(search))
				.map((waypoint) => ({ name: waypoint.desc, id: waypoint.desc }));
		};
		zoneChangedCard.registerArgumentAutocompleteListener('zone', autocompleteZones);

		const conditionCard = this.homey.flow.getConditionCard('zone_is');
		conditionCard.registerArgumentAutocompleteListener('zone', autocompleteZones);
		conditionCard.registerRunListener(async (args) =>
		{
			const currentZoneValue = args.device.getCapabilityValue('zone');
			const currentZones = String(Array.isArray(currentZoneValue) ? currentZoneValue.join(',') : currentZoneValue || '')
				.split(',')
				.map((zone) => zone.trim().toLowerCase())
				.filter(Boolean);
			const selectedZoneValue = args.zone && typeof args.zone === 'object' ? (args.zone.id || args.zone.name) : args.zone;
			const selectedZone = String(selectedZoneValue || '').trim().toLowerCase();
			return currentZones.includes(selectedZone);
		});
	}

	async onPair(session)
	{
		session.setHandler('getHomeyId', async () => this.homey.cloud.getHomeyId());
	}

};
